"use strict";
const service = require("./treasury_account.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };

module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!r) throw new AppError("NOT_FOUND", "Treasury account not found", 404);
    res.json({ data: r });
  }),

  create: asyncHandler(async (req, res) => {
    const b = req.body;
    // The validator has already stripped unknown keys and typed everything.
    const data = await req.tenantDb((c) => service.create(c, {
      entityId: b.entity_id, categoryId: b.category_id, actor: actor(req),
      // Splat the rich fields; the service picks the ones it knows.
      ...b,
    }));
    res.status(201).json({ data });
  }),

  update: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.update(c, {
      id: req.params.id, patch: req.body, actor: actor(req),
    })) });
  }),

  setActive: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.setActive(c, {
      id: req.params.id, active: req.body.active === true, actor: actor(req),
    })) });
  }),

  setPrimary: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.setPrimary(c, {
      id: req.params.id, actor: actor(req),
    })) });
  }),

  verify: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.verify(c, {
      id: req.params.id, actor: actor(req),
    })) });
  }),

  unverify: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.unverify(c, {
      id: req.params.id, actor: actor(req),
    })) });
  }),

  // 360 aggregation — one call feeds the whole dossier page.
  dossier: asyncHandler(async (req, res) => {
    const treasury360 = require("../treasury-360.service");
    const data = await req.tenantDb((c) => treasury360.load(c, {
      id: req.params.id, actor: actor(req),
    }));
    if (!data) throw new AppError("NOT_FOUND", "Treasury account not found", 404);
    res.json({ data });
  }),

  // Payment gateways (2.3)
  listGateways: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listGateways(c)) })),
  getGateway:   asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.getGateway(c, req.params.provider)) })),
  upsertGateway: asyncHandler(async (req, res) => {
    const b = req.body;
    res.status(201).json({ data: await req.tenantDb((c) => service.upsertGateway(c, { provider: b.provider, active: b.active, role: b.role, credentials: b.credentials, actor: actor(req) })) });
  }),
  setGatewayActive: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.setGatewayActive(c, { provider: req.params.provider, active: req.body.active === true, actor: actor(req) })) })),
  setGatewayRole:   asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.setGatewayRole(c, { provider: req.params.provider, role: req.body.role, actor: actor(req) })) })),
  deleteGateway:    asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.deleteGateway(c, { provider: req.params.provider, actor: actor(req) })) })),
};
