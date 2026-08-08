"use strict";
const service = require("./treasury_category.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };

module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!r) throw new AppError("NOT_FOUND", "Treasury category not found", 404);
    res.json({ data: r });
  }),
  create: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.create(c, {
      code: b.code, label: b.label, legacyKind: b.legacy_kind, coaParentCode: b.coa_parent_code,
      requiresCustodian: b.requires_custodian, isBankIdentity: b.is_bank_identity, isMomoIdentity: b.is_momo_identity,
      actor: actor(req),
    }));
    res.status(201).json({ data });
  }),
  update: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actor(req) })),
  })),
  setActive: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((c) => service.setActive(c, { id: req.params.id, active: req.body.active === true, actor: actor(req) })),
  })),
  remove: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((c) => service.remove(c, { id: req.params.id, actor: actor(req) })),
  })),
};
