/**
 * The time clock.
 *
 * THREE FACES, NOTHING ELSE (owner's decision, 16 Oct 2026):
 *
 *   in    "Clock In" — no icon, no time. One tap clocks in, no confirmation.
 *   on    the running HH:MM:SS since clock-in. A tap asks to confirm the
 *         clock-out, showing time worked against the day's target, where they
 *         clocked in from, and on what.
 *   done  disabled for the rest of the day, with a two-minute Undo.
 *
 * And the location rules from 14403 still hold underneath: a failed location
 * never stops the punch, and the card names its real cause.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { ClockPunchChip, hoursFmt, timerFmt } from "@/components/clock-punch";
import { ToastProvider } from "@/components/ui/toast";
import * as api from "@/lib/hr-api";
import * as loc from "@/lib/clock-location";

// A factory mock replaces the WHOLE module, so an export it omits is not
// undefined: vitest substitutes a stub that throws on access. These mocks have
// to keep up with what the component calls.
vi.mock("@/lib/hr-api", () => ({
  clockState: vi.fn(),
  punchIn: vi.fn(),
  punchOut: vi.fn(),
  attachFix: vi.fn(),
  undoClockOut: vi.fn(),
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

const DEVICE = { fingerprint: "abcdef0123456789", platform: "Win32" };
const FIX = { latitude: 4.05, longitude: 9.76, accuracy: 12 };
const none = Promise.resolve({ fix: null, error: null });
const HOUR = 3_600_000;

function state(over: Partial<api.ClockState> = {}): api.ClockState {
  return { linked: true, open: null, done: null, expected_minutes: 480, undo_until: null, ...over };
}
function sent(row: Partial<api.AttendanceRow>) {
  return { status: "sent" as const, data: { attendance_id: "a1", ...row } as api.AttendanceRow };
}
const render = (ui: React.ReactElement) => rtlRender(<ToastProvider>{ui}</ToastProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  mloc.captureForPunch.mockResolvedValue({ fix: FIX, error: null, late: none });
  mloc.askForLocation.mockResolvedValue(null);
  mocked.clockState.mockResolvedValue(state());
  mocked.deviceInfo.mockReturnValue(DEVICE);
  mocked.punchIn.mockResolvedValue(sent({ clock_in_at: new Date().toISOString(), within_geofence: true }));
  mocked.punchOut.mockResolvedValue(sent({ clock_in_at: new Date(Date.now() - HOUR).toISOString(), clock_out_at: new Date().toISOString() }));
  mocked.attachFix.mockResolvedValue(sent({}));
});

async function ready() {
  render(<ClockPunchChip />);
  await waitFor(() => expect(mocked.clockState).toHaveBeenCalled());
}

describe("formatting", () => {
  it("counts the shift as HH:MM:SS, past 24 hours without wrapping", () => {
    expect(timerFmt(2 * HOUR + 14 * 60_000 + 9_000)).toBe("02:14:09");
    expect(timerFmt(27 * HOUR)).toBe("27:00:00");
  });
  it("says hours worked the short way", () => {
    expect(hoursFmt(462)).toBe("7h 42m");
    expect(hoursFmt(480)).toBe("8h");
    expect(hoursFmt(25)).toBe("25m");
  });
});

describe("the three faces", () => {
  it("before today's shift: 'Clock In' and nothing else, and one tap clocks in", async () => {
    await ready();
    const btn = await screen.findByRole("button", { name: "Clock In" });
    expect(btn).toHaveTextContent(/^Clock In$/);
    await userEvent.click(btn);
    await waitFor(() => expect(mocked.punchIn).toHaveBeenCalled());
    // No confirmation on the way in.
    expect(screen.queryByRole("dialog")).toBeNull();
    // Straight to the timer.
    expect(await screen.findByRole("button", { name: /Clock Out\. On the clock/ })).toHaveTextContent(
      /^\d{2}:\d{2}:\d{2}$/,
    );
  });

  it("on the clock: the running time, and a tap asks before clocking out", async () => {
    mocked.clockState.mockResolvedValue(state({
      open: {
        attendance_id: "a1",
        clock_in_at: new Date(Date.now() - (7 * HOUR + 42 * 60_000)).toISOString(),
        geo_label: "Bonabéri, Douala",
        device_label: "Yard tablet",
      },
    }));
    await ready();
    const pill = await screen.findByRole("button", { name: /Clock Out\. On the clock/ });
    expect(pill.textContent).toMatch(/^07:42:\d{2}$/);
    await userEvent.click(pill);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Clock out?")).toBeInTheDocument();
    expect(within(dialog).getByText(/7h 42m/)).toBeInTheDocument();
    expect(within(dialog).getAllByText("of 8h").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("Bonabéri, Douala")).toBeInTheDocument();
    expect(within(dialog).getByText("Yard tablet")).toBeInTheDocument();
    expect(mocked.punchOut).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole("button", { name: "Clock Out" }));
    await waitFor(() => expect(mocked.punchOut).toHaveBeenCalled());
    expect(mocked.punchOut.mock.calls[0][0]?.tapped_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("cancelling the question leaves the shift running", async () => {
    mocked.clockState.mockResolvedValue(state({ open: { attendance_id: "a1", clock_in_at: new Date().toISOString() } }));
    await ready();
    await userEvent.click(await screen.findByRole("button", { name: /Clock Out\. On the clock/ }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(mocked.punchOut).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Clock Out\. On the clock/ })).toBeInTheDocument();
  });

  it("shows no target on a day with none", async () => {
    mocked.clockState.mockResolvedValue(state({
      expected_minutes: null,
      open: { attendance_id: "a1", clock_in_at: new Date(Date.now() - HOUR).toISOString() },
    }));
    await ready();
    await userEvent.click(await screen.findByRole("button", { name: /Clock Out\. On the clock/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("progressbar")).toBeNull();
    expect(within(dialog).queryByText(/^of /)).toBeNull();
  });

  it("after clocking out: disabled for the day, with Undo for two minutes", async () => {
    mocked.clockState.mockResolvedValue(state({ open: { attendance_id: "a1", clock_in_at: new Date(Date.now() - HOUR).toISOString() } }));
    mocked.undoClockOut.mockResolvedValue({ attendance_id: "a1", clock_in_at: new Date(Date.now() - HOUR).toISOString() });
    await ready();
    await userEvent.click(await screen.findByRole("button", { name: /Clock Out\. On the clock/ }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Clock Out" }));

    const done = await screen.findByRole("button", { name: /^Done · 1h$/ });
    expect(done).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(mocked.undoClockOut).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: /Clock Out\. On the clock/ })).toBeInTheDocument();
  });

  it("a finished day from the server stays locked, and offers no Undo once the window has passed", async () => {
    mocked.clockState.mockResolvedValue(state({
      done: {
        attendance_id: "a1",
        clock_in_at: new Date(Date.now() - 9 * HOUR).toISOString(),
        clock_out_at: new Date(Date.now() - HOUR).toISOString(),
      },
    }));
    await ready();
    expect(await screen.findByRole("button", { name: /^Done · 8h$/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clock In" })).toBeNull();
  });

  it("renders nothing for somebody who is not an employee", async () => {
    mocked.clockState.mockResolvedValue(state({ linked: false }));
    const { container } = render(<ClockPunchChip />);
    await waitFor(() => expect(mocked.clockState).toHaveBeenCalled());
    expect(container.querySelector("button")).toBeNull();
    expect(mloc.captureForPunch).not.toHaveBeenCalled();
  });

  it("reads 'already clocked out today' as an out-of-date clock and locks it", async () => {
    const { ApiError } = await import("@/lib/api-client");
    mocked.punchIn.mockRejectedValue(new ApiError("SHIFT_DONE_TODAY", "done", 409));
    await ready();
    mocked.clockState.mockResolvedValue(state({
      done: { attendance_id: "a9", clock_in_at: new Date(Date.now() - 2 * HOUR).toISOString(), clock_out_at: new Date().toISOString() },
    }));
    await userEvent.click(await screen.findByRole("button", { name: "Clock In" }));
    expect(await screen.findByRole("button", { name: /^Done · 2h$/ })).toBeDisabled();
  });
});

describe("the punch underneath (14403)", () => {
  it("sends the location, the tap time, its own reference and the device", async () => {
    await ready();
    await userEvent.click(await screen.findByRole("button", { name: "Clock In" }));
    await waitFor(() => expect(mocked.punchIn).toHaveBeenCalled());
    const body = mocked.punchIn.mock.calls[0][0];
    expect(body).toEqual(expect.objectContaining({ latitude: 4.05, longitude: 9.76, device: DEVICE }));
    expect(body.tapped_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.client_ref).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("still punches with no location, sends why, and names a blocked site", async () => {
    mloc.captureForPunch.mockResolvedValue({ fix: null, error: "denied", late: none });
    await ready();
    await userEvent.click(await screen.findByRole("button", { name: "Clock In" }));
    await waitFor(() => expect(mocked.punchIn).toHaveBeenCalled());
    const body = mocked.punchIn.mock.calls[0][0];
    expect(body.latitude).toBeUndefined();
    expect(body.location_error).toBe("denied");
    expect(await screen.findByText(/blocked for this site/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /restore later/i }));
    expect(screen.queryByText(/blocked for this site/i)).toBeNull();
  });

  it("names the DEVICE, not the site, when the site is allowed and the device refuses", async () => {
    mloc.captureForPunch.mockResolvedValue({ fix: null, error: "os_off", late: none });
    await ready();
    await userEvent.click(await screen.findByRole("button", { name: "Clock In" }));
    expect(await screen.findByText(/off on this device/i)).toBeInTheDocument();
    expect(screen.queryByText(/Set Location to Allow/i)).toBeNull();
  });

  it("does not wait on a slow GPS: it punches, then attaches the reading quietly", async () => {
    let land!: (r: Awaited<loc.Capture["late"]>) => void;
    const late = new Promise<Awaited<loc.Capture["late"]>>((r) => (land = r));
    mloc.captureForPunch.mockResolvedValue({ fix: null, error: "timeout", late });
    await ready();
    await userEvent.click(await screen.findByRole("button", { name: "Clock In" }));
    await waitFor(() => expect(mocked.punchIn).toHaveBeenCalled());
    expect(mocked.punchIn.mock.calls[0][0].location_error).toBe("timeout");
    expect(screen.queryByRole("status")).toBeNull();

    land({ fix: { ...FIX, at: Date.now() }, error: null });
    await waitFor(() => expect(mocked.attachFix).toHaveBeenCalled());
    expect(mocked.attachFix.mock.calls[0][0]).toMatchObject({
      client_ref: mocked.punchIn.mock.calls[0][0].client_ref,
      phase: "in",
    });
  });

  it("holds the punch on the device when there is no network, and starts the timer", async () => {
    mocked.punchIn.mockResolvedValue({ status: "queued", entry: {} as never });
    await ready();
    await userEvent.click(await screen.findByRole("button", { name: "Clock In" }));
    expect(await screen.findByText(/Saved on this device/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Clock Out\. On the clock/ })).toBeInTheDocument();
  });

  it("does not hide the clock because the network is down", async () => {
    const { ApiError } = await import("@/lib/api-client");
    mocked.clockState.mockRejectedValue(new ApiError("NETWORK_DOWN", "offline", 0));
    await ready();
    expect(await screen.findByRole("button", { name: "Clock In" })).toBeInTheDocument();
  });

  it("offers to name a device it has never seen, and the punch stands either way", async () => {
    mocked.punchIn.mockResolvedValue(sent({ clock_in_at: new Date().toISOString(), hr_device_id: "d1", device_new: true }));
    await ready();
    await userEvent.click(await screen.findByRole("button", { name: "Clock In" }));
    const input = await screen.findByLabelText("Device name");
    await userEvent.type(input, "Yard tablet");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocked.renameOwnDevice).toHaveBeenCalledWith("d1", "Yard tablet"));
  });

  it("asks for location on a tap before the first punch, never on page load", async () => {
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
      expect(mloc.askForLocation).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: "Allow Location" }));
      expect(mloc.askForLocation).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(navigator, "permissions", { configurable: true, value: perms });
    }
  });

  it("has no axe violations", async () => {
    const { container } = render(<ClockPunchChip />);
    await screen.findByRole("button", { name: "Clock In" });
    expect(await axe(container)).toHaveNoViolations();
  });
});
