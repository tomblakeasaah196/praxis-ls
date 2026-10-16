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
 * NOTHING STOPS THE FIRST PUNCH OF THE DAY (14403). Not a missing location, not
 * a slow GPS, not a dead network, not a tenant's `block` policy:
 *
 *   slow GPS       the tap waits at most five seconds, punches, and attaches
 *                  the reading when it lands (lib/clock-location);
 *   no location    the punch goes, carrying WHY, and the card that follows
 *                  names the actual cause, with the fix for that cause;
 *   no network     the punch is held on the phone with the moment it was
 *                  tapped and goes out by itself on reconnect (lib/outbox);
 *   block policy   the server holds the punch for a manager instead of a 422.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import * as api from "@/lib/hr-api";
import { ApiError, isNetworkError } from "@/lib/api-client";
import {
  geoRecoverySteps,
  deviceLocationSteps,
  supportsGeolocationElement,
  watchGeoPermission,
  type GeoPermission,
  type LocationError,
} from "@/lib/geo-permission";
import {
  askForLocation,
  captureForPunch,
  onWarmError,
  setLocationPermission,
  warmGps,
  type LateResult,
} from "@/lib/clock-location";
import { getOutbox, subscribeOutbox } from "@/lib/outbox";
import { openInstallUi } from "@/lib/pwa-install";
import { Callout } from "@/components/ui/callout";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { GeolocationAllow } from "@/components/geolocation-allow";
import i18n from "@/lib/i18n";

/**
 * The location card the clock is showing, if any.
 *
 * `primer` asks BEFORE the first punch, on a button the person presses — the
 * only kind of location request browsers treat as wanted. The others name a
 * cause, and only causes the person can do something about get a card at all:
 * a slow GPS (`timeout`) and a browser with no geolocation (`unsupported`) are
 * reported on the punch and to the manager, never as homework.
 *
 * `context` is where the card came from. After a punch it says the punch is
 * saved, because that is the first thing somebody wants to know; at app open
 * it says what will happen to the next one.
 */
export type LocationNotice = {
  kind: "primer" | "denied" | "os_off" | "unavailable";
  context: "punch" | "open";
};

const CARD_KINDS: ReadonlySet<LocationError> = new Set(["denied", "os_off", "unavailable"]);

/** How long after clocking out the Undo is offered. The server allows the same. */
const UNDO_MS = 2 * 60_000;

const PRIMER_KEY = "praxis.clock.locationPrimer";
const BLOCKED_SEEN_KEY = "praxis.clock.blockedShown";
const DEVICE_OFF_SEEN_KEY = "praxis.clock.deviceOffShown";

