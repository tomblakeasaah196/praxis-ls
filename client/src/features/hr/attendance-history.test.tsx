import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/**
 * The history widget (PR2).
 *
 * Two properties matter enough to pin:
 *
 *   THE SCOPE PICKS THE ENDPOINT. `mine` must never reach the HR routes — those
 *   are grant-gated and would 403 an ordinary employee, and the whole point of
 *   the /mine split is that your own record needs no grant. A widget that
 *   called the wrong one would look fine in an HR account and be broken for
 *   everybody else.
 *
 *   NULL IS NOT ZERO. A punctuality of null means "nobody attended", and
 *   rendering it as 0% is a confident lie about somebody's record.
 */

vi.mock("@/lib/hr-api", () => ({
  myAttendanceAnalytics: vi.fn(),
  attendanceAnalytics: vi.fn(),
  myAttendanceDays: vi.fn(),
  attendanceDays: vi.fn(),
  downloadMyAttendanceExport: vi.fn(),
  downloadAttendanceExport: vi.fn(),
  justifyDay: vi.fn(),
  runReconcile: vi.fn(),
  listEmployees: vi.fn(),
}));

import * as api from "@/lib/hr-api";
import { AttendanceHistory } from "./attendance-history";

const totals = (over: Partial<api.AttendanceTotals> = {}): api.AttendanceTotals => ({
  expected_days: 3, attended_days: 2, present_days: 1, late_days: 1, absent_days: 1,
  on_leave_days: 0, holiday_days: 0, off_days: 0, days_off: 0,
  minutes_late: 30, hours_worked: 16, days_missing_clock_out: 0,
  deduction_charged: 1500, deduction_waived: 0, waived_days: 0,
  punctuality_pct: 50, on_site_pct: 100, on_site_punches: 2, judged_punches: 2,
  ...over,
});

const analytics = (over: Partial<api.AttendanceAnalytics> = {}): api.AttendanceAnalytics => ({
  window: { from: "2026-08-01", to: "2026-08-19" },
  totals: totals(),
  by_employee: [],
  by_department: [],
  heatmap: [],
  timeZone: "Africa/Douala",
  ...over,
});

function view(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.myAttendanceAnalytics).mockResolvedValue(analytics());
  vi.mocked(api.attendanceAnalytics).mockResolvedValue(analytics());
  vi.mocked(api.myAttendanceDays).mockResolvedValue([]);
  vi.mocked(api.attendanceDays).mockResolvedValue([]);
  vi.mocked(api.downloadMyAttendanceExport).mockResolvedValue(undefined);
  vi.mocked(api.downloadAttendanceExport).mockResolvedValue(undefined);
  vi.mocked(api.listEmployees).mockResolvedValue([
    { employee_id: "emp-1", full_name: "Ada Mbeki", department: "Operations" },
    { employee_id: "emp-2", full_name: "Bala Njoya", department: "Operations" },
    { employee_id: "emp-3", full_name: "Chi Fon", department: "Finance" },
  ] as api.Employee[]);
});
afterEach(() => vi.useRealTimers());

describe("scope picks the endpoint", () => {
  it("mine calls only the self routes", async () => {
    view(<AttendanceHistory scope={{ kind: "mine" }} />);
    await waitFor(() => expect(api.myAttendanceAnalytics).toHaveBeenCalled());
    expect(api.myAttendanceDays).toHaveBeenCalled();
    expect(api.attendanceAnalytics).not.toHaveBeenCalled();
    expect(api.attendanceDays).not.toHaveBeenCalled();
  });

  it("hr calls the grant-gated routes", async () => {
    view(<AttendanceHistory scope={{ kind: "hr" }} />);
    await waitFor(() => expect(api.attendanceAnalytics).toHaveBeenCalled());
    expect(api.myAttendanceAnalytics).not.toHaveBeenCalled();
  });

  it("employee scope pins the employee id on every call", async () => {
    view(<AttendanceHistory scope={{ kind: "employee", employeeId: "emp-7" }} />);
    await waitFor(() => expect(api.attendanceAnalytics).toHaveBeenCalled());
    expect(vi.mocked(api.attendanceAnalytics).mock.calls[0][0].employee_id).toBe("emp-7");
    expect(vi.mocked(api.attendanceDays).mock.calls[0][0].employee_id).toBe("emp-7");
  });
});

describe("period chips", () => {
  it("change the window that is requested", async () => {
    const user = userEvent.setup();
    view(<AttendanceHistory scope={{ kind: "mine" }} />);
    await waitFor(() => expect(api.myAttendanceAnalytics).toHaveBeenCalled());
    const first = vi.mocked(api.myAttendanceAnalytics).mock.calls[0][0];

    await user.click(screen.getByRole("radio", { name: "7 days" }));

    await waitFor(() => {
      const calls = vi.mocked(api.myAttendanceAnalytics).mock.calls;
      const latest = calls[calls.length - 1][0];
      expect(latest.from).not.toBe(first.from);
      // 7 days inclusive of the end.
      const days = (Date.parse(latest.to) - Date.parse(latest.from)) / 86400000 + 1;
      expect(days).toBe(7);
    });
  });

  it("reveal custom bounds only on the custom chip", async () => {
    const user = userEvent.setup();
    view(<AttendanceHistory scope={{ kind: "mine" }} />);
    expect(screen.queryByLabelText(/From/i)).toBeNull();
    await user.click(screen.getByRole("radio", { name: "Custom" }));
    expect(screen.getByLabelText(/From/i)).toBeTruthy();
    expect(screen.getByLabelText(/To/i)).toBeTruthy();
  });
});

