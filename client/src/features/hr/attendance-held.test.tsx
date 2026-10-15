/**
 * Held punches (14403): the queue a `block` policy fills instead of refusing
 * people at the gate. A punch here is not paid until a manager decides.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { HeldPunches } from "./attendance";
import * as api from "@/lib/hr-api";

vi.mock("@/lib/hr-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hr-api")>("@/lib/hr-api");
  return { ...actual, reviewQueue: vi.fn(), reviewPunch: vi.fn() };
});

const mocked = vi.mocked(api);

const render = (ui: React.ReactElement) =>
  rtlRender(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>,
  );

const HELD: api.AttendanceRow = {
  attendance_id: "a1",
  employee_name: "Diane Ngo",
  clock_in_at: "2026-10-15T07:05:00Z",
  review_status: "PENDING",
  review_reasons: ["off_site", "device"],
  geo_label: "Bonabéri, Douala",
  distance_m: 1640,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.reviewQueue.mockResolvedValue([HELD]);
  mocked.reviewPunch.mockResolvedValue({ ...HELD, review_status: "APPROVED" });
});

describe("HeldPunches", () => {
  it("shows why each punch is held", async () => {
    render(<HeldPunches />);
    // DataList draws the row twice (cards on a phone, a table on desktop).
    expect((await screen.findAllByText("Diane Ngo")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Off-site").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unapproved Device").length).toBeGreaterThan(0);
  });

  it("approves in one tap", async () => {
    render(<HeldPunches />);
    await userEvent.click((await screen.findAllByRole("button", { name: "Approve" }))[0]);
    await waitFor(() => expect(mocked.reviewPunch).toHaveBeenCalledWith("a1", { decision: "APPROVED" }));
  });

  it("asks why before rejecting, because the employee is told", async () => {
    render(<HeldPunches />);
    await userEvent.click((await screen.findAllByRole("button", { name: "Reject" }))[0]);
    const reason = await screen.findByLabelText(/Reason Shown to the Employee/i);
    await userEvent.type(reason, "Not at the yard that day");
    await userEvent.click(screen.getByRole("button", { name: "Reject Punch" }));
    await waitFor(() =>
      expect(mocked.reviewPunch).toHaveBeenCalledWith("a1", {
        decision: "REJECTED",
        note: "Not at the yard that day",
      }),
    );
  });

  it("renders nothing when nothing is waiting", async () => {
    mocked.reviewQueue.mockResolvedValue([]);
    const { container } = render(<HeldPunches />);
    await waitFor(() => expect(mocked.reviewQueue).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toBe(""));
  });
});
