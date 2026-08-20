"use strict";
/**
 * Analytics + export endpoints (PR2) — the window rules and the `/mine` scope.
 *
 * The self-scoping assertions are the important ones. `/mine` takes no MOD-14
 * grant, so the ONLY thing standing between a linked employee and somebody
 * else's attendance is that the handler ignores caller-supplied filters and
 * uses the session's employee id. That is a security property, so it is tested
 * rather than trusted.
 */

const validator = require("../../src/modules/hr/attendance/attendance.validator");
const service = require("../../src/modules/hr/attendance/attendance.service");
const controller = require("../../src/modules/hr/attendance/attendance.controller");

const { analyticsWindow, exportWindow, dayWindow } = validator.schemas;

describe("reporting window", () => {
  it("accepts a full leap year, inclusive at both ends", () => {
    expect(analyticsWindow.safeParse({ from: "2028-01-01", to: "2028-12-31" }).success).toBe(true);
    expect(analyticsWindow.safeParse({ from: "2026-01-01", to: "2027-01-01" }).success).toBe(true);
  });

  it("refuses more than 366 days", () => {
    const out = analyticsWindow.safeParse({ from: "2026-01-01", to: "2027-01-03" });
    expect(out.success).toBe(false);
    expect(JSON.stringify(out.error.flatten().fieldErrors)).toMatch(/at most a year/i);
  });

  it("refuses a window that ends before it starts", () => {
    const out = dayWindow.safeParse({ from: "2026-08-10", to: "2026-08-01" });
    expect(out.success).toBe(false);
    expect(JSON.stringify(out.error.flatten().fieldErrors)).toMatch(/must not precede/i);
  });

  it("still refuses a malformed date", () => {
    expect(dayWindow.safeParse({ from: "10/08/2026", to: "2026-08-11" }).success).toBe(false);
  });
});

describe("employee_ids", () => {
  const ID = "11111111-1111-4111-8111-111111111111";

  it("normalises a single query value into an array", () => {
    // One selected employee arrives as a bare string, not a one-element array.
    const out = analyticsWindow.safeParse({ from: "2026-08-01", to: "2026-08-31", employee_ids: ID });
    expect(out.success).toBe(true);
    expect(out.data.employee_ids).toEqual([ID]);
  });

  it("keeps an array as an array", () => {
    const b = "22222222-2222-4222-8222-222222222222";
    const out = analyticsWindow.safeParse({ from: "2026-08-01", to: "2026-08-31", employee_ids: [ID, b] });
    expect(out.data.employee_ids).toEqual([ID, b]);
  });

  it("caps the multi-select at 50", () => {
    const many = Array.from({ length: 51 }, (_, i) => `1111111${String(i).padStart(4, "0")}-1111-4111-8111-111111111111`.slice(0, 36));
    const out = analyticsWindow.safeParse({ from: "2026-08-01", to: "2026-08-31", employee_ids: many });
    expect(out.success).toBe(false);
  });

  it("rejects a non-uuid rather than passing it to the query", () => {
    expect(analyticsWindow.safeParse({ from: "2026-08-01", to: "2026-08-31", employee_ids: ["not-a-uuid"] }).success).toBe(false);
  });
});

describe("export window", () => {
  it("defaults to an xlsx of Days", () => {
    const out = exportWindow.safeParse({ from: "2026-08-01", to: "2026-08-31" });
    expect(out.data.format).toBe("xlsx");
    expect(out.data.sheet).toBe("days");
  });

  it("refuses a format it cannot produce", () => {
    expect(exportWindow.safeParse({ from: "2026-08-01", to: "2026-08-31", format: "pdf" }).success).toBe(false);
  });
});

/** Minimal express doubles. */
function res() {
  const r = { headers: {}, body: null, statusCode: 200 };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.json = (v) => { r.body = v; return r; };
  r.send = (v) => { r.body = v; return r; };
  r.status = (c) => { r.statusCode = c; return r; };
  return r;
}
const run = (handler, req) => {
  const r = res();
  return Promise.resolve(handler(req, r, (e) => { throw e; })).then(() => r);
};

