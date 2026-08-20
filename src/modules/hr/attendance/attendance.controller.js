"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler, AppError } = require("../../../utils/errors");
const service = require("./attendance.service");
const reconcile = require("./attendance.reconcile");
const xport = require("./attendance.export");
const analytics = require("./attendance.analytics");

const base = makeController(service, "Attendance");
const actor = (req) => req.user || { user_id: null };

/** A user with no employee record has an empty window, not a 404. */
const emptyAnalytics = (from, to) => analytics.summarize({ days: [], punches: [], from, to });

/**
 * Hand a built file to the browser.
 *
 * `X-Export-Truncated` rather than silence: the row cap is real (§6.7) and a
 * client that asked for thirteen months of a 300-person roster deserves to be
 * told its file stops early, not left to discover it in a payroll run.
 */
function sendExport(res, built) {
  res.setHeader("Content-Type", built.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${built.filename}"`);
  if (built.truncated) res.setHeader("X-Export-Truncated", "1");
  return res.send(built.buffer);
}

module.exports = {
  ...base,

  // ── Self-service time clock ──
  clockIn: asyncHandler(async (req, res) => {
    // Same rule as registerDevice: the header is the browser's own claim and
    // wins over anything the body says about itself.
    const body = req.body.device
      ? { ...req.body, device: { ...req.body.device, user_agent: req.get("user-agent") || req.body.device.user_agent || null } }
      : req.body;
    const row = await req.tenantDb((c) => service.clockIn(c, { ...body, actor: actor(req) }));
    res.status(201).json({ data: row });
  }),
  clockOut: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.clockOut(c, { ...req.body, actor: actor(req) }));
    res.json({ data: row });
  }),
  open: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.open(c, { employeeId: req.query.employee_id || null, actor: actor(req) }));
    res.json({ data: row });
  }),

  // Manager view: who hasn't clocked in on a given day.
  absence: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.absence(c, { date: req.query.date || null })) });
  }),

  /**
   * Geoapify place search for the worksite form.
   *
   * NOT wrapped in `req.tenantDb`. The other handlers here take a connection
   * because they read or write; this one only calls an HTTP provider, and the
   * geoapify service's contract is explicit that callers must be OUTSIDE a
   * transaction so the round trip never holds a pooled connection open — on a
   * topology with a 12-connection-per-tenant ceiling, a stalled provider would
   * otherwise take the tenant's whole pool with it.
   */
  placeSearch: asyncHandler(async (req, res) => {
    const { q, country, limit } = req.validatedQuery;
    res.json({ data: await service.searchPlaces(q, { country, limit }) });
  }),

  // ── Registered devices ──
  listDevices: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.listDevices(c, { employee_id: req.query.employee_id || null })) })),
  registerDevice: asyncHandler(async (req, res) => {
    // The user agent is taken from the REQUEST HEADER, not from the body, even
    // though the body may carry one: the header is what the browser actually
    // sent. A self-reported string is still stored when the header is absent
    // (some installed-PWA webviews), but it never overrides the real one.
    const device = { ...req.body.device, user_agent: req.get("user-agent") || req.body.device.user_agent || null };
    const row = await req.tenantDb((c) => service.registerDevice(c, { employeeId: req.body.employee_id || null, device, actor: actor(req) }));
    res.status(201).json({ data: row });
  }),
  renameOwnDevice: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.renameOwnDevice(c, { id: req.params.deviceId, label: req.body.label, actor: actor(req) })) })),
  updateDevice: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.setDeviceStatus(c, { id: req.params.deviceId, patch: req.body, actor: actor(req) })) })),

  // ── Worksites (geofence centres) ──
  listSites: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listSites(c)) })),
  createSite: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.createSite(c, { data: req.body, actor: actor(req) })) })),
  updateSite: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.updateSite(c, { id: req.params.siteId, patch: req.body, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Worksite not found", 404);
    res.json({ data: row });
  }),

  /* ── Reconciled days (0697) ──────────────────────────────────────────────
   *
   * `daysFor` is the month a manager reviews and the month an employee sees;
   * `setJustified` is the ONE place a lateness decision changes money, called
   * by both the query inbox and the payroll review sheet so the two can never
   * show different answers.
   */
  /*
   * The day table honours the SAME filters as the analytics strip above it.
   * If it did not, an HR user narrowing to one department would read totals for
   * that department over a table of everybody — two answers to one question on
   * one screen.
   */
  days: asyncHandler(async (req, res) => {
    const { from, to, employee_id: employeeId, employee_ids: employeeIds, department } = req.validatedQuery;
    res.json({
      data: await req.tenantDb((c) => reconcile.daysFor(c, {
        employeeId: employeeId || null, employeeIds: employeeIds || null, department: department || null, from, to,
      })),
    });
  }),
  myDays: asyncHandler(async (req, res) => {
    const eid = req.user.employee_id;
    if (!eid) return res.json({ data: [] });
    const { from, to } = req.validatedQuery;
    return res.json({ data: await req.tenantDb((c) => reconcile.daysFor(c, { employeeId: eid, from, to })) });
  }),

  /* ── Analytics + export (PR2) ─────────────────────────────────────────────
   *
   * The `/mine` twins take NO MOD-14 grant, matching `/days/mine`: a person is
   * always entitled to their own attendance. They are separate endpoints rather
   * than a `scope=mine` flag on the HR one precisely so the grant is decided by
   * the ROUTE — a query parameter that widens what you can see is one typo away
   * from being the whole authorization story.
   *
   * On each `/mine` handler the employee id comes from the session and the
   * caller's own filters are dropped, so no `employee_id` in a query string can
   * point them at somebody else's rows.
   */
  analytics: asyncHandler(async (req, res) => {
    const { from, to, employee_id: employeeId, employee_ids: employeeIds, department } = req.validatedQuery;
    res.json({
      data: await req.tenantDb((c) => service.analytics(c, {
        employeeId: employeeId || null, employeeIds: employeeIds || null, department: department || null, from, to,
      })),
    });
  }),

  myAnalytics: asyncHandler(async (req, res) => {
    const eid = req.user.employee_id;
    const { from, to } = req.validatedQuery;
    // An unlinked user is not an error — they simply have no attendance yet.
    if (!eid) return res.json({ data: emptyAnalytics(from, to) });
    return res.json({ data: await req.tenantDb((c) => service.analytics(c, { employeeId: eid, from, to })) });
  }),

  exportDays: asyncHandler(async (req, res) => {
    const { from, to, employee_id: employeeId, employee_ids: employeeIds, department, format, sheet } = req.validatedQuery;
    const rows = await req.tenantDb((c) => service.exportData(c, {
      employeeId: employeeId || null, employeeIds: employeeIds || null, department: department || null, from, to,
    }));
    return sendExport(res, await xport.build({ ...rows, from, to, format, sheet }));
  }),

  myExport: asyncHandler(async (req, res) => {
    const eid = req.user.employee_id;
    const { from, to, format, sheet } = req.validatedQuery;
    const rows = eid
      ? await req.tenantDb((c) => service.exportData(c, { employeeId: eid, from, to }))
      : { days: [], punches: [], timeZone: "UTC" };
    return sendExport(res, await xport.build({ ...rows, from, to, format, sheet }));
  }),

  myPunches: asyncHandler(async (req, res) => {
    const eid = req.user.employee_id;
    if (!eid) return res.json({ data: [] });
    const { from, to } = req.validatedQuery;
    return res.json({ data: await req.tenantDb((c) => service.punchesForEmployee(c, { employeeId: eid, from, to })) });
  }),
  justifyDay: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => reconcile.setJustified(c, {
      id: req.params.dayId, justified: req.body.justified,
      justification: req.body.justification ?? null, actor: actor(req),
    }));
    if (!row) throw new AppError("NOT_FOUND", "Attendance day not found", 404);
    res.json({ data: row });
  }),
  // Re-run a date by hand — after a punch is corrected, a leave is approved
  // late, or a rule is switched on. Idempotent by construction (see the
  // reconciler), so this is safe to press twice.
  runReconcile: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => reconcile.reconcileDate(c, { date: req.body.date || null, actor: actor(req) })) })),

  // Admin clock-out on a specific row (kept for corrections).
  clockOutById: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.clockOut(c, { id: req.params.id, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Attendance not found", 404);
    res.json({ data: row });
  }),
};
