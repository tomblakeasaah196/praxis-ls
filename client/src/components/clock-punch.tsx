/**
 * The time clock: THE place employees clock in and out (the Attendance screen
 * is the manager's view). The title bar carries it on desktop and the floating
 * toolbar on a phone; both render the same pill from one shared state.
 *
 * THREE FACES, NOTHING ELSE (owner's decision, 16 Oct 2026): "Clock In" before
 * today's shift, the running HH:MM:SS during it, and a disabled "Done" after
 * it, with a two-minute Undo. Clock-in has no confirmation; clock-out does,
 * showing the time worked against the day's target. The clock is the same in
 * LIVE and TEST because the server always keeps it in LIVE.
 *
 * NOTHING STOPS THE FIRST PUNCH OF THE DAY (14403), AND NOTHING FAILS OUT OF
 * SIGHT (28 Nov 2026). Not a missing location, not a slow GPS, not a dead
 * network, not a tenant's `block` policy, and not the person's role:
 *
 *   no location    the clock-in dialog asks for it, or names the cause with its
 *                  fix, BEFORE the punch; "Clock In Without Location" is always
 *                  on it, and that punch is recorded as Location Not Verified;
 *   new device     the dialog asks for its name, then the punch goes;
 *   slow GPS       the tap waits at most five seconds, punches, and attaches
 *                  the reading when it lands (lib/clock-location);
 *   no network     the punch is held on the phone with the moment it was
 *                  tapped and goes out by itself on reconnect (lib/outbox);
 *   block policy   the server holds the punch for a manager instead of a 422;
 *   any role       the clock routes take no grant: a linked employee is enough.
 *
 * Every outcome is said: a refused punch opens the dialog with the reason and
 * Try Again, a held or unverified one says so in a toast.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import * as api from "@/lib/hr-api";
import { ApiError, isNetworkError } from "@/lib/api-client";
import {
  watchGeoPermission,
  type GeoPermission,
  type LocationError,
} from "@/lib/geo-permission";
import {
  askForLocation,
  captureForPunch,
  setLocationPermission,
  warmGps,
  type Capture,
  type LateResult,
} from "@/lib/clock-location";
import { getOutbox, subscribeOutbox } from "@/lib/outbox";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { ClockInDialog, type ClockInStep, type LocationAsk } from "@/components/clock-in-dialog";
import i18n from "@/lib/i18n";
import { hoursFmt, timerFmt } from "@/lib/clock-format";

/**
 * The location failures the person can do something about, and so the ones
 * that open the dialog BEFORE the punch. A slow GPS (`timeout`) is not one:
 * the punch goes and the reading follows it. A browser with no geolocation at
 * all (`unsupported`) is not one either: there is nothing to fix.
 */
const FIXABLE: ReadonlySet<LocationError> = new Set(["denied", "os_off", "unavailable"]);

/** How long after clocking out the Undo is offered. The server allows the same. */
const UNDO_MS = 2 * 60_000;

/**
 * How long a clock-in keeps the moment of its first tap. A detour through the
 * dialog (allowing location, naming the device) should not cost the person the
 * seconds it took, so the punch is stamped at the tap. Past this the server
 * would read the gap as a punch held offline (its LIVE_GAP_MS is a minute), so
 * a longer detour is stamped at the moment it was sent.
 */
const TAP_HOLD_MS = 50_000;

/**
 * Set once this device has produced a location. Browsers that report `prompt`
 * every visit (Safari set to Ask) then go straight to the reading, which puts
 * their own prompt up on the tap, instead of through the dialog every morning.
 */
const LOCATION_OK_KEY = "praxis.clock.locationOk";

const NO_LATE: Promise<LateResult> = Promise.resolve({ fix: null, error: null });

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    /* @silent:storage — private mode: the dialog may simply ask again */
    return false;
  }
}
function writeFlag(key: string): void {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    /* @silent:storage — private mode: the dialog may simply ask again */
  }
}

