/**
 * The title-bar clock chip.
 *
 * WHAT THESE PIN, and why each one is a bug that shipped or nearly did:
 *
 *   1. The chip is a real button with the SHIFT STATE in its accessible name.
 *      The visual signal is a 8px dot; a screen-reader user who only hears
 *      "Clock out" cannot tell whether that is an instruction or a description.
 *   2. Punching captures a location FIRST and still punches when it fails.
 *      The server decides what a location-less punch is worth; the client must
 *      not make that decision by refusing to send.
 *   3. A failed location is REPORTED, with its real cause. The first version
 *      swallowed it; the second blamed the site permission for every failure,
 *      including a slow GPS and a computer with Windows location turned off,
 *      while the site was allowed (14403).
 *   4. A user with no linked employee still sees a clock and is told why the
 *      punch did nothing, rather than seeing a dead control.
 *   5. Nothing stops the punch: no network queues it, a slow GPS follows it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { ClockPunchChip } from "@/components/clock-punch";
import * as api from "@/lib/hr-api";
import * as loc from "@/lib/clock-location";

// A factory mock replaces the WHOLE module, so an export it omits is not
// undefined: vitest substitutes a stub that throws on access, and the throw
// surfaces as the error text rendered into the chip's own label. Worth
// remembering when adding to the component: these mocks have to keep up.
vi.mock("@/lib/hr-api", () => ({
  clockState: vi.fn(),
  punchIn: vi.fn(),
  punchOut: vi.fn(),
  attachFix: vi.fn(),
  deviceInfo: vi.fn(),
  renameOwnDevice: vi.fn(),
}));
vi.mock("@/lib/clock-location", () => ({
  captureForPunch: vi.fn(),
  askForLocation: vi.fn(),
  warmGps: vi.fn(),
  setLocationPermission: vi.fn(),
  onWarmError: vi.fn(),
}));

const mocked = vi.mocked(api);
const mloc = vi.mocked(loc);
const chip = () => screen.getByRole("button", { name: /Clock (in|out)\./ });

const DEVICE = { fingerprint: "abcdef0123456789", platform: "Win32" };
const FIX = { latitude: 4.05, longitude: 9.76, accuracy: 12 };
const none = Promise.resolve({ fix: null, error: null });

function sent(row: Partial<api.AttendanceRow>) {
  return { status: "sent" as const, data: { attendance_id: "a1", ...row } as api.AttendanceRow };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  mloc.captureForPunch.mockResolvedValue({ fix: FIX, error: null, late: none });
  mloc.askForLocation.mockResolvedValue(null);
  mocked.clockState.mockResolvedValue({ linked: true, open: null });
  mocked.deviceInfo.mockReturnValue(DEVICE);
  mocked.punchIn.mockResolvedValue(sent({ within_geofence: true }));
  mocked.punchOut.mockResolvedValue(sent({}));
  mocked.attachFix.mockResolvedValue(sent({}));
});

async function ready() {
  render(<ClockPunchChip />);
  await waitFor(() => expect(mocked.clockState).toHaveBeenCalled());
}

describe("ClockPunchChip", () => {
  it("names the STATE, not just the verb", async () => {
    await ready();
    expect(
      screen.getByRole("button", { name: "Clock in. Not clocked in" }),
    ).toBeInTheDocument();
  });

  it("reads an open shift as on the clock", async () => {
    mocked.clockState.mockResolvedValue({
      linked: true,
      open: { attendance_id: "a1", clock_in_at: "2026-08-15T07:00:00Z" },
    });
    render(<ClockPunchChip />);
    expect(
      await screen.findByRole("button", { name: "Clock out. On the clock" }),
    ).toBeInTheDocument();
  });

  it("captures a location before punching, and sends the tap time and its own reference", async () => {
    await ready();
    await userEvent.click(chip());
    await waitFor(() => expect(mocked.punchIn).toHaveBeenCalled());
    expect(mloc.captureForPunch).toHaveBeenCalled();
    const sentBody = mocked.punchIn.mock.calls[0][0];
    expect(sentBody).toEqual(expect.objectContaining({ latitude: 4.05, longitude: 9.76 }));
    expect(sentBody.tapped_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(sentBody.client_ref).toMatch(/^[0-9a-f-]{36}$/);
    expect(sentBody.location_error).toBeUndefined();
  });

  it("does NOT raise a location card for an unfenced GPS punch", async () => {
    // GPS arrived; the tenant has no worksite. That is not a missing fix.
    mocked.punchIn.mockResolvedValue(
      sent({ within_geofence: null, location_source: "gps", location_status: "unfenced" }),
    );
    await ready();
    await userEvent.click(chip());
    await waitFor(() => expect(mocked.punchIn).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByTitle(/no location/i)).toBeNull();
  });

  it("names a BLOCKED SITE as the cause, after a punch that stood anyway", async () => {
    mloc.captureForPunch.mockResolvedValue({ fix: null, error: "denied", late: none });
    await ready();
    await userEvent.click(chip());
    await waitFor(() => expect(mocked.punchIn).toHaveBeenCalled());
    expect(await screen.findByText(/blocked for this site/i)).toBeInTheDocument();
    expect(screen.getByText(/Your punch is saved/i)).toBeInTheDocument();
    // The punch is not gated: they can dismiss and stay on the clock.
    await userEvent.click(screen.getByRole("button", { name: /restore later/i }));
    expect(screen.queryByText(/blocked for this site/i)).toBeNull();
    expect(await screen.findByRole("button", { name: /Clock out\./ })).toBeInTheDocument();
  });

  it("names the DEVICE, not the site, when the site is allowed and the device refuses", async () => {
    // The screenshot behind 14403: Location allowed in the browser, the card
    // still telling them to allow it. On Windows the system switch is the cause.
    mloc.captureForPunch.mockResolvedValue({ fix: null, error: "os_off", late: none });
    await ready();
    await userEvent.click(chip());
    expect(await screen.findByText(/off on this device/i)).toBeInTheDocument();
    expect(screen.queryByText(/blocked for this site/i)).toBeNull();
    // Device steps, never the site-permission steps that were already done.
    expect(screen.queryByText(/Set Location to Allow/i)).toBeNull();
  });

  it("STILL PUNCHES when the location fails, sends why, and says the location is missing", async () => {
    mloc.captureForPunch.mockResolvedValue({ fix: null, error: "denied", late: none });
    await ready();
    await userEvent.click(chip());
    await waitFor(() => expect(mocked.punchIn).toHaveBeenCalled());
    // Asserted as the ABSENCE of coordinates rather than as an exact payload:
    // the claim is only ever "it punched, and sent no location it did not have".
    const body = mocked.punchIn.mock.calls[0][0];
    expect(body.latitude).toBeUndefined();
    expect(body.longitude).toBeUndefined();
    expect(body.location_error).toBe("denied");
    expect(await screen.findByTitle(/no location/i)).toBeInTheDocument();
  });

  it("does not make anybody wait on a slow GPS: it punches, then attaches the reading", async () => {
    let land!: (r: Awaited<loc.Capture["late"]>) => void;
    const late = new Promise<Awaited<loc.Capture["late"]>>((r) => (land = r));
    mloc.captureForPunch.mockResolvedValue({ fix: null, error: "timeout", late });
    await ready();
    await userEvent.click(chip());
    await waitFor(() => expect(mocked.punchIn).toHaveBeenCalled());
    expect(mocked.punchIn.mock.calls[0][0].location_error).toBe("timeout");
    expect(await screen.findByTitle(/finding location/i)).toBeInTheDocument();
    // A slow GPS is not homework: no card.
    expect(screen.queryByRole("status")).toBeNull();

    land({ fix: { ...FIX, at: Date.now() }, error: null });
    await waitFor(() => expect(mocked.attachFix).toHaveBeenCalled());
    const fix = mocked.attachFix.mock.calls[0][0];
    expect(fix.client_ref).toBe(mocked.punchIn.mock.calls[0][0].client_ref);
    expect(fix.phase).toBe("in");
    expect(await screen.findByTitle(/Location added/i)).toBeInTheDocument();
  });

  it("holds the punch on the device when there is no network, and shows them on the clock", async () => {
    mocked.punchIn.mockResolvedValue({ status: "queued", entry: {} as never });
    await ready();
    await userEvent.click(chip());
    expect(await screen.findByTitle(/Saved on this device/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Clock out\. On the clock/ })).toBeInTheDocument();
  });

  it("reads the server's held verdict back to the person", async () => {
    mocked.punchIn.mockResolvedValue(sent({ within_geofence: false, review_status: "PENDING" }));
    await ready();
    await userEvent.click(chip());
    expect(await screen.findByTitle(/waiting for approval/i)).toBeInTheDocument();
  });

  it("treats 'already clocked in' as an out-of-date clock, not a failure", async () => {
    const { ApiError } = await import("@/lib/api-client");
    mocked.punchIn.mockRejectedValue(new ApiError("ALREADY_CLOCKED_IN", "open shift", 409));
    await ready();
    mocked.clockState.mockResolvedValue({
      linked: true,
      open: { attendance_id: "a9", clock_in_at: "2026-10-15T07:00:00Z" },
    });
    await userEvent.click(chip());
    expect(await screen.findByTitle(/already on the clock/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Clock out\. On the clock/ })).toBeInTheDocument();
  });

  it("sends the device fingerprint with the punch", async () => {
    // Registration happens ON the punch, not as a separate call: a tenant on
    // `block` holds the punch for a manager, and the register is how the
    // manager knows which device it came from.
    await ready();
    await userEvent.click(chip());
    await waitFor(() => expect(mocked.punchIn).toHaveBeenCalled());
    expect(mocked.punchIn.mock.calls[0][0].device).toEqual(DEVICE);
  });

  it("punches anyway when the browser cannot keep a device id", async () => {
    mocked.deviceInfo.mockReturnValue(null);
    await ready();
    await userEvent.click(chip());
    await waitFor(() => expect(mocked.punchIn).toHaveBeenCalled());
    expect(mocked.punchIn.mock.calls[0][0].device).toBeNull();
  });

  it("flags an off-site punch rather than reporting a clean clock-in", async () => {
    mocked.punchIn.mockResolvedValue(sent({ within_geofence: false }));
    await ready();
    await userEvent.click(chip());
    expect(await screen.findByTitle(/off-site/i)).toBeInTheDocument();
  });

  it("tells an unlinked user why nothing happened instead of going dead", async () => {
    mocked.clockState.mockResolvedValue({ linked: false, open: null });
    render(<ClockPunchChip />);
    const btn = await screen.findByRole("button", { name: /Time\./ });
    await userEvent.click(btn);
    expect(
      await screen.findByTitle(/isn't linked to an employee/i),
    ).toBeInTheDocument();
    expect(mocked.punchIn).not.toHaveBeenCalled();
    // And they are never asked for location: they cannot punch.
    expect(mloc.captureForPunch).not.toHaveBeenCalled();
  });

  it("does NOT call an employee unlinked because the network is down", async () => {
    const { ApiError } = await import("@/lib/api-client");
    mocked.clockState.mockRejectedValue(new ApiError("NETWORK_DOWN", "offline", 0));
    mocked.punchIn.mockResolvedValue({ status: "queued", entry: {} as never });
    await ready();
    await userEvent.click(chip());
    await waitFor(() => expect(mocked.punchIn).toHaveBeenCalled());
    expect(await screen.findByTitle(/Saved on this device/i)).toBeInTheDocument();
  });

  it("offers to name a device it has never seen, and the punch stands either way", async () => {
    mocked.punchIn.mockResolvedValue(
      sent({ within_geofence: true, hr_device_id: "d1", device_new: true }),
    );
    await ready();
    await userEvent.click(chip());

    const input = await screen.findByLabelText("Device name");
    await userEvent.type(input, "Yard tablet");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocked.renameOwnDevice).toHaveBeenCalledWith("d1", "Yard tablet"));
    await waitFor(() => expect(screen.queryByLabelText("Device name")).toBeNull());
  });

  it("does NOT offer for a device it has seen before", async () => {
    mocked.punchIn.mockResolvedValue(sent({ within_geofence: true, hr_device_id: "d1" }));
    await ready();
    await userEvent.click(chip());
    await waitFor(() => expect(mocked.punchIn).toHaveBeenCalled());
    expect(screen.queryByLabelText("Device name")).toBeNull();
  });

  it("keeps the punch when the name is skipped", async () => {
    mocked.punchIn.mockResolvedValue(
      sent({ within_geofence: true, hr_device_id: "d1", device_new: true }),
    );
    await ready();
    await userEvent.click(chip());
    await userEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(mocked.renameOwnDevice).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: /Clock out\./ })).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<ClockPunchChip />);
    await waitFor(() => expect(mocked.clockState).toHaveBeenCalled());
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("the location card itself", () => {
  it("asks on a tap before the first punch, and never on page load", async () => {
    const perms = navigator.permissions;
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: {} });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: {
        query: async () => ({ state: "prompt", addEventListener: () => undefined, removeEventListener: () => undefined }),
      },
    });
    try {
      await ready();
      expect(await screen.findByText(/Allow location for clocking in/i)).toBeInTheDocument();
      // Nothing asked the browser yet: the card is waiting for a tap.
      expect(mloc.askForLocation).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: "Allow Location" }));
      expect(mloc.askForLocation).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByText(/Allow location for clocking in/i)).toBeNull());
    } finally {
      Object.defineProperty(navigator, "permissions", { configurable: true, value: perms });
    }
  });

  it("moves to the device card when allowing the site turns out not to be enough", async () => {
    mloc.captureForPunch.mockResolvedValue({ fix: null, error: "denied", late: none });
    mloc.askForLocation.mockResolvedValue("os_off");
    await ready();
    await userEvent.click(chip());
    await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/off on this device/i)).toBeInTheDocument();
  });
});