function readFlag(store: "local" | "session", key: string): boolean {
  try {
    return (store === "local" ? window.localStorage : window.sessionStorage).getItem(key) === "1";
  } catch {
    /* @silent:storage — private mode: the card may simply show again */
    return false;
  }
}
function writeFlag(store: "local" | "session", key: string): void {
  try {
    (store === "local" ? window.localStorage : window.sessionStorage).setItem(key, "1");
  } catch {
    /* @silent:storage — private mode: the card may simply show again */
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
      {/* ONE clock-out dialog for the shell. It renders into a portal, so a
          copy per surface would open twice: the title-bar chip is hidden with
          CSS on a phone, not unmounted. */}
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

/** "7h 42m", "8h", "25m". */
export function hoursFmt(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  return h ? `${h}h` : `${m}m`;
}

/** "02:14:09" — hours keep counting past 24 rather than wrapping. */
export function timerFmt(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
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
   * The device this punch just registered, when it had never been seen before.
   *
   * Held so the clock can offer "name this device?" ONCE, on the punch that
   * created it. The employee is the only person who knows the answer — a
   * manager renaming it later is guessing which of two "Windows · Chrome"
   * rows is the yard tablet — but they are also mid-clock-in, so this is an
   * offer beside a completed punch, never a gate in front of one.
   */
  const [newDevice, setNewDevice] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<LocationNotice | null>(null);
  const [permission, setPermission] = React.useState<GeoPermission | null>(null);

  /** Server state, with any punch still queued on this phone laid over it. */
  const refresh = React.useCallback(async () => {
    try {
      const st = await api.clockState();
      setLinked(st.linked);
      setExpected(st.expected_minutes ?? null);
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
   */
  React.useEffect(() => {
    if (!enabled || !linked) return;
    let live = true;
    /*
     * The case the old card got wrong. The site is allowed, so the browser has
     * nothing to fix, but the computer or phone refuses every reading (Windows
     * or macOS location services off, or the phone's switch). Caught on the
     * warm-up, so the person hears about it BEFORE they punch, once a session.
     */
    onWarmError((why) => {
      if (!live || why !== "os_off") return;
      if (!readFlag("session", DEVICE_OFF_SEEN_KEY)) {
        writeFlag("session", DEVICE_OFF_SEEN_KEY);
        setNotice((n) => n ?? { kind: "os_off", context: "open" });
      }
    });
    const stop = watchGeoPermission((s) => {
      if (!live) return;
      setPermission(s);
      setLocationPermission(s);
      if (s === "granted") {
        warmGps();
        // Granting the SITE fixes only the cards about the site. A device whose
        // own location is off is still off, and its card must stay.
        setNotice((n) => (n && (n.kind === "denied" || n.kind === "primer") ? null : n));
      }
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") warmGps();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      stop();
      onWarmError(null);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, linked]);

  /*
   * Ask before it matters. A person who has never been asked gets the primer
   * once per device; a person whose site is blocked is told once per session.
   * Both are offers beside the clock, never in front of it.
   */
  React.useEffect(() => {
    if (!enabled || !linked || notice) return;
    if (permission === "prompt" && !readFlag("local", PRIMER_KEY)) {
      setNotice({ kind: "primer", context: "open" });
    } else if (permission === "denied" && !readFlag("session", BLOCKED_SEEN_KEY)) {
      writeFlag("session", BLOCKED_SEEN_KEY);
      setNotice({ kind: "denied", context: "open" });
    }
    // `notice` is read, not watched: dismissing a card must not re-raise it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, linked, permission]);

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
   * dropped. Silent either way: the clock shows a state, not a commentary.
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
          /* @silent:teardown — the punch stands without it, and the server already records why it had none */
        }
        return;
      }
      if (r.error && CARD_KINDS.has(r.error)) {
        setNotice({ kind: r.error as LocationNotice["kind"], context: "punch" });
      }
    },
    [],
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

  /** Clock in: no confirmation, straight to the timer. */
  async function clockIn() {
    if (phase !== "in" || busy) return;
    setBusy(true);
    if (notice?.kind === "primer") setNotice(null);
    const tappedAt = new Date().toISOString();
    const cap = await captureForPunch();
    const finding = !cap.fix && cap.error === "timeout";
    const ref = newRef();
    let following = false;
    try {
      // The device rides with the punch, not as a separate registration call:
      // registering has to happen on first use or a tenant on `block` would
      // have nothing to hold — the server puts the row down either way.
      const device = api.deviceInfo();
      const r = await api.punchIn({
        ...(cap.fix || {}),
        device: device
          ? { ...device, ...(permission ? { location_permission: permission } : {}) }
          : null,
        client_ref: ref,
        tapped_at: tappedAt,
        ...(cap.error ? { location_error: cap.error } : {}),
      });
      setDone(null);
      setUndoUntil(null);
      if (r.status === "queued") {
        setPunch({ attendance_id: `queued:${ref}`, client_ref: ref, clock_in_at: tappedAt, punched_offline: true });
        toast.info(i18n.t("hr.savedOffline"));
      } else {
        const row = r.data;
        setPunch(row);
        // Offered only on the punch that created the row — `device_new` is
        // transient and true exactly once, so this cannot become a nag.
        if (row.device_new && row.hr_device_id) setNewDevice(row.hr_device_id);
        if (row.review_status === "PENDING") toast.info(i18n.t("hr.clockedInHeld"));
        else if (row.within_geofence === false || row.location_status === "off_site") {
          toast.info(i18n.t("hr.clockedInOffSite"));
        }
      }
      following = finding;
      if (cap.error && CARD_KINDS.has(cap.error)) {
        setNotice({ kind: cap.error as LocationNotice["kind"], context: "punch" });
      }
    } catch (e) {
      await handleRefusal(e);
    } finally {
      setBusy(false);
    }
    if (following) void follow(cap.late, { client_ref: ref, phase: "in" });
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
    newDevice,
    dismissNewDevice: () => setNewDevice(null),
    notice,
    dismissNotice: () => {
      if (notice?.kind === "primer") writeFlag("local", PRIMER_KEY);
      setNotice(null);
    },
    replaceNotice: (n: LocationNotice | null) => setNotice(n),
    /** The person reached for the clock: warm the GPS for the tap that follows. */
    warm: () => warmGps(),
  };
}

/**
 * The location card: ask first, or name what is wrong and how to fix it.
 *
 * Each cause has its own way out, and the card offers only that one:
 *
 *   primer       a button that puts the browser's own prompt up, on a tap;
 *   denied       the browser's `<geolocation>` button where it exists (one tap,
 *                even after a block), otherwise the site-settings steps;
 *   os_off       the phone's own Location switch, which no browser can flip;
 *   unavailable  nothing is blocked, so just Retry.
 */
function LocationNoticeCard({
  notice,
  onDone,
  onReplace,
}: {
  notice: LocationNotice;
  onDone: () => void;
  onReplace: (n: LocationNotice | null) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const native = notice.kind === "denied" && supportsGeolocationElement();
  const steps = React.useMemo(
    () =>
      notice.kind === "denied" && !native
        ? geoRecoverySteps()
        : notice.kind === "os_off" || notice.kind === "unavailable"
          ? // "Unavailable" with the site allowed is, more often than not, the
            // same system switch. The steps are harmless when it is not.
            deviceLocationSteps()
          : [],
    [notice.kind, native],
  );

  async function retry() {
    setBusy(true);
    const err = await askForLocation();
    setBusy(false);
    if (!err) {
      warmGps();
      onReplace(null);
      return;
    }
    // A different answer than the one this card was raised for is a different
    // card: allowing the site and finding the phone's switch off is progress.
    const next = err === "denied" || err === "os_off" || err === "unavailable" ? err : "unavailable";
    if (next !== notice.kind) onReplace({ kind: next, context: notice.context });
  }

  const title =
    notice.kind === "primer"
      ? i18n.t("hr.locationPrimerLead")
      : notice.kind === "denied"
        ? i18n.t("hr.locationBlockedLead")
        : notice.kind === "os_off"
          ? i18n.t("hr.locationDeviceOffLead")
          : i18n.t("hr.locationUnavailableLead");
  const body =
    notice.kind === "primer"
      ? i18n.t("hr.locationPrimerBody")
      : notice.context === "punch"
        ? i18n.t("hr.locationSavedBody")
        : i18n.t("hr.locationNextBody");

  return (
    <div className="w-80 space-y-2 rounded-lg border bg-popover p-3 shadow-[var(--shadow-l)]">
      <Callout tone={notice.kind === "primer" ? "info" : "warn"} title={title}>
        {body}
      </Callout>
      {steps.length > 0 && (
        <ol className="list-decimal space-y-0.5 pl-5 text-xs text-foreground">
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      )}
      {native && (
        <div className="flex justify-center py-1">
          <GeolocationAllow onSettled={() => void retry()} />
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {notice.kind === "primer" ? i18n.t("hr.notNow") : i18n.t("hr.restoreLater")}
        </button>
        {notice.kind === "denied" && !native && (
          <button
            type="button"
            onClick={() => openInstallUi()}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {i18n.t("hr.installTheApp")}
          </button>
        )}
        <button
          type="button"
          onClick={() => void retry()}
          disabled={busy}
          className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy
            ? i18n.t("hr.checkingLocation")
            : notice.kind === "primer"
              ? i18n.t("hr.allowLocation")
              : i18n.t("hr.retryLocation")}
        </button>
      </div>
    </div>
  );
}

/**
 * "Name this device?" — offered once, beside a punch that already succeeded.
 *
 * WHY THE EMPLOYEE AND NOT THE MANAGER. The server can only derive a browser
 * category from the user agent, so every laptop in the company auto-labels
 * identically and it appends four characters of the fingerprint to keep the rows
 * distinct. Distinct is not recognisable. The person holding the device is the
 * only one who can say "my phone" or "yard tablet"; a manager renaming it later
 * is guessing which of two near-identical rows is which.
 *
 * WHY IT IS AN OFFER, NOT A STEP. They are clocking in. The punch is recorded
 * before this appears and stays recorded if they ignore it — a naming dialog in
 * front of a time clock would be dismissed by everyone in a hurry, which is
 * everyone. Skipping leaves the generated label, which the manager can still fix.
 */
function NameDeviceOffer({ deviceId, onDone }: { deviceId: string; onDone: () => void }) {
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const label = value.trim();
    if (!label) return onDone();
    setBusy(true);
    setError(null);
    try {
      await api.renameOwnDevice(deviceId, label);
      onDone();
    } catch (err) {
      // Named rather than swallowed: the punch is safe either way, but somebody
      // who typed a name and saw it vanish would reasonably think it saved.
      setError(err instanceof Error ? err.message : "Couldn't save that name.");
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={save}
      /*
       * POSITION-AGNOSTIC. The caller places it, because the two surfaces need
       * opposite anchors: the title-bar chip drops it downward, the touch
       * cluster — already pinned to the bottom of the screen — opens it upward.
       * Baking `top-full` in here would put it off-screen on a phone.
       *
       * Anchored to the control either way rather than centred as a modal: it
       * belongs to the thing that raised it, and a dialog would take the whole
       * screen for a question the person did not ask.
       */
      className="w-72 rounded-lg border bg-popover p-3 shadow-[var(--shadow-l)]"
    >
      <p className="text-sm font-medium text-foreground">Name this device</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        First time clocking in from here. A name helps your manager tell your devices apart.
      </p>
      <input
        // Focus follows a prompt the person did not ask for, so it must not
        // steal the caret from anything they were typing — it only appears
        // after their own click on the clock.
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        value={value}
        onChange={(ev) => setValue(ev.target.value)}
        maxLength={80}
        aria-label="Device name"
        placeholder="My phone, Yard tablet…"
        className="mt-2 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
      />
      {error && <p className="mt-1 text-xs text-[rgb(var(--bad))]">{error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          disabled={busy}
          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Not now
        </button>
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
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
     * `relative` so the offers can anchor to the chip — the title bar is a
     * drag region (`.wco`), and a popover that escaped this wrapper would be
     * positioned against the window rather than the control that raised it.
     *
     * THE BREAKPOINT LIVES HERE, NOT ONLY ON THE BUTTON. This wrapper is a flex
     * child of a `gap-2` row, so a hidden control must take no space at all,
     * including the space BETWEEN it and its neighbour.
     */
    <span className="relative hidden sm:inline-flex">
      <ClockPill clock={clock} />
      {clock.ownsDialog && <ClockOutDialog clock={clock} />}
      {clock.newDevice && (
        <div className="absolute right-0 top-full z-50 mt-2">
          <NameDeviceOffer deviceId={clock.newDevice} onDone={clock.dismissNewDevice} />
        </div>
      )}
      {/* `md:block`: between `sm` and `md` the floating toolbar is ALSO on
          screen and reads the same clock, and one card is enough. */}
      {clock.notice && !clock.newDevice && (
        <div className="absolute right-0 top-full z-50 mt-2 hidden md:block">
          <LocationNoticeCard notice={clock.notice} onDone={clock.dismissNotice} onReplace={clock.replaceNotice} />
        </div>
      )}
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
    // `relative`: the offers anchor to the toolbar. On touch they sit above it,
    // which is where there is room — the toolbar is at the bottom of the screen.
    <div className="relative flex items-center gap-2 animate-fade-in">
      {clock.newDevice && (
        <div className="absolute bottom-full right-0 z-50 mb-2">
          <NameDeviceOffer deviceId={clock.newDevice} onDone={clock.dismissNewDevice} />
        </div>
      )}
      {clock.notice && !clock.newDevice && (
        <div className="absolute bottom-full right-0 z-50 mb-2">
          <LocationNoticeCard notice={clock.notice} onDone={clock.dismissNotice} onReplace={clock.replaceNotice} />
        </div>
      )}
      {clock.ownsDialog && <ClockOutDialog clock={clock} />}
      <ClockPill clock={clock} touch />
    </div>
  );
}