function newRef(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // RFC 4122 v4 shape, because the server validates `client_ref` as a uuid.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * The punch a queued (offline) write implies, read back from the outbox.
 *
 * Without this a reload while offline would ask the server — unreachable — or
 * read an older answer, and show "Clock in" to somebody whose clock-in is
 * sitting on their phone waiting to go. The newest queued punch wins.
 */
function queuedPunch(): { state: "in"; row: api.AttendanceRow } | { state: "out"; at: string } | null {
  const mine = getOutbox().filter(
    (e) => e.state === "queued" && (e.path === "/attendance/clock-in" || e.path === "/attendance/clock-out"),
  );
  const lastEntry = mine[mine.length - 1];
  if (!lastEntry) return null;
  if (lastEntry.path === "/attendance/clock-out") {
    const out = (lastEntry.body || {}) as api.ClockOutBody;
    return { state: "out", at: out.tapped_at || new Date(lastEntry.queuedAt).toISOString() };
  }
  const body = (lastEntry.body || {}) as api.ClockInBody;
  return {
    state: "in",
    row: {
      attendance_id: `queued:${body.client_ref || lastEntry.id}`,
      client_ref: body.client_ref || null,
      clock_in_at: body.tapped_at || new Date(lastEntry.queuedAt).toISOString(),
      punched_offline: true,
    },
  };
}

type ClockState = ReturnType<typeof useClockState>;

const ClockContext = React.createContext<ClockState | null>(null);

/**
 * ONE clock for the whole shell.
 *
 * The title-bar chip and the touch cluster each used to run their own copy of
 * the clock: two `openPunch` calls, two location watchers started on page load,
 * and two independent ideas of whether the location card was showing. On a
 * phone the chip is hidden with CSS but still MOUNTED, so every screen ran both.
 * The provider holds the single copy; the two surfaces only render it.
 */
export function ClockPunchProvider({ children }: { children: React.ReactNode }) {
  const state = useClockState(true);
  return (
    <ClockContext.Provider value={state}>
      {children}
      {/* ONE clock-in and ONE clock-out dialog for the shell. They render into
          a portal, so a copy per surface would open twice: the title-bar chip
          is hidden with CSS on a phone, not unmounted. */}
      <ClockInFlow clock={state} />
      <ClockOutDialog clock={state} />
    </ClockContext.Provider>
  );
}

/**
 * The clock state and the punch action, without a presentation.
 *
 * Inside the shell this reads the provider. Outside one (a test, a storybook)
 * it runs its own copy, so a surface rendered on its own still works.
 */
export function useClockPunch(): ClockState & { ownsDialog: boolean } {
  const shared = React.useContext(ClockContext);
  const local = useClockState(shared === null);
  // Outside a provider the surface has to bring its own dialog.
  return shared ? { ...shared, ownsDialog: false } : { ...local, ownsDialog: true };
}

/** Whole minutes between two moments, never negative. */
function minutesBetween(from: string | null | undefined, to: Date | string | null | undefined): number {
  if (!from || !to) return 0;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 60_000) : 0;
}

/**
 * The clock has exactly three faces (owner's decision, 16 Oct 2026), the same
 * in LIVE and in TEST because the clock itself is always LIVE:
 *
 *   in    not clocked in today: "Clock In", nothing else. Tapping clocks in at
 *         once, no confirmation.
 *   on    on the clock: the running time since clock-in, HH:MM:SS. Tapping asks
 *         to confirm the clock-out, with the time worked against the day's
 *         target, where they clocked in from and on what.
 *   done  clocked out today: disabled until tomorrow, so nobody clocks in twice
 *         in a day. For two minutes it offers Undo, for a mis-tap; after that
 *         only a manager can reopen the shift.
 *
 * `loading` and `unlinked` render nothing: a person who is not an employee has
 * no clock, and a clock that flickers "Clock In" before saying so is worse.
 */
