"use strict";
/**
 * Export contract (PR2).
 *
 * The column KEYS are consumed by payroll, so they are pinned exactly. If this
 * test fails because a key moved, the fix is almost never to update the test —
 * it is to add the new column at the end and leave the existing keys alone.
 */

const { parseWorkbook, neutralContext } = require("../../src/services/spreadsheet");
const xport = require("../../src/modules/hr/attendance/attendance.export");

const TZ = "Africa/Douala"; // UTC+1, no DST

/**
 * A tenant fixture. Rows are RAW now — the spreadsheet service coerces them
 * against this, which is why the timezone, the bool wording and the currency
 * are asserted on the BUILT file rather than on dayRow's return value. That is
 * the output a payroll clerk actually opens.
 */
const ctx = () =>
  neutralContext({
    timezone: TZ,
    baseCurrency: "XAF",
    currencies: { XAF: { code: "XAF", symbol: "FCFA", name: "CFA franc", decimals: 0, is_base: true } },
  });

function day(over = {}) {
  return {
    employee_name: "Ada Mbeki",
    department: "Operations",
    entity_name: "Smart Logistics",
    work_date: "2026-08-03",
    status: "LATE",
    expected_start_time: "08:00",
    first_clock_in_at: "2026-08-03T08:30:00Z",
    last_clock_out_at: "2026-08-03T17:00:00Z",
    minutes_late: 30,
    location_source: "gps",
    latitude: 4.05,
    longitude: 9.76,
    within_geofence: true,
    geo_label: "Bonabéri, Douala",
    device_label: "Yard tablet",
    device_trusted: true,
    deduction_amount: "1500.00",
    justified: false,
    justification: null,
    leave_type: null,
    rule_code: "LATE-01",
    ...over,
  };
}

describe("column contract", () => {
  it("pins the Days keys and their order", () => {
    expect(xport.DAY_COLUMNS.map((c) => c.key)).toEqual([
      "employee", "department", "entity", "work_date", "weekday", "expected",
      "status", "expected_start", "first_in", "last_out", "hours",
      "minutes_late", "on_site", "geo_label", "device_label", "device_trusted",
      "deduction", "waived", "justification", "leave_type", "rule_code",
    ]);
  });

  it("pins the Punches keys and their order", () => {
    expect(xport.PUNCH_COLUMNS.map((c) => c.key)).toEqual([
      "employee", "clock_in", "clock_out", "lat", "lng",
      "within_geofence", "geo_label", "distance_m", "device", "late",
    ]);
  });

  it("gives every column a header", () => {
    for (const c of [...xport.DAY_COLUMNS, ...xport.PUNCH_COLUMNS]) {
      expect(typeof c.header).toBe("string");
      expect(c.header.length).toBeGreaterThan(0);
    }
  });
});

describe("dayRow — raw values in, service formats out", () => {
  it("passes instants through untouched for the service to place in the tenant zone", () => {
    const r = xport.dayRow(day());
    expect(r.first_in).toBe("2026-08-03T08:30:00Z");
    expect(r.last_out).toBe("2026-08-03T17:00:00Z");
  });

  it("computes hours from the pair and leaves them null when incomplete", () => {
    expect(xport.dayRow(day()).hours).toBe(8.5);
    expect(xport.dayRow(day({ last_clock_out_at: null })).hours).toBeNull();
  });

  it("names the weekday and marks whether the day was expected", () => {
    const r = xport.dayRow(day());
    expect(r.weekday).toBe("Monday");
    expect(r.expected).toBe(true);
    expect(xport.dayRow(day({ status: "WEEKEND" })).expected).toBe(false);
  });

  it("distinguishes no-GPS from off-site in the on_site column", () => {
    expect(xport.dayRow(day({ within_geofence: true })).on_site).toBe("Yes");
    expect(xport.dayRow(day({ within_geofence: false })).on_site).toBe("No");
    expect(xport.dayRow(day({ location_source: "none", latitude: null, longitude: null, within_geofence: null })).on_site).toBe("No GPS");
    expect(xport.dayRow(day({ within_geofence: null })).on_site).toBe("No worksite");
  });

  it("reports the deduction as a number and the waiver as a boolean", () => {
    expect(xport.dayRow(day()).deduction).toBe(1500);
    expect(xport.dayRow(day()).waived).toBe(false);
    const waived = xport.dayRow(day({ justified: true, justification: "Approved by HR" }));
    expect(waived.waived).toBe(true);
    expect(waived.justification).toBe("Approved by HR");
  });

  it("keeps a tri-state device_trusted tri-state — null is 'never judged'", () => {
    expect(xport.dayRow(day({ device_trusted: true })).device_trusted).toBe(true);
    expect(xport.dayRow(day({ device_trusted: false })).device_trusted).toBe(false);
    expect(xport.dayRow(day({ device_trusted: null })).device_trusted).toBeNull();
  });
});

