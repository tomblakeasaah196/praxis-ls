/**
 * Clock-punch chip for the bottom-right floating cluster — THE place employees
 * clock in/out (not the Attendance screen, which is the manager view). Always
 * shows the time; tapping captures the device GPS and clocks in or out, with a
 * dot for on-shift and a transient result. Users not linked to an employee still
 * see the clock — tapping just tells them their account isn't linked.
 *
 * NOTHING STOPS A PUNCH (14403). Not a missing location, not a slow GPS, not a
 * dead network, not a tenant's `block` policy. What used to stop one, and what
 * each now does instead:
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
import { GeolocationAllow } from "@/components/geolocation-allow";
import i18n from "@/lib/i18n";

const ClockIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    width={20}
    height={20}
    aria-hidden
    {...p}
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

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
function queuedPunch(): { state: "in"; row: api.AttendanceRow } | { state: "out" } | null {
  const mine = getOutbox().filter(
    (e) => e.state === "queued" && (e.path === "/attendance/clock-in" || e.path === "/attendance/clock-out"),
  );
  const lastEntry = mine[mine.length - 1];
  if (!lastEntry) return null;
  if (lastEntry.path === "/attendance/clock-out") return { state: "out" };
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
  return <ClockContext.Provider value={state}>{children}</ClockContext.Provider>;
}

/**
 * The clock state and the punch action, without a presentation.
 *
 * Inside the shell this reads the provider. Outside one (a test, a storybook)
 * it runs its own copy, so a surface rendered on its own still works.
 */
export function useClockPunch(): ClockState {
  const shared = React.useContext(ClockContext);
  const local = useClockState(shared === null);
  return shared ?? local;
}

