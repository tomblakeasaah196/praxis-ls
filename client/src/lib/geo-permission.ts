/**
 * Browser geolocation permission — the clock's recovery path.
 *
 * A punch must NEVER be blocked because this helper failed. The tenant
 * geofence policy decides whether a location-less punch is accepted; this
 * only answers "can we ask?" and "how does the person turn it back on?".
 */

export type GeoPermission = "granted" | "denied" | "prompt" | "unsupported";

/**
 * WHY a punch had no location, in the words the server stores (14403).
 *
 * The old clock had one answer for every failure, "Location is off", with the
 * steps for unblocking a site permission. Most failures were not that: a GPS
 * still warming up indoors, or the phone's own Location switch, got told to go
 * and change a permission that was already granted. Each of these has a
 * different fix, and two of them have no fix the person can make at all.
 *
 *   denied       the site is blocked in the browser (or the prompt was dismissed)
 *   os_off       the site is allowed, but the phone or the browser app is not
 *   unavailable  the browser could not work out a position
 *   timeout      no reading arrived in time (usually a cold GPS indoors)
 *   unsupported  this browser has no geolocation at all
 */
export type LocationError = "denied" | "os_off" | "unavailable" | "timeout" | "unsupported";

/**
 * Turn a GeolocationPositionError into a reason, using the permission state to
 * split the one case the error code cannot: PERMISSION_DENIED while the site
 * permission reads `granted` means something BELOW the browser said no — the
 * phone's Location switch, or the OS permission for the browser app itself.
 */
export function classifyGeoError(err: unknown, permission: GeoPermission | null): LocationError {
  const e = err as { code?: number; message?: string } | null;
  const code = e && typeof e.code === "number" ? e.code : null;
  const denied = code === 1 || (code === null && /denied/i.test(String(e?.message || "")));
  if (denied) return permission === "granted" ? "os_off" : "denied";
  if (code === 3) return "timeout";
  return "unavailable";
}

/**
 * Does this browser have the `<geolocation>` element (Chromium 144+)?
 *
 * It matters because it is the ONLY way back from a blocked site that does not
 * send the person into settings: the browser draws the button itself, so a tap
 * on it is trusted enough to ask again even after a block. Scripts cannot do
 * that — `getCurrentPosition` on a blocked site fails at once, and no API,
 * service worker included, can re-ask.
 */
export function supportsGeolocationElement(): boolean {
  return typeof window !== "undefined" && "HTMLGeolocationElement" in window;
}

export async function queryGeoPermission(): Promise<GeoPermission> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return "unsupported";
  }
  const perms = navigator.permissions;
  if (!perms || typeof perms.query !== "function") return "prompt";
  try {
    const status = await perms.query({ name: "geolocation" as PermissionName });
    const s = status.state;
    if (s === "granted" || s === "denied" || s === "prompt") return s;
    return "prompt";
  } catch {
    // Safari (and some embedded webviews) reject the query. Treat as prompt so
    // the next getCurrentPosition is what actually asks.
    return "prompt";
  }
}

/**
 * Keep the OS permission warm after grant, and notice a mid-shift revoke.
 *
 * Does NOT return coordinates for a punch — last-known must never become this
 * punch's location. Success is a no-op; PERMISSION_DENIED is the signal.
 */
export function watchGeoFix(onDenied: () => void): () => void {
  if (typeof navigator === "undefined" || !navigator.geolocation?.watchPosition) {
    return () => undefined;
  }
  const id = navigator.geolocation.watchPosition(
    () => undefined,
    (err) => {
      if (err && (err.code === 1 || /denied/i.test(String(err.message || "")))) onDenied();
    },
    { enableHighAccuracy: true, maximumAge: 60_000, timeout: 20_000 },
  );
  return () => {
    try {
      navigator.geolocation.clearWatch(id);
    } catch {
      /* @silent:teardown — the watch is already gone; nothing to report */
    }
  };
}

export function watchGeoPermission(onChange: (state: GeoPermission) => void): () => void {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return () => undefined;
  }
  let cancelled = false;
  let stop: (() => void) | null = null;
  void navigator.permissions
    .query({ name: "geolocation" as PermissionName })
    .then((status) => {
      if (cancelled) return;
      const emit = () => {
        const s = status.state;
        onChange(s === "granted" || s === "denied" || s === "prompt" ? s : "prompt");
      };
      emit();
      status.addEventListener("change", emit);
      stop = () => status.removeEventListener("change", emit);
    })
    .catch(() => {
      /*
       * Safari and some embedded webviews reject the geolocation query. Not a
       * silent case: leaving the caller with no state at all is what paints a
       * working clock as broken. Emit the same answer `queryGeoPermission`
       * gives on the same rejection — "prompt" — so the one browser that
       * cannot be watched still starts from a defined state, and the next
       * getCurrentPosition is what actually asks.
       */
      if (!cancelled) onChange("prompt");
    });
  return () => {
    cancelled = true;
    stop?.();
  };
}

/**
 * Steps for when the SITE is allowed but the DEVICE is not (`os_off`).
 *
 * This is the case behind "the site says Allow and the card still appears":
 * Chrome on Windows and macOS asks the operating system for a position, and
 * when the system's location services are off (or off for the browser) the
 * site permission is granted and every reading still fails. Nothing in the
 * browser fixes that, so the steps name the system setting by its real name.
 */
export function deviceLocationSteps(ua = typeof navigator === "undefined" ? "" : navigator.userAgent): string[] {
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return [
      "Open Settings, then Privacy & Security.",
      "Turn on Location Services, and allow it for your browser.",
      "Come back here and tap Retry.",
    ];
  }
  if (/Android/i.test(ua)) {
    return [
      "Swipe down from the top of the screen.",
      "Tap Location to turn it on.",
      "Come back here and tap Retry.",
    ];
  }
  if (/Windows/i.test(ua)) {
    return [
      "Open Windows Settings, then Privacy & security, then Location.",
      "Turn on Location services and Let desktop apps access your location.",
      "Come back here and tap Retry.",
    ];
  }
  if (/Mac OS X|Macintosh/i.test(ua)) {
    return [
      "Open System Settings, then Privacy & Security, then Location Services.",
      "Turn on Location Services, and turn it on for your browser.",
      "Come back here and tap Retry.",
    ];
  }
  return [
    "Open your computer's privacy settings.",
    "Turn on location services for this browser.",
    "Come back here and tap Retry.",
  ];
}

/** OS/browser steps when the permission was revoked. Plain words, no markup. */
export function geoRecoverySteps(ua = typeof navigator === "undefined" ? "" : navigator.userAgent): string[] {
  const ios = /iPhone|iPad|iPod/i.test(ua);
  const android = /Android/i.test(ua);
  if (ios) {
    return [
      "Open Settings on this iPhone or iPad.",
      "Scroll to Safari (or the browser you used to install the app).",
      "Tap Location and choose While Using the App.",
      "Come back here and tap Retry.",
    ];
  }
  if (android) {
    return [
      "Open this site's lock icon or the three-dot menu.",
      "Tap Permissions or Site settings.",
      "Set Location to Allow.",
      "Come back here and tap Retry.",
    ];
  }
  return [
    "Click the lock or tune icon in the address bar.",
    "Set Location to Allow.",
    "If it still fails, install the app so the permission can stay granted.",
    "Come back here and tap Retry.",
  ];
}
