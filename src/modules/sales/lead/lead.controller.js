"use strict";
const service = require("./lead.service");
const sales360 = require("../sales-360.service");
const { canSeeFinancials } = require("../../master/_shared/confidential");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };

module.exports = {
  /**
   * The 360° dossier (GET /leads/:id/360): the row, its next step, the four
   * tabs' data (Activity, Requests, Quotations, Details) and the collections
   * the screen before the revamp reads.
   *
   * Money is gated on the SAME finance-visibility check the party masters use,
   * rather than a second rule invented here. See sales-360.service for what
   * that hides and why it hides it as null rather than zero.
   */
  dossier: asyncHandler(async (req, res) => {
    const canSee = await canSeeFinancials(req);
    res.json({
      data: await req.tenantDb((c) =>
        sales360.leadDossier(c, { leadId: req.params.id, canSeeFinancials: canSee, user: req.user || null }),
      ),
    });
  }),

  /** One page of company rows, its total and the three tiles (§3.2). */
  list: asyncHandler(async (req, res) => {
    const canSee = await canSeeFinancials(req);
    const out = await req.tenantDb((c) =>
      service.list(c, req.validatedQuery || req.query, { userId: actor(req).user_id, canSeeFinancials: canSee }),
    );
    res.json({ data: out.rows, total: out.total, tiles: out.tiles, limit: out.limit, offset: out.offset });
  }),

  /** "Already here?" while the capture form is typed. */
  duplicates: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.duplicates(c, req.validatedQuery)) }),
  ),

  get: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!r) throw new AppError("NOT_FOUND", "Lead not found", 404);
    res.json({ data: r });
  }),

  create: asyncHandler(async (req, res) =>
    res.status(201).json({ data: await req.tenantDb((c) => service.capture(c, { data: req.body, actor: actor(req) })) }),
  ),

  update: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actor(req) })) }),
  ),

  logActivity: asyncHandler(async (req, res) =>
    res.status(201).json({ data: await req.tenantDb((c) => service.logActivity(c, { id: req.params.id, data: req.body, actor: actor(req) })) }),
  ),

  setNextStep: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.setNextStep(c, { id: req.params.id, step: req.body, actor: actor(req) })) }),
  ),

  done: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.completeNextStep(c, { id: req.params.id, data: req.body, actor: actor(req) })) }),
  ),

  archive: asyncHandler(async (req, res) =>
    res.json({
      data: await req.tenantDb((c) => service.archive(c, {
        id: req.params.id, reason: req.body.reason, reasonCode: req.body.reason_code || "OTHER", actor: actor(req),
      })),
    }),
  ),

  reopen: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.reopen(c, { id: req.params.id, nextStep: req.body.next_step, actor: actor(req) })) }),
  ),

  makeClient: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.makeClient(c, { id: req.params.id, clientData: req.body.client || {}, actor: actor(req) })) }),
  ),

  /** The company row of a client: found, or made from the client master. */
  clientRow: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb(async (c) => service.get(c, (await service.clientRow(c, { clientId: req.params.clientId, actor: actor(req) })).lead_id)) }),
  ),
};
