"use strict";
/**
 * Everyone clocks in (owner's decision, 28 Nov 2026).
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * The time clock's routes sat behind MOD-14 `create`, and the default roles
 * give that grant to HR alone. Every other employee was shown a Clock In button
 * whose punch came back "No permission for MOD-14.create", and nothing in the
 * suite noticed, because no test had ever asked WHO could reach the routes.
 *
 * So this pins three things:
 *
 *   1. the self-service clock routes carry no permission check, and the routes
 *      that act on OTHER people still do (a route table cannot drift back);
 *   2. what stands in for the grant: clock-in always acts on the caller, and
 *      clock-out of somebody else's shift asks for MOD-14 `edit` first;
 *   3. `/attendance/me` tells the clock whether this browser is registered,
 *      so the device's name is asked before the first punch, not after.
 */

jest.mock("../../src/shared/cache/identity-cache", () => ({
  getGrants: jest.fn(async () => []),
  getUserScopeClosure: jest.fn(async () => []),
}));

const identityCache = require("../../src/shared/cache/identity-cache");
const { router } = require("../../src/modules/hr/attendance/attendance.routes");
const controller = require("../../src/modules/hr/attendance/attendance.controller");
const service = require("../../src/modules/hr/attendance/attendance.service");

/** The names of the handlers a route runs, in order. */
function handlersFor(method, path) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`no ${method.toUpperCase()} ${path} on the attendance router`);
  return layer.route.stack.map((s) => s.handle.name);
}

describe("the self-service clock routes take no grant", () => {
  it.each([
    ["post", "/clock-in"],
    ["post", "/clock-out"],
    ["post", "/fix"],
    ["post", "/undo-clock-out"],
    ["patch", "/devices/:deviceId/name"],
    ["get", "/me"],
  ])("%s %s has no permission check", (method, path) => {
    expect(handlersFor(method, path)).not.toContain("rbacCheck");
  });

  it.each([
    ["post", "/devices"],
    ["patch", "/devices/:deviceId"],
    ["post", "/:id/clock-out"],
    ["post", "/:id/reopen"],
    ["post", "/:id/review"],
    ["post", "/"],
  ])("%s %s, which can act on another employee, still has one", (method, path) => {
    expect(handlersFor(method, path)).toContain("rbacCheck");
  });
});

function reqRes({ body = {}, query = {}, grants = [] } = {}) {
  identityCache.getGrants.mockResolvedValue(grants);
  const client = {};
  const res = {
    code: 200,
    body: null,
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
  };
  const req = {
    body,
    query,
    user: { user_id: "user-1", role_ids: ["role-sales"] },
    get: () => "Mozilla/5.0 (Linux; Android 14) Chrome/158.0",
    tenantDbIn: (_env, fn) => fn(client),
    identityDb: (fn) => fn({}),
  };
  return { req, res, client };
}

/** Run a controller handler and resolve with the error it passed on, if any. */
async function run(handler, req, res) {
  let passed = null;
  await handler(req, res, (err) => { passed = err || null; });
  return passed;
}

afterEach(() => jest.restoreAllMocks());

describe("what stands in for the grant", () => {
  it("clock-in acts on the caller whatever the body names, with the browser's own user agent", async () => {
    const spy = jest.spyOn(service, "clockIn").mockResolvedValue({ attendance_id: "a1" });
    const { req, res } = reqRes({
      body: { employee_id: "someone-else", device: { fingerprint: "abcdef0123456789", label: "Yard tablet" } },
    });
    expect(await run(controller.clockIn, req, res)).toBeNull();
    expect(res.code).toBe(201);
    const args = spy.mock.calls[0][1];
    expect(args).not.toHaveProperty("employee_id");
    expect(args.actor.user_id).toBe("user-1");
    expect(args.device).toMatchObject({ label: "Yard tablet", user_agent: expect.stringContaining("Android") });
  });

  it("clock-out of the caller's own shift needs no grant", async () => {
    const spy = jest.spyOn(service, "clockOut").mockResolvedValue({ attendance_id: "a1" });
    const { req, res } = reqRes({ body: { tapped_at: "2026-11-28T16:00:00.000Z" } });
    expect(await run(controller.clockOut, req, res)).toBeNull();
    expect(spy.mock.calls[0][1]).toMatchObject({ id: null, employeeId: null, tapped_at: "2026-11-28T16:00:00.000Z" });
  });

  it("clock-out of a NAMED shift is refused without MOD-14 edit, and nothing is closed", async () => {
    const spy = jest.spyOn(service, "clockOut");
    const { req, res } = reqRes({ body: { id: "a9a9a9a9-0000-4000-8000-000000000000" }, grants: [{ can_create: true }] });
    const err = await run(controller.clockOut, req, res);
    expect(err).toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("clock-out of a named shift goes through for a role holding MOD-14 edit", async () => {
    const spy = jest.spyOn(service, "clockOut").mockResolvedValue({ attendance_id: "a9" });
    const id = "a9a9a9a9-0000-4000-8000-000000000000";
    const { req, res } = reqRes({ body: { id }, grants: [{ can_update: true }] });
    expect(await run(controller.clockOut, req, res)).toBeNull();
    expect(spy.mock.calls[0][1]).toMatchObject({ id });
  });
});

describe("/attendance/me knows the device before the tap", () => {
  it("passes this browser's device id through, bounded", async () => {
    const spy = jest.spyOn(service, "me").mockResolvedValue({ linked: true });
    const { req, res } = reqRes({ query: { device: "abcdef0123456789" } });
    await run(controller.me, req, res);
    expect(spy.mock.calls[0][1].fingerprint).toBe("abcdef0123456789");
  });

  it("treats a malformed device id as none, rather than refusing the clock", async () => {
    const spy = jest.spyOn(service, "me").mockResolvedValue({ linked: true });
    for (const device of ["short", ["a", "b"], "x".repeat(201)]) {
      const { req, res } = reqRes({ query: { device } });
      expect(await run(controller.me, req, res)).toBeNull();
      expect(spy.mock.calls.at(-1)[1].fingerprint).toBeNull();
    }
  });
});
