"use strict";
/**
 * Analytics summarizer (PR2) — the KPI definitions, pinned.
 *
 * These assertions are the contract §3.2 describes in prose. They exist so a
 * later refactor cannot quietly change what "punctuality" means: every number
 * here is a judgement call written down in the module header, and a test is the
 * only thing that keeps prose and arithmetic in step.
 */

const { summarize, hoursBetween } = require("../../src/modules/hr/attendance/attendance.analytics");

/** One attendance_day row, with the fields the summarizer actually reads. */
function day(over = {}) {
  return {
    employee_id: "emp-1",
    employee_name: "Ada Mbeki",
    department: "Operations",
    entity_name: "Smart Logistics",
    work_date: "2026-08-03",
    status: "PRESENT",
    minutes_late: 0,
    first_clock_in_at: null,
    last_clock_out_at: null,
    deduction_amount: 0,
    justified: false,
    ...over,
  };
}

describe("hoursBetween", () => {
  it("is null unless both ends are present and ordered", () => {
    expect(hoursBetween(null, "2026-08-03T17:00:00Z")).toBeNull();
    expect(hoursBetween("2026-08-03T08:00:00Z", null)).toBeNull();
    // A clock-out before the clock-in is corrupt, not negative hours.
    expect(hoursBetween("2026-08-03T17:00:00Z", "2026-08-03T08:00:00Z")).toBeNull();
    expect(hoursBetween("2026-08-03T08:00:00Z", "2026-08-03T17:30:00Z")).toBe(9.5);
  });
});

describe("summarize — status counting", () => {
  it("counts PRESENT + LATE + ABSENT as expected, and the rest as days off", () => {
    const out = summarize({
      days: [
        day({ work_date: "2026-08-03", status: "PRESENT" }),
        day({ work_date: "2026-08-04", status: "LATE", minutes_late: 25 }),
        day({ work_date: "2026-08-05", status: "ABSENT" }),
        day({ work_date: "2026-08-06", status: "ON_LEAVE" }),
        day({ work_date: "2026-08-07", status: "HOLIDAY" }),
        day({ work_date: "2026-08-08", status: "WEEKEND" }),
        day({ work_date: "2026-08-09", status: "OFF" }),
      ],
    });
    expect(out.totals.expected_days).toBe(3);
    expect(out.totals.days_off).toBe(4);
    expect(out.totals.attended_days).toBe(2);
    expect(out.totals.absent_days).toBe(1);
    expect(out.totals.on_leave_days).toBe(1);
    expect(out.totals.holiday_days).toBe(1);
    expect(out.totals.off_days).toBe(2); // OFF and WEEKEND share the bucket
    expect(out.totals.minutes_late).toBe(25);
  });

  it("does NOT count approved leave as an expected day", () => {
    const out = summarize({ days: [day({ status: "ON_LEAVE" })] });
    expect(out.totals.expected_days).toBe(0);
    expect(out.totals.days_off).toBe(1);
  });
});

describe("summarize — punctuality", () => {
  it("is on-time days over days ATTENDED, not over expected days", () => {
    const out = summarize({
      days: [
        day({ work_date: "2026-08-03", status: "PRESENT" }),
        day({ work_date: "2026-08-04", status: "PRESENT" }),
        day({ work_date: "2026-08-05", status: "LATE", minutes_late: 10 }),
        // Absence must not drag punctuality down — it has its own KPI.
        day({ work_date: "2026-08-06", status: "ABSENT" }),
      ],
    });
    expect(out.totals.attended_days).toBe(3);
    expect(out.totals.punctuality_pct).toBeCloseTo(66.67, 1);
  });

  it("is null — not zero — when nobody attended", () => {
    const out = summarize({ days: [day({ status: "ABSENT" }), day({ work_date: "2026-08-04", status: "WEEKEND" })] });
    expect(out.totals.punctuality_pct).toBeNull();
  });
});

describe("summarize — hours", () => {
  it("sums only complete in/out pairs and counts the rest as missing clock-outs", () => {
    const out = summarize({
      days: [
        day({ work_date: "2026-08-03", first_clock_in_at: "2026-08-03T08:00:00Z", last_clock_out_at: "2026-08-03T17:00:00Z" }),
        day({ work_date: "2026-08-04", status: "LATE", first_clock_in_at: "2026-08-04T09:00:00Z", last_clock_out_at: null }),
      ],
    });
    expect(out.totals.hours_worked).toBe(9);
    expect(out.totals.days_missing_clock_out).toBe(1);
  });

  it("does not blame an absent day for having no clock-out", () => {
    const out = summarize({ days: [day({ status: "ABSENT" })] });
    expect(out.totals.days_missing_clock_out).toBe(0);
  });
});

