/**
 * Where the person is at the tap: fast, honest, never in the way (14403).
 *
 * The old clock waited up to ten seconds for a cold, uncached, high-accuracy
 * reading and then blamed the site permission. These pin what replaced it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  __resetClockLocationForTests,
  captureForPunch,
  onWarmError,
  setLocationPermission,
  warmGps,
  WAIT_MS,
} from "./clock-location";

type Ok = (p: GeolocationPosition) => void;
type Err = (e: { code: number; message: string }) => void;

const position = (lat = 4.05, lng = 9.76) =>
  ({ coords: { latitude: lat, longitude: lng, accuracy: 10 }, timestamp: Date.now() }) as GeolocationPosition;

let getCurrentPosition: ReturnType<typeof vi.fn>;
let watchPosition: ReturnType<typeof vi.fn>;
let clearWatch: ReturnType<typeof vi.fn>;
const original = { geo: navigator.geolocation, perms: navigator.permissions };

beforeEach(() => {
  __resetClockLocationForTests();
  getCurrentPosition = vi.fn();
  watchPosition = vi.fn(() => 7);
  clearWatch = vi.fn();
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition, watchPosition, clearWatch },
  });
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: async () => ({ state: "granted" }) },
  });
});

afterEach(() => {
  vi.useRealTimers();
  __resetClockLocationForTests();
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: original.geo });
  Object.defineProperty(navigator, "permissions", { configurable: true, value: original.perms });
});

describe("captureForPunch", () => {
  it("returns the reading when it lands inside the wait", async () => {
    getCurrentPosition.mockImplementation((ok: Ok) => ok(position()));
    const cap = await captureForPunch();
    expect(cap.fix).toEqual({ latitude: 4.05, longitude: 9.76, accuracy: 10 });
    expect(cap.error).toBeNull();
  });

  it("waits at most five seconds, then lets the punch go and keeps listening", async () => {
    vi.useFakeTimers();
    let land!: Ok;
    getCurrentPosition.mockImplementation((ok: Ok) => {
      land = ok;
    });
    const pending = captureForPunch();
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    const cap = await pending;
    expect(cap.fix).toBeNull();
    expect(cap.error).toBe("timeout");

    land(position(4.1, 9.8));
    const late = await cap.late;
    expect(late.fix?.latitude).toBe(4.1);
    expect(late.fix?.at).toEqual(expect.any(Number));
  });

  it("says WHY there is no reading, using the permission to split site from device", async () => {
    getCurrentPosition.mockImplementation((_ok: Ok, err: Err) => err({ code: 1, message: "denied" }));
    const cap = await captureForPunch();
    expect(cap.error).toBe("os_off");
  });

  it("uses a warm reading taken moments ago instead of asking again", async () => {
    setLocationPermission("granted");
    watchPosition.mockImplementation((ok: Ok) => {
      ok(position(4.2, 9.9));
      return 7;
    });
    warmGps();
    const cap = await captureForPunch();
    expect(cap.fix?.latitude).toBe(4.2);
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("reports no geolocation at all as unsupported, and still resolves", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });
    const cap = await captureForPunch();
    expect(cap).toMatchObject({ fix: null, error: "unsupported" });
  });
});

describe("warmGps", () => {
  it("never warms before permission is granted: warming must not be the ask", () => {
    setLocationPermission("prompt");
    warmGps();
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it("reports a device that refuses while the site is allowed, and stops warming", () => {
    const heard = vi.fn();
    onWarmError(heard);
    setLocationPermission("granted");
    watchPosition.mockImplementation((_ok: Ok, err: Err) => {
      err({ code: 1, message: "denied" });
      return 7;
    });
    warmGps();
    expect(heard).toHaveBeenCalledWith("os_off");
    expect(clearWatch).toHaveBeenCalledWith(7);
  });

  it("stays quiet about a slow warm-up: the tap is the one that reports", () => {
    const heard = vi.fn();
    onWarmError(heard);
    setLocationPermission("granted");
    watchPosition.mockImplementation((_ok: Ok, err: Err) => {
      err({ code: 3, message: "timeout" });
      return 7;
    });
    warmGps();
    expect(heard).not.toHaveBeenCalled();
  });
});