function useClockState(enabled: boolean) {
  const [now, setNow] = React.useState(() => new Date());
  const [punch, setPunch] = React.useState<api.AttendanceRow | null>(null);
  /** null until the server has answered: an unlinked user must never be asked for location. */
  const [linked, setLinked] = React.useState<boolean | null>(null);
  const [busy, setBusy] = React.useState(false);
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
  /** The site is allowed but the device refused a warm-up: OS location is off. */
  const [deviceOff, setDeviceOff] = React.useState(false);
  const [msg, setMsg] = React.useState<{ text: string; bad?: boolean } | null>(null);
  const msgTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = React.useCallback((text: string, bad = false, holdMs: number | null = 4000) => {
    if (msgTimer.current) clearTimeout(msgTimer.current);
    setMsg({ text, bad });
    msgTimer.current = holdMs === null ? null : setTimeout(() => setMsg(null), holdMs);
  }, []);
  React.useEffect(() => () => {
    if (msgTimer.current) clearTimeout(msgTimer.current);
  }, []);

  React.useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(id);
  }, [enabled]);

  /** Server state, with any punch still queued on this phone laid over it. */
  const refresh = React.useCallback(async () => {
    try {
      const st = await api.clockState();
      setLinked(st.linked);
      const q = st.linked ? queuedPunch() : null;
      setPunch(q ? (q.state === "in" ? q.row : null) : st.open);
    } catch (e) {
      /*
       * Offline is not "not an employee". Treating every failure as unlinked
       * would turn the one case the outbox exists for, punching in a dead zone,
       * into "your account isn't linked", which is exactly the kind of thing
       * that must never stop a clock-in. Only an answer from the server can say
       * the person is not an employee; anything else keeps what we knew, and
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
    // A queued punch going out (or being refused) changes what the clock shows.
    return subscribeOutbox(() => void refresh());
  }, [enabled, refresh]);

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
      setDeviceOff(true);
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

  const canPunch = linked !== false;
  const clockedIn = canPunch && !!punch && !punch.clock_out_at;

  /**
   * A reading that missed the punch, attached when it lands.
   *
   * Addressed by the punch's `client_ref`, so it works for a punch that was
   * queued offline and has no server id yet. Through the outbox too, so a
   * reading that lands in a dead zone follows the punch out instead of being
   * dropped.
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
          setDeviceOff(false);
          say(i18n.t("hr.locationAdded"));
        } catch {
          // The punch stands without it, and the server already records why
          // it had no location. Telling them twice adds nothing.
          setMsg(null);
        }
        return;
      }
      setMsg(null);
      if (r.error && CARD_KINDS.has(r.error)) {
        setNotice({ kind: r.error as LocationNotice["kind"], context: "punch" });
      }
    },
    [say],
  );

  async function toggle() {
    if (!canPunch) {
      say(i18n.t("hr.notLinked"), true);
      return;
    }
    setBusy(true);
    setMsg(null);
    if (notice?.kind === "primer") setNotice(null);
    const tappedAt = new Date().toISOString();
    const cap = await captureForPunch();
    if (cap.fix) setDeviceOff(false);
    const coords = cap.fix ? { latitude: cap.fix.latitude, longitude: cap.fix.longitude } : {};
    const finding = !cap.fix && cap.error === "timeout";
    let followTarget: { client_ref?: string; attendance_id?: string; phase: "in" | "out" } | null = null;
    try {
      if (clockedIn) {
        const r = await api.punchOut({ ...coords, tapped_at: tappedAt });
        const target = punch?.client_ref
          ? { client_ref: punch.client_ref }
          : punch && !punch.attendance_id.startsWith("queued:")
            ? { attendance_id: punch.attendance_id }
            : null;
        setPunch(null);
        if (r.status === "queued") say(i18n.t("hr.savedOffline"), false, 6000);
        else if (finding) say(i18n.t("hr.clockedOutFindingLocation"), false, null);
        else say(cap.fix ? i18n.t("hr.clockedOut") : i18n.t("hr.clockedOutNoLocation"), !cap.fix);
        if (finding && target) followTarget = { ...target, phase: "out" };
      } else {
        // The device rides with the punch, not as a separate registration call:
        // registering has to happen on first use or a tenant on `block` would
        // have nothing to hold — the server puts the row down either way.
        const device = api.deviceInfo();
        const ref = newRef();
        const r = await api.punchIn({
          ...(cap.fix || {}),
          device: device
            ? { ...device, ...(permission ? { location_permission: permission } : {}) }
            : null,
          client_ref: ref,
          tapped_at: tappedAt,
          ...(cap.error ? { location_error: cap.error } : {}),
        });
        if (r.status === "queued") {
          setPunch({ attendance_id: `queued:${ref}`, client_ref: ref, clock_in_at: tappedAt, punched_offline: true });
          say(i18n.t("hr.savedOffline"), false, 6000);
        } else {
          const row = r.data;
          setPunch(row);
          // Offered only on the punch that created the row — `device_new` is
          // transient and true exactly once, so this cannot become a nag.
          if (row.device_new && row.hr_device_id) setNewDevice(row.hr_device_id);
          // Unfenced (GPS, no worksite) is NOT a missing fix. Using
          // `within_geofence === null` here would nag every tenant that has not
          // placed a fence yet.
          const offSite = row.within_geofence === false || row.location_status === "off_site";
          const held = row.review_status === "PENDING";
          const noLoc = !cap.fix && !finding;
          say(
            held
              ? i18n.t("hr.clockedInHeld")
              : offSite
                ? i18n.t("hr.clockedInOffSite")
                : finding
                  ? i18n.t("hr.clockedInFindingLocation")
                  : noLoc
                    ? i18n.t("hr.clockedInNoLocation")
                    : i18n.t("hr.clockedIn"),
            offSite || noLoc || held,
            finding ? null : held ? 6000 : 4000,
          );
        }
        if (finding) followTarget = { client_ref: ref, phase: "in" };
      }
      if (cap.error && CARD_KINDS.has(cap.error)) {
        setNotice({ kind: cap.error as LocationNotice["kind"], context: "punch" });
      }
    } catch (e) {
      /*
       * The two refusals that are not refusals: the server already has this
       * person on (or off) the clock — from another device, or from a punch
       * this one queued. Nothing is wrong with them; the clock was out of date.
       */
      const code = e instanceof ApiError ? e.code : "";
      if (code === "ALREADY_CLOCKED_IN") {
        await refresh();
        say(i18n.t("hr.alreadyIn"));
      } else if (code === "NO_OPEN_SHIFT") {
        setPunch(null);
        say(i18n.t("hr.alreadyOut"));
      } else {
        say(e instanceof Error ? e.message : i18n.t("hr.punchFailed"), true, 6000);
      }
    } finally {
      setBusy(false);
    }
    if (followTarget) void follow(cap.late, followTarget);
  }

  const timeStr = now.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  // The pill states the action when off-shift ("Clock in") and only reveals the
  // timer when on-shift ("03:23 • On the clock"). The transient `msg` (off-site,
  // no location…) wins over both, because it is the result of the last punch.
  const label = msg
    ? msg.text
    : clockedIn
      ? `${timeStr} • On the clock`
      : "Clock in";
  const action = canPunch ? (clockedIn ? "Clock out" : "Clock in") : "Time";

  return {
    label, action, clockedIn, canPunch, busy, toggle, msg, timeStr,
    newDevice,
    dismissNewDevice: () => setNewDevice(null),
    notice,
    /** Location is blocked or off right now: the clock shows a small warning. */
    locationBlocked: permission === "denied" || deviceOff,
    dismissNotice: () => {
      if (notice?.kind === "primer") writeFlag("local", PRIMER_KEY);
      setNotice(null);
    },
    replaceNotice: (n: LocationNotice | null) => {
      if (n === null) setDeviceOff(false);
      setNotice(n);
    },
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

/**
 * Title-bar clock chip — the DESKTOP home for the punch, beside LIVE/TEST.
 *
 * WHY A THIRD RENDERING. The punch had two homes and neither was reachable at a
 * glance on desktop: the FAB is `md:hidden` (audit F9), and the quick-actions
 * menu hides it one click deep behind a burst icon that gives no hint a shift is
 * running. Clocking in is not a "quick action" — it is a state the person is in
 * for eight hours, and the chrome should say so without being opened. The
 * utility strip is where the app already keeps the other always-true facts
 * (which environment, which account), so it belongs there.
 *
 * The label collapses below `lg` so it cannot push the search field off the row;
 * the dot and the icon still carry on-shift/off-shift at every width.
 */
export function ClockPunchChip() {
  const {
    label, action, clockedIn, canPunch, busy, toggle, msg, newDevice, dismissNewDevice,
    notice, dismissNotice, replaceNotice, locationBlocked, warm,
  } = useClockPunch();

  return (
    /*
     * `relative` so the offers can anchor to the chip — the title bar is a
     * drag region (`.wco`), and a popover that escaped this wrapper would be
     * positioned against the window rather than the control that raised it.
     *
     * THE BREAKPOINT LIVES HERE, NOT ONLY ON THE BUTTON. This wrapper is a flex
     * child of a `gap-2` row, so while the button inside was hidden below `sm`
     * the wrapper still consumed a gap — eight pixels stolen from the title
     * bar's drag handle at 320px, which the layout gate caught as a 10px spacer
     * against a 16px floor. A hidden control must take no space at all,
     * including the space BETWEEN it and its neighbour.
     */
    <span className="relative hidden sm:inline-flex">
    <button
      type="button"
      onClick={() => {
        void toggle();
      }}
      // Reaching for the clock warms the GPS, so the tap that follows finds a
      // fresh reading instead of starting one cold.
      onPointerEnter={warm}
      onFocus={warm}
      disabled={busy}
      title={`${action} · ${label}`}
      // Named with the state, not just the verb: a screen-reader user should
      // hear whether they are on the clock without activating the control.
      aria-label={`${action}. ${clockedIn ? "On the clock" : "Not clocked in"}`}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-md border border-input px-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-60",
        clockedIn && "border-[rgb(var(--ok)_/_0.4)] text-[rgb(var(--ok))]",
        msg?.bad && "border-[rgb(var(--bad)_/_0.4)] text-[rgb(var(--bad))]",
      )}
    >
      <span className="relative inline-grid place-items-center">
        <ClockIcon width={16} height={16} />
        {canPunch && (
          <span
            aria-hidden
            className={cn(
              "absolute -right-1 -top-1 h-2 w-2 rounded-full ring-2 ring-background",
              locationBlocked ? "bg-warn-fill" : clockedIn ? "bg-ok-fill" : "bg-[rgb(var(--ink-3)/0.4)]",
            )}
          />
        )}
      </span>
      <span className="hidden text-[11px] font-semibold tabular-nums lg:inline">
        {label}
      </span>
    </button>
    {newDevice && (
      <div className="absolute right-0 top-full z-50 mt-2">
        <NameDeviceOffer deviceId={newDevice} onDone={dismissNewDevice} />
      </div>
    )}
    {/*
     * `md:block`: between `sm` and `md` the touch cluster is ALSO on screen and
     * reads the same clock, and one card is enough. Below `md` the cluster owns
     * the card; from `md` up the chip does.
     */}
    {notice && !newDevice && (
      <div className="absolute right-0 top-full z-50 mt-2 hidden md:block">
        <LocationNoticeCard notice={notice} onDone={dismissNotice} onReplace={replaceNotice} />
      </div>
    )}
    </span>
  );
}