describe("summarize — money", () => {
  it("keeps waived deductions out of the charged total but still reports them", () => {
    const out = summarize({
      days: [
        day({ work_date: "2026-08-03", status: "LATE", deduction_amount: "1500.00", justified: false }),
        day({ work_date: "2026-08-04", status: "LATE", deduction_amount: "2500.00", justified: true }),
      ],
    });
    expect(out.totals.deduction_charged).toBe(1500);
    expect(out.totals.deduction_waived).toBe(2500);
    expect(out.totals.waived_days).toBe(1);
  });
});

describe("summarize — on-site %", () => {
  it("counts only punches the geofence actually judged", () => {
    const out = summarize({
      days: [day()],
      punches: [
        { employee_id: "emp-1", location_status: "on_site" },
        { employee_id: "emp-1", location_status: "off_site" },
        // Neither of these can be judged, so neither may move the percentage.
        { employee_id: "emp-1", location_status: "no_gps" },
        { employee_id: "emp-1", location_status: "unfenced" },
      ],
    });
    expect(out.totals.judged_punches).toBe(2);
    expect(out.totals.on_site_pct).toBe(50);
  });

  it("derives the verdict from the raw row when location_status is absent", () => {
    const out = summarize({
      days: [day()],
      punches: [{ employee_id: "emp-1", location_source: "gps", latitude: 4, longitude: 9, within_geofence: true }],
    });
    expect(out.totals.on_site_pct).toBe(100);
  });

  it("is null when a tenant has defined no worksite at all", () => {
    const out = summarize({
      days: [day()],
      punches: [{ employee_id: "emp-1", location_status: "unfenced" }],
    });
    expect(out.totals.on_site_pct).toBeNull();
  });
});

describe("summarize — grouping", () => {
  it("splits per employee and rolls departments up", () => {
    const out = summarize({
      days: [
        day({ employee_id: "emp-1", employee_name: "Ada Mbeki", department: "Operations", status: "PRESENT" }),
        day({ employee_id: "emp-2", employee_name: "Bala Njoya", department: "Operations", status: "LATE", minutes_late: 15, work_date: "2026-08-04" }),
        day({ employee_id: "emp-3", employee_name: "Chi Fon", department: "Finance", status: "ABSENT", work_date: "2026-08-04" }),
      ],
    });

    expect(out.by_employee.map((e) => e.employee_name)).toEqual(["Ada Mbeki", "Bala Njoya", "Chi Fon"]);
    expect(out.by_employee.find((e) => e.employee_id === "emp-2").minutes_late).toBe(15);

    const ops = out.by_department.find((d) => d.department === "Operations");
    expect(ops.employees).toBe(2);
    expect(ops.expected_days).toBe(2);
    expect(out.by_department.find((d) => d.department === "Finance").absent_days).toBe(1);
  });

  it("keys the heatmap by date and aggregates everyone on that date", () => {
    const out = summarize({
      days: [
        day({ employee_id: "emp-1", work_date: "2026-08-03", status: "PRESENT" }),
        day({ employee_id: "emp-2", work_date: "2026-08-03", status: "LATE", minutes_late: 5 }),
        day({ employee_id: "emp-1", work_date: "2026-08-04", status: "ABSENT" }),
      ],
      from: "2026-08-03",
      to: "2026-08-04",
    });
    expect(out.heatmap.map((c) => c.date)).toEqual(["2026-08-03", "2026-08-04"]);
    expect(out.heatmap[0].expected_days).toBe(2);
    expect(out.heatmap[0].minutes_late).toBe(5);
    expect(out.heatmap[1].absent_days).toBe(1);
    expect(out.window).toEqual({ from: "2026-08-03", to: "2026-08-04" });
  });

  it("accepts a Date work_date as well as an ISO string", () => {
    const out = summarize({ days: [day({ work_date: new Date("2026-08-03T00:00:00Z") })] });
    expect(out.heatmap[0].date).toBe("2026-08-03");
  });

  it("returns empty structures rather than throwing on an empty window", () => {
    const out = summarize({});
    expect(out.totals.expected_days).toBe(0);
    expect(out.totals.punctuality_pct).toBeNull();
    expect(out.by_employee).toEqual([]);
    expect(out.heatmap).toEqual([]);
  });
});
