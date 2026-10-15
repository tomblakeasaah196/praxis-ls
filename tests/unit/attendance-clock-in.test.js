"use strict";
/**
 * Clock-in return contract (PR1).
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * `location_status` on the punch response was written as
 * `locationStatus({ ...row, location_source })` — shorthand for an identifier
 * that no scope in the function declared. Under "use strict" that is a
 * ReferenceError on EVERY clock-in, not an edge case, and the suite did not
 * notice: nothing in `tests/` had ever called `clockIn`. The endpoint people
 * are paid through was reachable only through the linter.
 *
 * That is the same failure the comment above `repo.create` in the service
 * already describes ("threw on EVERY clock-in — the endpoint had never once
 * worked"), reintroduced on the same line of the same function. A comment
 * recording a bug does not prevent it; a test that calls the function does.
 *
 * So this asserts the whole contract of the returned punch, not merely that the
 * call does not throw.
 */

const repo = require("../../src/modules/hr/attendance/attendance.repo");
const { getSetting } = require("../../src/shared/config/settings");

jest.mock("../../src/modules/hr/attendance/attendance.repo", () => ({
  // makeService reads cfg at construction to build __entityMeta.
  cfg: { table: "attendance_log", pk: "attendance_id", activeColumn: null },
  employeeIdForUser: jest.fn(),
  openForEmployee: jest.fn(async () => null),
  entityForEmployee: jest.fn(async () => "entity-1"),
  activeSitesForEntity: jest.fn(async () => []),
  upsertDevice: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  findById: jest.fn(),
  lastForEmployee: jest.fn(async () => null),
  findByClientRef: jest.fn(async () => null),
  dayReconciled: jest.fn(async () => false),
}));
jest.mock("../../src/modules/hr/attendance/attendance.reconcile", () => ({
  reconcileDate: jest.fn(async () => ({})),
  timezoneOf: jest.fn(async () => "Africa/Douala"),
}));
jest.mock("../../src/modules/master/employees/employees.service", () => ({
  assertActive: jest.fn(async () => true),
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => null),
  audit: jest.fn(async () => null),
  resolveActorId: jest.fn(async () => null),
}));
jest.mock("../../src/shared/config/settings", () => ({ getSetting: jest.fn() }));
jest.mock("../../src/services/geoapify.service", () => ({
  reverseGeocode: jest.fn(async () => "Bonabéri, Douala"),
}));
jest.mock("../../src/modules/hr/attendance/attendance.query", () => ({
  upsertAutoQuery: jest.fn(async () => null),
}));

const service = require("../../src/modules/hr/attendance/attendance.service");

/** Settings this path reads. Defaults chosen so nothing blocks the punch. */
function settings(overrides = {}) {
  const table = {
    geofence: "off",
    device_policy: "off",
    attendance_policy: null,
    timezone: "Africa/Douala",
    ...overrides,
  };
  getSetting.mockImplementation(async (_client, _scope, key, fallback) =>
    key in table ? table[key] : fallback,
  );
}

/** No lateness rule — keeps the auto-query branch out of this test's way. */
const client = { query: async () => ({ rows: [] }) };

beforeEach(() => {
  jest.clearAllMocks();
  settings();
});