export function ClockPunch() {
  const {
    label, action, clockedIn, canPunch, busy, toggle, msg, newDevice, dismissNewDevice,
    notice, dismissNotice, replaceNotice, locationBlocked, warm,
  } = useClockPunch();

  // This renders inside the cluster only once somebody has opened it, which on
  // a phone is the moment they are about to clock in or out. Warm the GPS now.
  React.useEffect(() => {
    warm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    // `relative` for the same reason as the chip: the offers anchor to this
    // cluster. On touch they sit above the FAB rather than below, which is
    // where there is room — the cluster is already at the bottom of the screen.
    <div className="relative flex items-center gap-2 animate-fade-in">
      {newDevice && (
        <div className="absolute bottom-full right-0 z-50 mb-2">
          <NameDeviceOffer deviceId={newDevice} onDone={dismissNewDevice} />
        </div>
      )}
      {notice && !newDevice && (
        <div className="absolute bottom-full right-0 z-50 mb-2">
          <LocationNoticeCard notice={notice} onDone={dismissNotice} onReplace={replaceNotice} />
        </div>
      )}
      <span
        className={cn(
          "rounded-md border bg-popover px-2 py-1 text-xs font-medium tabular-nums shadow-md",
          msg?.bad ? "text-[rgb(var(--bad))]" : "text-foreground",
        )}
      >
        {label}
      </span>
      <button
        onClick={toggle}
        disabled={busy}
        title={`${action} · ${label}`}
        aria-label={`${action}. ${clockedIn ? "On the clock" : "Not clocked in"}`}
        className="relative grid h-11 w-11 place-items-center rounded-full border bg-card text-foreground shadow-lg transition-colors duration-150 hover:bg-accent hover:text-primary-ink disabled:opacity-60"
      >
        <ClockIcon />
        {canPunch && (
          <span
            className={cn(
              "absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full ring-2 ring-background",
              locationBlocked ? "bg-warn-fill" : clockedIn ? "bg-ok-fill" : "bg-[rgb(var(--ink-3)/0.4)]",
            )}
          />
        )}
      </button>
    </div>
  );
}