describe("filename", () => {
  it("carries the window", () => {
    expect(xport.filename("2026-08-01", "2026-08-31", "xlsx")).toBe("attendance-2026-08-01-2026-08-31.xlsx");
    expect(xport.filename("2026-08-01", "2026-08-31", "csv")).toBe("attendance-2026-08-01-2026-08-31.csv");
  });
});

describe("build", () => {
  const input = {
    days: [day()],
    punches: [{
      employee_name: "Ada Mbeki",
      clock_in_at: "2026-08-03T08:30:00Z",
      clock_out_at: "2026-08-03T17:00:00Z",
      latitude: 4.05, longitude: 9.76, within_geofence: true,
      geo_label: "Bonabéri, Douala", distance_m: 42,
      device_label: "Yard tablet", is_late: true,
    }],
    from: "2026-08-01",
    to: "2026-08-31",
    timeZone: TZ,
  };

  it("produces a real workbook with both sheets and readable rows", async () => {
    const out = await xport.build({ ...input, format: "xlsx", context: ctx() });
    expect(out.filename).toBe("attendance-2026-08-01-2026-08-31.xlsx");
    expect(out.contentType).toMatch(/spreadsheetml/);

    const parsed = await parseWorkbook(out.buffer);
    expect(Object.keys(parsed).sort()).toEqual(["Days", "Punches"]);
    expect(parsed.Days).toHaveLength(1);
    expect(parsed.Days[0].Employee).toBe("Ada Mbeki");
    expect(parsed.Days[0]["Minutes late"]).toBe(30);
  });

  it("writes stamps in the tenant timezone, not UTC", async () => {
    const out = await xport.build({ ...input, format: "csv", context: ctx() });
    const body = out.buffer.toString("utf8");
    // 08:30Z is 09:30 in Douala — payroll reads the local clock.
    expect(body).toContain("2026-08-03 09:30");
    expect(body).not.toContain("2026-08-03 08:30");
  });

  it("names the tenant's currency in the money header", async () => {
    const out = await xport.build({ ...input, format: "csv", context: ctx() });
    // The service's own header convention: "<label> · <ISO code>".
    expect(out.buffer.toString("utf8").split("\r\n")[0]).toMatch(/Deduction · XAF/);
  });

  it("renders booleans as words, never as true/false or null", async () => {
    const out = await xport.build({
      ...input,
      days: [day({ device_trusted: null })],
      format: "csv",
      context: ctx(),
    });
    const row = out.buffer.toString("utf8").split("\r\n")[1];
    expect(row).toContain("Yes");
    expect(row).not.toMatch(/\btrue\b|\bfalse\b|\bnull\b|\bundefined\b/);
  });

  it("csv defaults to Days and switches to Punches on request", async () => {
    const days = await xport.build({ ...input, format: "csv", context: ctx() });
    const head = days.buffer.toString("utf8").split("\r\n")[0];
    expect(days.filename).toMatch(/\.csv$/);
    expect(head).toMatch(/^\uFEFFEmployee,Department,Entity,Work date/);

    const punches = await xport.build({ ...input, format: "csv", sheet: "punches", context: ctx() });
    expect(punches.buffer.toString("utf8").split("\r\n")[0]).toMatch(/^\uFEFFEmployee,Clock in,Clock out/);
  });

  it("reports truncation rather than handing over a silent prefix", async () => {
    const small = await xport.build({ ...input, format: "csv", context: ctx() });
    expect(small.truncated).toBe(false);
  });

  it("builds an empty window without throwing", async () => {
    const out = await xport.build({ days: [], punches: [], from: "2026-08-01", to: "2026-08-31", format: "xlsx", context: ctx() });
    const parsed = await parseWorkbook(out.buffer);
    expect(parsed.Days).toEqual([]);
  });
});
