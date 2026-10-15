/**
 * Where the person is when they tap the clock — fast, honest, and never in the
 * way of the punch (14403).
 *
 * WHAT WAS WRONG. The clock started the GPS cold AT the tap, waited up to ten
 * seconds for a high-accuracy reading with no cache allowed, and on any failure
 * punched with no location and told the person to unblock a permission. Indoors
 * a cold GPS routinely takes longer than ten seconds, so the commonest "Location
 * is off" was a phone whose location was fine. And separately, the clock asked
 * for location the moment any page loaded, for every signed-in user, with no
 * tap behind it, which is exactly the kind of ask browsers quietly block.
 *
 * WHAT THIS DOES INSTEAD.
 *
 *   Warm. While the app is on screen and the person has already allowed
 *   location, the GPS is kept running for a couple of minutes at a time —
 *   from opening the app, and again whenever they reach for the clock. Never
 *   when permission has not been given: that would be the page-load ask again.
 *
 *   Short wait. At the tap, a reading taken in the last ten seconds is used as
 *   is. Otherwise the clock waits AT MOST five seconds, then punches.
 *
 *   Keep listening. A punch that went without a reading keeps listening for a
 *   minute, and a reading that lands is attached to that punch afterwards. The
 *   server decides what it is worth from how late it was — inside twenty
 *   seconds it is where the tap happened; later it is shown and labelled, and
 *   decides nothing.
 *
 *   Say why. A punch with no location carries the reason, so the manager can
 *   tell a blocked site from a phone with Location off from a slow GPS.
 *
 * WHY NOT A SERVICE WORKER. Geolocation does not exist in a worker, and only a
 * visible page can ask for permission. Everything here has to live in the page.
 */
import type { Fix } from "@/lib/hr-api";
import {
  classifyGeoError,
  queryGeoPermission,
  type GeoPermission,
  type LocationError,
} from "@/lib/geo-permission";

/** The longest the tap waits for a reading before the punch goes. */
export const WAIT_MS = 5_000;
/** A reading this recent is "now". Older is last-known, which never stands in. */
export const FRESH_MS = 10_000;
/** How long a punch keeps listening for a reading after it went without one. */
export const LATE_LISTEN_MS = 60_000;
/** How long the GPS stays warm after the app opens or the clock is reached for. */
export const WARM_MS = 120_000;

/** A reading, with the moment it reached the page (not the browser's own
 *  timestamp, which some Android builds report from a cached fix). */
export type Reading = Fix & { at: number };

export type LateResult = { fix: (Fix & { at: number }) | null; error: LocationError | null };

export type Capture = {
  /** The reading to send WITH the punch, or null. */
  fix: Fix | null;
  /** Why there is no reading. Null when there is one. */
  error: LocationError | null;
  /**
   * Resolves when the reading that missed the punch finally lands (or does
   * not). Already resolved when there is nothing to wait for.
   */
  late: Promise<LateResult>;
};

let last: Reading | null = null;
let watchId: number | null = null;
let warmTimer: ReturnType<typeof setTimeout> | null = null;
let permission: GeoPermission | null = null;
const listeners = new Set<(r: Reading) => void>();
let warmErrorListener: ((e: LocationError) => void) | null = null;

/**
 * Hear why a warm-up failed. The clock uses it for the one failure worth
 * raising BEFORE anybody taps: the site is allowed and the device itself says
 * no (`os_off` — Windows or macOS location services, or the phone's switch).
 * That is the case where the old card sent people to a site permission that
 * was already granted, so catching it at app open is the whole point.
 */
export function onWarmError(fn: ((e: LocationError) => void) | null): void {
  warmErrorListener = fn;
}

function geo(): Geolocation | null {
  return typeof navigator !== "undefined" && navigator.geolocation ? navigator.geolocation : null;
}

function record(p: GeolocationPosition): Reading {
  const r: Reading = {
    latitude: p.coords.latitude,
    longitude: p.coords.longitude,
    accuracy: p.coords.accuracy,
    at: Date.now(),
  };
  last = r;
  listeners.forEach((l) => l(r));
  return r;
}

const toFix = (r: Reading): Fix => ({ latitude: r.latitude, longitude: r.longitude, accuracy: r.accuracy });

/** What the permission watcher last said. Warming is only ever done on `granted`. */
export function setLocationPermission(p: GeoPermission | null): void {
  permission = p;
  if (p !== "granted") stopWarm();
}