describe("download", () => {
  it("mine downloads through the self export", async () => {
    const user = userEvent.setup();
    view(<AttendanceHistory scope={{ kind: "mine" }} />);
    await waitFor(() => expect(api.myAttendanceAnalytics).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Excel" }));
    await waitFor(() => expect(api.downloadMyAttendanceExport).toHaveBeenCalled());
    expect(vi.mocked(api.downloadMyAttendanceExport).mock.calls[0][0].format).toBe("xlsx");
    expect(api.downloadAttendanceExport).not.toHaveBeenCalled();
  });

  it("hr downloads through the HR export, carrying the department filter", async () => {
    const user = userEvent.setup();
    view(<AttendanceHistory scope={{ kind: "hr" }} />);
    await waitFor(() => expect(api.attendanceAnalytics).toHaveBeenCalled());

    await user.type(screen.getByLabelText(/Department/i), "Operations");
    await user.click(screen.getByRole("button", { name: "CSV" }));

    await waitFor(() => expect(api.downloadAttendanceExport).toHaveBeenCalled());
    const arg = vi.mocked(api.downloadAttendanceExport).mock.calls[0][0];
    expect(arg.format).toBe("csv");
    expect(arg.department).toBe("Operations");
    expect(api.downloadMyAttendanceExport).not.toHaveBeenCalled();
  });
});

describe("KPI honesty", () => {
  it("shows a dash, not 0%, when nothing can be judged", async () => {
    vi.mocked(api.myAttendanceAnalytics).mockResolvedValue(
      analytics({ totals: totals({ punctuality_pct: null, on_site_pct: null, attended_days: 0, judged_punches: 0 }) }),
    );
    view(<AttendanceHistory scope={{ kind: "mine" }} />);

    await screen.findByText("Punctuality");
    // Both nullable KPIs render a dash, and neither claims a real zero.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("0%")).toBeNull();
  });

  it("still prints a real zero when the figure is genuinely zero", async () => {
    vi.mocked(api.myAttendanceAnalytics).mockResolvedValue(
      analytics({ totals: totals({ punctuality_pct: 0, attended_days: 2, present_days: 0, late_days: 2 }) }),
    );
    view(<AttendanceHistory scope={{ kind: "mine" }} />);
    expect(await screen.findByText("0%")).toBeTruthy();
  });
});

describe("waiving", () => {
  const day: api.AttendanceDay = {
    attendance_day_id: "d1", employee_id: "e1", employee_name: "Ada Mbeki",
    work_date: "2026-08-03", status: "LATE", minutes_late: 30,
    daily_rate: 10000, deduction_pct: 15, deduction_amount: 1500, justified: false,
  };

  it("is offered to HR on a charged day", async () => {
    vi.mocked(api.attendanceDays).mockResolvedValue([day]);
    view(<AttendanceHistory scope={{ kind: "hr" }} />);
    expect(await screen.findByRole("button", { name: "Waive" })).toBeTruthy();
  });

  it("is never offered on your own record", async () => {
    vi.mocked(api.myAttendanceDays).mockResolvedValue([day]);
    view(<AttendanceHistory scope={{ kind: "mine" }} />);
    // The charged row IS on screen — it simply carries no waive control.
    await screen.findByText("1,500.00 XAF");
    expect(screen.queryByRole("button", { name: "Waive" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Uphold" })).toBeNull();
  });
});

describe("employee multi-select", () => {
  it("narrows analytics, the day table and the export to the chosen people", async () => {
    const user = userEvent.setup();
    view(<AttendanceHistory scope={{ kind: "hr" }} />);
    await waitFor(() => expect(api.attendanceAnalytics).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Everyone" }));
    await user.click(await screen.findByLabelText(/Ada Mbeki/));
    await user.click(screen.getByLabelText(/Chi Fon/));

    await waitFor(() => {
      const calls = vi.mocked(api.attendanceAnalytics).mock.calls;
      expect(calls[calls.length - 1][0].employee_ids).toEqual(["emp-1", "emp-3"]);
    });
    // The table must honour the same filter, or the totals describe a different
    // set from the rows underneath them.
    const dayCalls = vi.mocked(api.attendanceDays).mock.calls;
    expect(dayCalls[dayCalls.length - 1][0].employee_ids).toEqual(["emp-1", "emp-3"]);

    await user.click(screen.getByRole("button", { name: "CSV" }));
    await waitFor(() => expect(api.downloadAttendanceExport).toHaveBeenCalled());
    expect(vi.mocked(api.downloadAttendanceExport).mock.calls[0][0].employee_ids).toEqual(["emp-1", "emp-3"]);
  });

  it("clearing the selection goes back to everyone", async () => {
    const user = userEvent.setup();
    view(<AttendanceHistory scope={{ kind: "hr" }} />);
    await waitFor(() => expect(api.attendanceAnalytics).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Everyone" }));
    await user.click(await screen.findByLabelText(/Ada Mbeki/));
    await waitFor(() => expect(screen.getByRole("button", { name: /1 selected/ })).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => {
      const calls = vi.mocked(api.attendanceAnalytics).mock.calls;
      expect(calls[calls.length - 1][0].employee_ids).toBeUndefined();
    });
  });

  it("is not offered on your own record", async () => {
    view(<AttendanceHistory scope={{ kind: "mine" }} />);
    await waitFor(() => expect(api.myAttendanceAnalytics).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Everyone" })).toBeNull();
  });
});