describe("/mine self-scoping", () => {
  afterEach(() => jest.restoreAllMocks());

  it("analytics/mine uses the session employee and ignores a supplied employee_id", async () => {
    const spy = jest.spyOn(service, "analytics").mockResolvedValue({ totals: {} });
    const r = await run(controller.myAnalytics, {
      user: { user_id: "u1", employee_id: "emp-self" },
      // A caller trying to read somebody else's window.
      validatedQuery: { from: "2026-08-01", to: "2026-08-31", employee_id: "emp-someone-else", employee_ids: ["emp-x"], department: "Finance" },
      tenantDb: (fn) => fn({}),
    });
    expect(r.body.data).toEqual({ totals: {} });
    const args = spy.mock.calls[0][1];
    expect(args.employeeId).toBe("emp-self");
    expect(args.employeeIds).toBeUndefined();
    expect(args.department).toBeUndefined();
  });

  it("analytics/mine returns an empty window for a user with no employee record", async () => {
    const spy = jest.spyOn(service, "analytics");
    const r = await run(controller.myAnalytics, {
      user: { user_id: "u1", employee_id: null },
      validatedQuery: { from: "2026-08-01", to: "2026-08-31" },
      tenantDb: (fn) => fn({}),
    });
    expect(spy).not.toHaveBeenCalled();
    expect(r.body.data.totals.expected_days).toBe(0);
    expect(r.body.data.by_employee).toEqual([]);
  });

  it("export/mine scopes to the session employee", async () => {
    const spy = jest.spyOn(service, "exportData").mockResolvedValue({ days: [], punches: [], timeZone: "Africa/Douala" });
    const r = await run(controller.myExport, {
      user: { user_id: "u1", employee_id: "emp-self" },
      validatedQuery: { from: "2026-08-01", to: "2026-08-31", employee_id: "emp-other", format: "csv", sheet: "days" },
      tenantDb: (fn) => fn({}),
    });
    expect(spy.mock.calls[0][1].employeeId).toBe("emp-self");
    expect(r.headers["content-disposition"]).toBe('attachment; filename="attendance-2026-08-01-2026-08-31.csv"');
    expect(r.headers["content-type"]).toMatch(/text\/csv/);
  });

  it("export/mine still returns a valid empty file for an unlinked user", async () => {
    const spy = jest.spyOn(service, "exportData");
    const r = await run(controller.myExport, {
      user: { user_id: "u1", employee_id: null },
      validatedQuery: { from: "2026-08-01", to: "2026-08-31", format: "csv", sheet: "days" },
      tenantDb: (fn) => fn({}),
    });
    expect(spy).not.toHaveBeenCalled();
    expect(r.body.toString("utf8")).toMatch(/Employee,Department,Entity/);
  });
});

describe("HR export", () => {
  afterEach(() => jest.restoreAllMocks());

  it("passes the multi-select and department through, and names the file for the window", async () => {
    const spy = jest.spyOn(service, "exportData").mockResolvedValue({ days: [], punches: [], timeZone: "Africa/Douala" });
    const r = await run(controller.exportDays, {
      user: { user_id: "u1" },
      validatedQuery: {
        from: "2026-07-01", to: "2026-07-31",
        employee_ids: ["emp-1", "emp-2"], department: "Operations",
        format: "xlsx", sheet: "days",
      },
      tenantDb: (fn) => fn({}),
    });
    const args = spy.mock.calls[0][1];
    expect(args.employeeIds).toEqual(["emp-1", "emp-2"]);
    expect(args.department).toBe("Operations");
    expect(r.headers["content-disposition"]).toMatch(/attendance-2026-07-01-2026-07-31\.xlsx/);
  });
});