/**
 * Keep the GPS running for `ms`, so the next tap finds a fresh reading.
 *
 * A no-op unless location is ALREADY granted and the page is visible: warming
 * must never be the thing that triggers a permission prompt, and a hidden tab
 * holding the GPS open is a battery drain nobody asked for.
 */
export function warmGps(ms = WARM_MS): void {
  const g = geo();
  if (!g || permission !== "granted") return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  if (watchId === null) {
    // A slow or unavailable warm-up is not reported: it costs nothing, and the
    // tap that follows asks again and is the one that says why. A device-level
    // refusal is, because nothing the person does in the browser will fix it.
    // `refused` because a browser may report the error before `watchPosition`
    // has even returned the id there would be to clear.
    let refused = false;
    watchId = g.watchPosition(
      (p) => record(p),
      (err) => {
        const why = classifyGeoError(err, permission);
        if (why === "os_off") {
          refused = true;
          if (watchId !== null) stopWarm();
          warmErrorListener?.(why);
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: LATE_LISTEN_MS },
    );
    if (refused) {
      stopWarm();
      return;
    }
  }
  if (warmTimer) clearTimeout(warmTimer);
  warmTimer = setTimeout(stopWarm, ms);
}

export function stopWarm(): void {
  if (warmTimer) clearTimeout(warmTimer);
  warmTimer = null;
  const g = geo();
  if (watchId !== null && g) {
    try {
      g.clearWatch(watchId);
    } catch {
      /* @silent:teardown — the watch is already gone; nothing to report */
    }
  }
  watchId = null;
}

/**
 * Get a reading for a punch the person has just tapped.
 *
 * The tap is a user gesture, so when permission has never been asked this is
 * also what puts the browser's own prompt in front of them — on a tap, which
 * is the only moment browsers treat a location request as wanted.
 */
export async function captureForPunch(): Promise<Capture> {
  const g = geo();
  const nothing: Promise<LateResult> = Promise.resolve({ fix: null, error: null });
  if (!g) return { fix: null, error: "unsupported", late: nothing };

  const fresh = last && Date.now() - last.at <= FRESH_MS ? last : null;
  if (fresh) return { fix: toFix(fresh), error: null, late: nothing };

  type Outcome = { reading: Reading } | { err: unknown };
  const settled = new Promise<Outcome>((resolve) => {
    let done = false;
    const finish = (o: Outcome) => {
      if (done) return;
      done = true;
      listeners.delete(onWarm);
      resolve(o);
    };
    // A warm watch already running may land first; take whichever does.
    const onWarm = (r: Reading) => finish({ reading: r });
    listeners.add(onWarm);
    try {
      g.getCurrentPosition(
        (p) => finish({ reading: record(p) }),
        (err) => finish({ err }),
        { enableHighAccuracy: true, maximumAge: FRESH_MS, timeout: LATE_LISTEN_MS },
      );
    } catch (err) {
      finish({ err });
    }
  });

  const waited = await Promise.race([
    settled,
    new Promise<"wait">((resolve) => setTimeout(() => resolve("wait"), WAIT_MS)),
  ]);

  if (waited !== "wait") {
    if ("reading" in waited) return { fix: toFix(waited.reading), error: null, late: nothing };
    const perm = await queryGeoPermission();
    return { fix: null, error: classifyGeoError(waited.err, perm), late: nothing };
  }

  // Five seconds and nothing. The punch goes now; the reading follows it.
  const late = settled.then(async (o): Promise<LateResult> => {
    if ("reading" in o) return { fix: { ...toFix(o.reading), at: o.reading.at }, error: null };
    const perm = await queryGeoPermission();
    return { fix: null, error: classifyGeoError(o.err, perm) };
  });
  return { fix: null, error: "timeout", late };
}

/**
 * Ask for location now, from a button the person pressed (the primer card,
 * Retry). Resolves with the reason it failed, or null when it worked.
 */
export async function askForLocation(): Promise<LocationError | null> {
  const g = geo();
  if (!g) return "unsupported";
  return new Promise((resolve) => {
    try {
      g.getCurrentPosition(
        (p) => {
          record(p);
          resolve(null);
        },
        async (err) => {
          const perm = await queryGeoPermission();
          resolve(classifyGeoError(err, perm));
        },
        { enableHighAccuracy: true, maximumAge: FRESH_MS, timeout: 20_000 },
      );
    } catch (err) {
      resolve(classifyGeoError(err, null));
    }
  });
}

/** Test seam: forget every reading, watch and permission this module holds. */
export function __resetClockLocationForTests(): void {
  stopWarm();
  last = null;
  permission = null;
  listeners.clear();
  warmErrorListener = null;
}