export type ClockPhase = "loading" | "unlinked" | "in" | "on" | "done";

function useClockState(enabled: boolean) {
  const toast = useToast();
  const [punch, setPunch] = React.useState<api.AttendanceRow | null>(null);
  /** Today's finished shift: the clock is done until tomorrow. */
  const [done, setDone] = React.useState<api.AttendanceRow | null>(null);
  const [expected, setExpected] = React.useState<number | null>(null);
  /** Epoch ms until which the person may take their clock-out back. */
  const [undoUntil, setUndoUntil] = React.useState<number | null>(null);
  /** null until the server has answered: an unlinked user must never be asked for location. */
  const [linked, setLinked] = React.useState<boolean | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  /**
   * Is this browser on the person's device register? From `/attendance/me`,
   * so the clock knows BEFORE the tap whether to ask for a name. Null when it
   * cannot tell (no device id, an older server, offline): then it does not
   * ask, and the punch registers the device under its generated label.
   *
   * The employee is the only person who knows the answer — a manager renaming
   * it later is guessing which of two "Windows · Chrome" rows is the yard
   * tablet — so the name is asked once, on the first punch from the device.
   */
  const [deviceKnown, setDeviceKnown] = React.useState<boolean | null>(null);
  const [permission, setPermission] = React.useState<GeoPermission | null>(null);
  /** The clock-in dialog's step; null while it is closed. */
  const [step, setStep] = React.useState<ClockInStep | null>(null);
  /**
   * The clock-in in progress. A new object per tap, and every await in the flow
   * checks it is still the current one, so a Cancel while a reading is pending
   * cannot be followed by a punch nobody is waiting for.
   */
  const attempt = React.useRef<{
    startedAt: number;
    ref: string;
    cap: Capture | null;
    label: string | null;
    /**
     * Re-entry guards, on the attempt rather than in state: the browser's own
     * location button can fire two of its events for one tap, both inside one
     * render, and `busy` would read false for both. Two sends of one punch
     * would race on its reference and the loser would come back as an error.
     */
    asking?: boolean;
    sending?: boolean;
  } | null>(null);

  /** Server state, with any punch still queued on this phone laid over it. */
  const refresh = React.useCallback(async () => {
    try {
      const st = await api.clockState();
      setLinked(st.linked);
      setExpected(st.expected_minutes ?? null);
      setDeviceKnown(st.device ? st.device.known : null);
      const q = st.linked ? queuedPunch() : null;
      if (q) {
        setPunch(q.state === "in" ? q.row : null);
        // A clock-out still queued on this device: the shift the server thinks
        // is open is, as far as this person is concerned, done.
        if (q.state === "out") {
          setDone((d) => d ?? (st.open ? { ...st.open, clock_out_at: q.at } : st.done));
        }
      } else {
        setPunch(st.open);
        setDone(st.open ? null : st.done);
        setUndoUntil(st.undo_until ? new Date(st.undo_until).getTime() : null);
      }
    } catch (e) {
      /*
       * Offline is not "not an employee". Treating every failure as unlinked
       * would turn the one case the outbox exists for, punching in a dead zone,
       * into a missing clock, which is exactly the kind of thing that must
       * never stop a clock-in. Only an answer from the server can say the
       * person is not an employee; anything else keeps what we knew, and
       * assumes they can punch when we knew nothing.
       */
      const q = queuedPunch();
      if (q) setPunch(q.state === "in" ? q.row : null);
      if (isNetworkError(e)) setLinked((prev) => prev ?? true);
      else setLinked((prev) => (q ? true : prev ?? false));
    }
  }, []);

  React.useEffect(() => {
    if (!enabled) return;
    void refresh();
    // A queued punch going out (or being refused) changes what the clock shows,
    // and so does midnight: a periodic re-read is what unlocks tomorrow.
    const id = setInterval(() => void refresh(), 5 * 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    const stopOutbox = subscribeOutbox(() => void refresh());
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      stopOutbox();
    };
  }, [enabled, refresh]);

  // The Undo offer disappears by itself when its two minutes are up.
  React.useEffect(() => {
    if (!undoUntil) return;
    const left = undoUntil - Date.now();
    if (left <= 0) {
      setUndoUntil(null);
      return;
    }
    const id = setTimeout(() => setUndoUntil(null), left);
    return () => clearTimeout(id);
  }, [undoUntil]);

  /*
   * Location permission, watched — never asked for.
   *
   * `permissions.query` reads the state without prompting, so this is the quiet
   * check on every app open. It starts only once we know the person is an
   * employee: the old clock started a high-accuracy watch on page load for
   * EVERY signed-in user, and a location request nobody tapped for is the kind
   * browsers quietly turn down and, after a few dismissals, block on their own.
   *
   * Nothing is SHOWN from here any more. The app-open cards this used to raise
   * appeared before anybody had reached for the clock, covered the toolbar, and
   * on a phone could not be acted on; the clock-in dialog asks at the tap.
   */
  React.useEffect(() => {
    if (!enabled || !linked) return;
    let live = true;
    const stop = watchGeoPermission((s) => {
      if (!live) return;
      setPermission(s);
      setLocationPermission(s);
      if (s === "granted") warmGps();
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") warmGps();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      stop();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, linked]);

  const phase: ClockPhase =
    linked === null ? "loading"
      : linked === false ? "unlinked"
        : punch && !punch.clock_out_at ? "on"
          : done ? "done"
            : "in";

  /**
   * A reading that missed the punch, attached when it lands.
   *
   * Addressed by the punch's `client_ref`, so it works for a punch that was
   * queued offline and has no server id yet. Through the outbox too, so a
   * reading that lands in a dead zone follows the punch out instead of being
   * dropped. A reading that lands quietly stays quiet; one that never lands,
   * or cannot be attached, is SAID (owner's rule: no failure out of sight),
   * because it changes what the punch shows: Location Not Verified.
   */
  const follow = React.useCallback(
    async (late: Promise<LateResult>, target: { client_ref?: string; attendance_id?: string; phase: "in" | "out" }) => {
      const r = await late;
      if (r.fix) {
        try {
          await api.attachFix({
            ...target,
            latitude: r.fix.latitude,
            longitude: r.fix.longitude,
            accuracy: r.fix.accuracy,
            fix_at: new Date(r.fix.at).toISOString(),
          });
        } catch {
          toast.info(i18n.t("hr.clockedInUnverified"));
        }
        return;
      }
      if (target.phase === "in") toast.info(i18n.t("hr.clockedInUnverified"));
    },
    [toast],
  );

  /** The two refusals that are not refusals: the clock was simply out of date. */
  async function handleRefusal(e: unknown) {
    const code = e instanceof ApiError ? e.code : "";
    if (code === "ALREADY_CLOCKED_IN" || code === "NO_OPEN_SHIFT" || code === "SHIFT_DONE_TODAY") {
      await refresh();
      toast.info(
        code === "ALREADY_CLOCKED_IN"
          ? i18n.t("hr.alreadyIn")
          : code === "NO_OPEN_SHIFT"
            ? i18n.t("hr.alreadyOut")
            : i18n.t("hr.shiftDoneToday"),
      );
      return;
    }
    toast.error(e instanceof Error ? e.message : i18n.t("hr.punchFailed"));
  }

  /**
   * The tap on Clock In. Straight to the punch when location is available and
   * the device is known; otherwise the dialog opens on the first thing that
   * needs the person, and the punch waits for them.
   */
  async function clockIn() {
    if (phase !== "in" || busy) return;
    const a: NonNullable<typeof attempt.current> = { startedAt: Date.now(), ref: newRef(), cap: null, label: null };
    attempt.current = a;
    // Known blocked: a reading would fail at once, so ask without trying.
    if (permission === "denied") {
      setStep({ kind: "location", cause: "denied", attempts: 0 });
      return;
    }
    // Never asked on this device: say what the browser is about to ask, first.
    if (permission === "prompt" && !readFlag(LOCATION_OK_KEY)) {
      setStep({ kind: "location", cause: "prompt", attempts: 0 });
      return;
    }
    setBusy(true);
    const cap = await captureForPunch();
    if (attempt.current !== a) return;
    if (!cap.fix && cap.error && FIXABLE.has(cap.error)) {
      setBusy(false);
      setStep({ kind: "location", cause: cap.error as LocationAsk, attempts: 0 });
      return;
    }
    await afterLocation(cap);
  }

  /**
   * From the dialog: ask the browser for location on this tap (the prompt, or
   * a retry after the person changed a setting). A tap is what browsers treat
   * as wanted, and on the browser's own `<geolocation>` button it can even
   * re-ask a blocked site.
   */
  async function retryLocation() {
    const a = attempt.current;
    if (!a || a.asking || a.sending) return;
    a.asking = true;
    setBusy(true);
    const err = await askForLocation().finally(() => {
      a.asking = false;
    });
    if (attempt.current !== a) return;
    if (!err) {
      // The reading `askForLocation` took is fresh, so this returns at once.
      const cap = await captureForPunch();
      if (attempt.current !== a) return;
      await afterLocation(cap);
      return;
    }
    setBusy(false);
    const cause: LocationAsk = err === "denied" || err === "os_off" ? err : "unavailable";
    setStep((prev) => ({
      kind: "location",
      cause,
      attempts: (prev && prev.kind === "location" ? prev.attempts : 0) + 1,
    }));
  }

  /** From the dialog: punch now, recorded as Location Not Verified, saying why. */
  function withoutLocation() {
    const cause = step && step.kind === "location" ? step.cause : null;
    // `prompt` is not a failure: nothing was refused, the person chose not to
    // be asked. The punch carries no reason rather than a wrong one.
    const why: LocationError | null = cause && cause !== "prompt" ? cause : null;
    void afterLocation({ fix: null, error: why, late: NO_LATE });
  }

  /** Location is settled one way or the other: the device next, then the punch. */
  async function afterLocation(cap: Capture) {
    const a = attempt.current;
    if (!a) return;
    a.cap = cap;
    if (cap.fix) writeFlag(LOCATION_OK_KEY);
    if (deviceKnown === false && !a.label) {
      setBusy(false);
      setStep({ kind: "device" });
      return;
    }
    await send();
  }

  /** From the dialog: the new device's name. It rides with the punch. */
  function nameDevice(label: string) {
    const a = attempt.current;
    if (!a) return;
    a.label = label;
    void send();
  }

  /** Send the punch, and say how it went. Try Again resends the same one. */
  async function send() {
    const a = attempt.current;
    if (!a || !a.cap || a.sending) return;
    a.sending = true;
    const cap = a.cap;
    setBusy(true);
    const tappedAt = new Date(Date.now() - a.startedAt <= TAP_HOLD_MS ? a.startedAt : Date.now()).toISOString();
    let following = false;
    try {
      // The device rides with the punch, not as a separate registration call,
      // and its name with it on the first punch from it: the server puts the
      // row down at every policy, so there is always one for a manager to see.
      const device = api.deviceInfo();
      const r = await api.punchIn({
        ...(cap.fix || {}),
        device: device
          ? {
              ...device,
              ...(a.label ? { label: a.label } : {}),
              ...(permission ? { location_permission: permission } : {}),
            }
          : null,
        // The same reference on every try: a resend of a punch that did land
        // is answered with that punch, not refused as a second one.
        client_ref: a.ref,
        tapped_at: tappedAt,
        ...(cap.error ? { location_error: cap.error } : {}),
      });
      if (attempt.current === a) attempt.current = null;
      setStep(null);
      setDone(null);
      setUndoUntil(null);
      if (device) setDeviceKnown(true);
      if (r.status === "queued") {
        setPunch({ attendance_id: `queued:${a.ref}`, client_ref: a.ref, clock_in_at: tappedAt, punched_offline: true });
        toast.info(i18n.t("hr.savedOffline"));
      } else {
        const row = r.data;
        setPunch(row);
        if (row.review_status === "PENDING") toast.info(i18n.t("hr.clockedInHeld"));
        else if (row.within_geofence === false || row.location_status === "off_site") {
          toast.info(i18n.t("hr.clockedInOffSite"));
        } else if (!cap.fix && cap.error !== "timeout") {
          toast.info(i18n.t("hr.clockedInUnverified"));
        }
      }
      following = !cap.fix && cap.error === "timeout";
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      if (code === "ALREADY_CLOCKED_IN" || code === "NO_OPEN_SHIFT" || code === "SHIFT_DONE_TODAY") {
        if (attempt.current === a) attempt.current = null;
        setStep(null);
        await handleRefusal(e);
      } else {
        // In the dialog, with the reason and Try Again. A toast that faded
        // over a toolbar is how "No permission for MOD-14.create" went unread.
        setStep({ kind: "failed", message: e instanceof Error && e.message ? e.message : i18n.t("hr.punchFailed") });
      }
    } finally {
      a.sending = false;
      setBusy(false);
    }
    if (following) void follow(cap.late, { client_ref: a.ref, phase: "in" });
  }

  /** The dialog was closed: the attempt is dropped and nothing is sent. */
  function cancelClockIn() {
    attempt.current = null;
    setStep(null);
    setBusy(false);
  }

  /** Clock out, after the person confirmed it in the dialog. */
  async function clockOut() {
    if (phase !== "on" || busy || !punch) return;
    setBusy(true);
    const shift = punch;
    const tappedAt = new Date().toISOString();
    const cap = await captureForPunch();
    const coords = cap.fix ? { latitude: cap.fix.latitude, longitude: cap.fix.longitude } : {};
    const finding = !cap.fix && cap.error === "timeout";
    let following = false;
    try {
      const r = await api.punchOut({ ...coords, tapped_at: tappedAt });
      setConfirming(false);
      setPunch(null);
      setDone(r.status === "sent" ? r.data : { ...shift, clock_out_at: tappedAt });
      setUndoUntil(Date.now() + UNDO_MS);
      if (r.status === "queued") toast.info(i18n.t("hr.savedOffline"));
      following = finding;
    } catch (e) {
      setConfirming(false);
      await handleRefusal(e);
    } finally {
      setBusy(false);
    }
    const target = shift.client_ref
      ? { client_ref: shift.client_ref }
      : !shift.attendance_id.startsWith("queued:")
        ? { attendance_id: shift.attendance_id }
        : null;
    if (following && target) void follow(cap.late, { ...target, phase: "out" });
  }

  /** The two-minute Undo: the shift runs again, as if it had not been closed. */
  async function undo() {
    if (phase !== "done" || busy) return;
    setBusy(true);
    try {
      const row = await api.undoClockOut();
      setPunch(row);
      setDone(null);
      setUndoUntil(null);
    } catch (e) {
      setUndoUntil(null);
      const code = e instanceof ApiError ? e.code : "";
      if (code === "UNDO_EXPIRED" || code === "NOTHING_TO_UNDO") {
        toast.info(e instanceof Error ? e.message : i18n.t("hr.punchFailed"));
        await refresh();
      } else {
        await handleRefusal(e);
      }
    } finally {
      setBusy(false);
    }
  }

  return {
    phase,
    busy,
    /** The open shift (phase `on`) or today's finished one (phase `done`). */
    shift: phase === "on" ? punch : phase === "done" ? done : null,
    expectedMinutes: expected,
    canUndo: phase === "done" && !!undoUntil && undoUntil > Date.now(),
    clockIn,
    confirming,
    askClockOut: () => {
      if (phase === "on") setConfirming(true);
    },
    cancelClockOut: () => setConfirming(false),
    clockOut,
    undo,
    /** The clock-in dialog: its step, and what each of its buttons does. */
    step,
    cancelClockIn,
    retryLocation,
    withoutLocation,
    nameDevice,
    tryAgain: () => void send(),
    /** The person reached for the clock: warm the GPS for the tap that follows. */
    warm: () => warmGps(),
  };
}

/** The clock-in dialog, wired to one clock. Rendered once per shell, like the clock-out one. */
function ClockInFlow({ clock }: { clock: ClockState }) {
  return (
    <ClockInDialog
      step={clock.step}
      busy={clock.busy}
      onCancel={clock.cancelClockIn}
      onRetryLocation={() => void clock.retryLocation()}
      onWithoutLocation={clock.withoutLocation}
      onNameDevice={clock.nameDevice}
      onTryAgain={clock.tryAgain}
    />
  );
}

/** The running time since clock-in, ticking each second. */
function Elapsed({ since }: { since: string | null | undefined }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <>{timerFmt(since ? now - new Date(since).getTime() : 0)}</>;
}

/**
 * The clock-out question: how long, against what, from where, on what.
 *
 * Deliberately short. One figure, one bar, two facts, two buttons. The time is
 * worked so far, measured to the moment the dialog opened; the bar fills
 * against the day's target from the person's own schedule, and there is no bar
 * on a day with no target.
 */
function ClockOutDialog({ clock }: { clock: ClockState }) {
  const shift = clock.shift;
  const worked = minutesBetween(shift?.clock_in_at, new Date());
  const target = clock.expectedMinutes;
  const pct = target ? Math.min(100, Math.round((worked / target) * 100)) : 0;
  const short = !!target && worked < target;
  return (
    <Dialog
      open={clock.confirming}
      onClose={clock.cancelClockOut}
      title={i18n.t("hr.clockOutQuestion")}
      footer={
        <>
          <Button variant="outline" onClick={clock.cancelClockOut} disabled={clock.busy}>
            {i18n.t("common.cancel")}
          </Button>
          <Button onClick={() => void clock.clockOut()} loading={clock.busy}>
            {i18n.t("hr.clockOutButton")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="num text-3xl font-semibold text-foreground">
            {hoursFmt(worked)}
            {target ? (
              <span className="num ml-2 text-lg font-normal text-[rgb(var(--ink-3))]">
                {i18n.t("hr.ofTarget", { target: hoursFmt(target) })}
              </span>
            ) : null}
          </p>
          {target ? (
            <div
              className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-label={i18n.t("hr.ofTarget", { target: hoursFmt(target) })}
            >
              <div
                className={cn("h-full rounded-full", short ? "bg-warn-fill" : "bg-ok-fill")}
                style={{ width: `${pct}%` }}
              />
            </div>
          ) : null}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-[rgb(var(--ink-3))]">{i18n.t("hr.locationCaption")}</dt>
          <dd className="text-foreground">{shift?.geo_label || i18n.t("hr.notRecorded")}</dd>
          <dt className="text-[rgb(var(--ink-3))]">{i18n.t("hr.deviceCaption")}</dt>
          <dd className="text-foreground">{shift?.device_label || i18n.t("hr.thisDevice")}</dd>
        </dl>
      </div>
    </Dialog>
  );
}

/**
 * The one control, in its three faces. Both homes render this — the title bar
 * on desktop, the floating toolbar on a phone — so they cannot drift apart.
 */
function ClockPill({ clock, touch = false }: { clock: ClockState; touch?: boolean }) {
  const shape = touch
    ? "h-11 rounded-full px-4 text-sm shadow-lg bg-card"
    : "h-9 rounded-md px-3 text-xs";
  const base = cn(
    "inline-flex items-center justify-center border font-semibold tabular-nums transition-colors disabled:cursor-not-allowed",
    shape,
  );

  if (clock.phase === "in") {
    return (
      <button
        type="button"
        onClick={() => void clock.clockIn()}
        onPointerEnter={clock.warm}
        onFocus={clock.warm}
        disabled={clock.busy}
        className={cn(base, "border-input text-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-60")}
      >
        {i18n.t("hr.clockInButton")}
      </button>
    );
  }

  if (clock.phase === "on") {
    return (
      <button
        type="button"
        onClick={clock.askClockOut}
        onPointerEnter={clock.warm}
        onFocus={clock.warm}
        disabled={clock.busy}
        // Named with the state, not just the digits: a screen-reader user
        // should hear that tapping clocks them out.
        aria-label={`${i18n.t("hr.clockOutButton")}. ${i18n.t("hr.onTheClock")}`}
        className={cn(base, "border-[rgb(var(--ok)_/_0.4)] text-[rgb(var(--ok))] hover:bg-accent disabled:opacity-60")}
      >
        <Elapsed since={clock.shift?.clock_in_at} />
      </button>
    );
  }

  if (clock.phase === "done") {
    const worked = minutesBetween(clock.shift?.clock_in_at, clock.shift?.clock_out_at);
    return (
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          disabled
          className={cn(base, "border-input text-muted-foreground opacity-70")}
        >
          {i18n.t("hr.doneLabel")} · {hoursFmt(worked)}
        </button>
        {clock.canUndo && (
          <button
            type="button"
            onClick={() => void clock.undo()}
            className={cn(
              "rounded-md px-2 font-semibold text-primary-ink hover:underline",
              touch ? "h-11 text-sm" : "h-9 text-xs",
            )}
          >
            {i18n.t("hr.undoButton")}
          </button>
        )}
      </span>
    );
  }

  return null;
}

/**
 * Title-bar clock chip — the DESKTOP home for the punch, beside LIVE/TEST.
 *
 * Clocking in is not a "quick action" — it is a state the person is in for
 * eight hours, and the chrome should say so without being opened. The utility
 * strip is where the app already keeps the other always-true facts (which
 * environment, which account), so it belongs there.
 */
export function ClockPunchChip() {
  const clock = useClockPunch();
  if (clock.phase === "loading" || clock.phase === "unlinked") return null;

  return (
    /*
     * THE BREAKPOINT LIVES HERE, NOT ONLY ON THE BUTTON. This wrapper is a flex
     * child of a `gap-2` row, so a hidden control must take no space at all,
     * including the space BETWEEN it and its neighbour.
     */
    <span className="hidden sm:inline-flex">
      <ClockPill clock={clock} />
      {clock.ownsDialog && <ClockInFlow clock={clock} />}
      {clock.ownsDialog && <ClockOutDialog clock={clock} />}
    </span>
  );
}

/** The phone's home for the clock: the same pill, in the floating toolbar. */
export function ClockPunch() {
  const clock = useClockPunch();

  // This renders inside the toolbar only once somebody has opened it, which on
  // a phone is the moment they are about to clock in or out. Warm the GPS now.
  React.useEffect(() => {
    clock.warm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (clock.phase === "loading" || clock.phase === "unlinked") return null;

  return (
    // Nothing is anchored to the toolbar any more. Its backdrop blur is what
    // made the browser's own location button inside the old card refuse every
    // tap; the clock-in dialog is centred, with nothing blurred above it.
    <div className="flex items-center gap-2 animate-fade-in">
      {clock.ownsDialog && <ClockInFlow clock={clock} />}
      {clock.ownsDialog && <ClockOutDialog clock={clock} />}
      <ClockPill clock={clock} touch />
    </div>
  );
}