describe("clockIn", () => {
  it("returns the punch with a location_status (regression: undeclared location_source)", async () => {
    repo.create.mockResolvedValue({
      attendance_id: "att-1",
      clock_in_at: new Date("2026-08-19T07:30:00Z"),
      latitude: 4.05,
      longitude: 9.76,
      within_geofence: true,
      location_source: "gps",
    });

    const out = await service.clockIn(client, {
      employeeId: "emp-1",
      latitude: 4.05,
      longitude: 9.76,
      accuracy: 12,
    });

    expect(out.attendance_id).toBe("att-1");
    expect(out.location_status).toBe("on_site");
    expect(out.device_new).toBe(false);
  });

  it("stores gps as the source and keeps the location payload when a fix arrives", async () => {
    repo.create.mockResolvedValue({
      attendance_id: "att-2",
      clock_in_at: new Date(),
      latitude: 4.05,
      longitude: 9.76,
      within_geofence: null,
      location_source: "gps",
    });

    const out = await service.clockIn(client, { employeeId: "emp-1", latitude: 4.05, longitude: 9.76, accuracy: 8 });

    const written = repo.create.mock.calls[0][1];
    expect(written.location_source).toBe("gps");
    expect(written.location).toEqual({ lat: 4.05, lng: 9.76, accuracy: 8 });
    // Coordinates against no worksite is NOT a missing fix.
    expect(out.location_status).toBe("unfenced");
  });

  it("stores none — and no location payload — when the punch had no fix", async () => {
    repo.create.mockResolvedValue({
      attendance_id: "att-3",
      clock_in_at: new Date(),
      latitude: null,
      longitude: null,
      within_geofence: null,
      location_source: "none",
    });

    const out = await service.clockIn(client, { employeeId: "emp-1" });

    const written = repo.create.mock.calls[0][1];
    expect(written.location_source).toBe("none");
    expect(written.location).toBeNull();
    expect(out.location_status).toBe("no_gps");
  });

  it("refuses a second open shift rather than opening one", async () => {
    repo.openForEmployee.mockResolvedValueOnce({ attendance_id: "att-open" });
    await expect(service.clockIn(client, { employeeId: "emp-1" })).rejects.toMatchObject({
      code: "ALREADY_CLOCKED_IN",
      status: 409,
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  /*
   * 14403. These two tests used to read "blocks an off-site punch only under
   * the block policy" and asserted a 422 with no row written. That was the bug:
   * a person at work, refused, with nothing for a manager to look at. `block`
   * now holds the punch instead, and the reconciler does not pay it until a
   * manager approves.
   */
  it("holds an off-site punch under the block policy instead of refusing it", async () => {
    settings({ geofence: "block" });
    repo.activeSitesForEntity.mockResolvedValueOnce([
      { work_site_id: "site-1", latitude: 4.05, longitude: 9.76, radius_m: 100 },
    ]);
    repo.create.mockImplementation(async (_c, data) => ({ attendance_id: "att-held", ...data }));
    // ~1.6 km north of the site — outside a 100 m fence.
    const out = await service.clockIn(client, { employeeId: "emp-1", latitude: 4.065, longitude: 9.76 });

    const written = repo.create.mock.calls[0][1];
    expect(written.within_geofence).toBe(false);
    expect(written.review_status).toBe("PENDING");
    expect(written.review_reasons).toEqual(["off_site"]);
    expect(out.location_status).toBe("off_site");
  });

  it("flags but does not hold an off-site punch under warn", async () => {
    settings({ geofence: "warn" });
    repo.activeSitesForEntity.mockResolvedValueOnce([
      { work_site_id: "site-1", latitude: 4.05, longitude: 9.76, radius_m: 100 },
    ]);
    repo.create.mockImplementation(async (_c, data) => ({ attendance_id: "att-warn", ...data }));
    await service.clockIn(client, { employeeId: "emp-1", latitude: 4.065, longitude: 9.76 });

    const written = repo.create.mock.calls[0][1];
    expect(written.review_status).toBeNull();
    expect(written.review_reasons).toEqual(["off_site"]);
  });

  it("holds a punch from an unapproved device under block instead of refusing it", async () => {
    settings({ device_policy: "block" });
    repo.upsertDevice.mockResolvedValueOnce({ hr_device_id: "dev-1", status: "PENDING", inserted: true });
    repo.create.mockImplementation(async (_c, data) => ({ attendance_id: "att-dev", ...data }));
    const out = await service.clockIn(client, {
      employeeId: "emp-1",
      device: { fingerprint: "abcdefgh1234", location_permission: "granted" },
    });

    const written = repo.create.mock.calls[0][1];
    expect(written.review_status).toBe("PENDING");
    expect(written.review_reasons).toEqual(["device"]);
    expect(written.device_trusted).toBe(false);
    // The register still learns what the phone said about location.
    expect(repo.upsertDevice.mock.calls[0][1].locationPermission).toBe("granted");
    expect(out.device_new).toBe(true);
  });

  it("holds a punch with no device id under block, rather than refusing it", async () => {
    settings({ device_policy: "block" });
    repo.create.mockImplementation(async (_c, data) => ({ attendance_id: "att-nodev", ...data }));
    await service.clockIn(client, { employeeId: "emp-1" });
    const written = repo.create.mock.calls[0][1];
    expect(written.review_status).toBe("PENDING");
    expect(written.review_reasons).toEqual(["device"]);
  });

  it("records why the phone had no location, and only when it had none", async () => {
    repo.create.mockImplementation(async (_c, data) => ({ attendance_id: "att-why", ...data }));
    await service.clockIn(client, { employeeId: "emp-1", location_error: "denied" });
    expect(repo.create.mock.calls[0][1].location_error).toBe("denied");

    await service.clockIn(client, { employeeId: "emp-1", latitude: 4.05, longitude: 9.76, location_error: "timeout" });
    expect(repo.create.mock.calls[1][1].location_error).toBeNull();
  });

  it("keeps the tap time of a punch held offline, and marks it offline", async () => {
    repo.create.mockImplementation(async (_c, data) => ({ attendance_id: "att-off", ...data }));
    const tapped = new Date(Date.now() - 45 * 60_000).toISOString();
    await service.clockIn(client, { employeeId: "emp-1", tapped_at: tapped, client_ref: "6f1c3c0a-4b8e-4c55-9a51-1c2f6f0f3b11" });

    const written = repo.create.mock.calls[0][1];
    expect(written.clock_in_at.toISOString()).toBe(tapped);
    expect(written.punched_offline).toBe(true);
    expect(written.review_status).toBeNull();
    expect(written.client_ref).toBe("6f1c3c0a-4b8e-4c55-9a51-1c2f6f0f3b11");
  });

  it("holds, never refuses, an offline punch whose time does not add up", async () => {
    repo.create.mockImplementation(async (_c, data) => ({ attendance_id: "att-odd", ...data }));
    const tapped = new Date(Date.now() - 30 * 60 * 60_000).toISOString(); // 30 h old
    await service.clockIn(client, { employeeId: "emp-1", tapped_at: tapped });
    const written = repo.create.mock.calls[0][1];
    expect(written.review_status).toBe("PENDING");
    expect(written.review_reasons).toEqual(["offline_time"]);
  });

  it("answers a replayed offline clock-in with the shift it already opened", async () => {
    const ref = "6f1c3c0a-4b8e-4c55-9a51-1c2f6f0f3b11";
    repo.openForEmployee.mockResolvedValueOnce({ attendance_id: "att-open", client_ref: ref, location_source: "none" });
    const out = await service.clockIn(client, { employeeId: "emp-1", client_ref: ref });
    expect(out.attendance_id).toBe("att-open");
    expect(repo.create).not.toHaveBeenCalled();
});
});

describe("attachFix (14403)", () => {
  const actor = { user_id: "user-1" };
  beforeEach(() => {
    repo.employeeIdForUser.mockResolvedValue("emp-1");
    repo.update.mockImplementation(async (_c, _id, patch) => ({ attendance_id: "att-1", employee_id: "emp-1", ...patch }));
  });

  it("judges a reading that lands inside the window as if it came with the punch", async () => {
    settings({ geofence: "block" });
    repo.findByClientRef.mockResolvedValueOnce({
      attendance_id: "att-1", employee_id: "emp-1", clock_in_at: new Date(Date.now() - 8_000),
      location_source: "none", punched_offline: false, review_status: null, review_reasons: [],
    });
    repo.activeSitesForEntity.mockResolvedValueOnce([
      { work_site_id: "site-1", latitude: 4.05, longitude: 9.76, radius_m: 100 },
    ]);
    const out = await service.attachFix(client, {
      client_ref: "6f1c3c0a-4b8e-4c55-9a51-1c2f6f0f3b11", latitude: 4.065, longitude: 9.76, actor,
    });
    const patch = repo.update.mock.calls[0][2];
    expect(patch.location_source).toBe("gps");
    expect(patch.within_geofence).toBe(false);
    expect(patch.review_status).toBe("PENDING");
    expect(out.location_status).toBe("off_site");
  });

  it("labels a reading that lands after the window as late, and judges nothing with it", async () => {
    settings({ geofence: "block" });
    repo.findByClientRef.mockResolvedValueOnce({
      attendance_id: "att-1", employee_id: "emp-1", clock_in_at: new Date(Date.now() - 90_000),
      location_source: "none", punched_offline: false, review_status: null, review_reasons: [],
    });
    const out = await service.attachFix(client, {
      client_ref: "6f1c3c0a-4b8e-4c55-9a51-1c2f6f0f3b11", latitude: 4.065, longitude: 9.76, actor,
    });
    const patch = repo.update.mock.calls[0][2];
    expect(patch.location_source).toBe("late");
    expect(patch).not.toHaveProperty("within_geofence");
    expect(patch).not.toHaveProperty("review_status");
    expect(out.location_status).toBe("delayed_gps");
  });

  it("measures a live punch's delay on the server clock, not the phone's claim", async () => {
    repo.findByClientRef.mockResolvedValueOnce({
      attendance_id: "att-1", employee_id: "emp-1", clock_in_at: new Date(Date.now() - 90_000),
      location_source: "none", punched_offline: false, review_reasons: [],
    });
    await service.attachFix(client, {
      client_ref: "6f1c3c0a-4b8e-4c55-9a51-1c2f6f0f3b11", latitude: 4.05, longitude: 9.76,
      // Claims to have been taken one second after the tap. It arrived 90 s after.
      fix_at: new Date(Date.now() - 89_000).toISOString(),
      actor,
    });
    expect(repo.update.mock.calls[0][2].location_source).toBe("late");
  });

  it("leaves a punch that already has a location alone", async () => {
    repo.findByClientRef.mockResolvedValueOnce({
      attendance_id: "att-1", employee_id: "emp-1", clock_in_at: new Date(), location_source: "gps",
    });
    await service.attachFix(client, { client_ref: "6f1c3c0a-4b8e-4c55-9a51-1c2f6f0f3b11", latitude: 4, longitude: 9, actor });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("refuses somebody else's punch as not found", async () => {
    repo.findById.mockResolvedValueOnce({ attendance_id: "att-9", employee_id: "emp-other", clock_in_at: new Date() });
    await expect(
      service.attachFix(client, { attendance_id: "att-9", latitude: 4, longitude: 9, actor }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});

describe("reviewPunch (14403)", () => {
  const reconcile = require("../../src/modules/hr/attendance/attendance.reconcile");
  const actor = { user_id: "mgr-1" };

  it("approves a held punch and re-runs a day that was already settled", async () => {
    repo.findById.mockResolvedValueOnce({
      attendance_id: "att-1", employee_id: "emp-1", clock_in_at: new Date("2026-10-09T07:10:00Z"),
      review_status: "PENDING", review_reasons: ["off_site"],
    });
    repo.update.mockImplementation(async (_c, _id, patch) => ({
      attendance_id: "att-1", employee_id: "emp-1", clock_in_at: new Date("2026-10-09T07:10:00Z"), ...patch,
    }));
    repo.dayReconciled.mockResolvedValueOnce(true);
    const out = await service.reviewPunch(client, { id: "att-1", decision: "APPROVED", actor });
    expect(out.review_status).toBe("APPROVED");
    expect(reconcile.reconcileDate).toHaveBeenCalledWith(client, { date: "2026-10-09", actor });
  });

  it("will not reject without a reason", async () => {
    await expect(
      service.reviewPunch(client, { id: "att-1", decision: "REJECTED", actor }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
  });

  it("will not decide a punch twice", async () => {
    repo.findById.mockResolvedValueOnce({ attendance_id: "att-1", review_status: "APPROVED" });
    await expect(
      service.reviewPunch(client, { id: "att-1", decision: "APPROVED", actor }),
    ).rejects.toMatchObject({ code: "NOT_PENDING", status: 409 });
  });
});

describe("me (14403)", () => {
  it("tells the clock an unlinked user apart from an employee off shift", async () => {
    repo.employeeIdForUser.mockResolvedValueOnce(null);
    expect(await service.me(client, { actor: { user_id: "admin-1" } })).toEqual({ linked: false, open: null });

    repo.employeeIdForUser.mockResolvedValueOnce("emp-1");
    repo.openForEmployee.mockResolvedValueOnce(null);
    expect(await service.me(client, { actor: { user_id: "user-1" } })).toEqual({ linked: true, open: null });
  });
});
