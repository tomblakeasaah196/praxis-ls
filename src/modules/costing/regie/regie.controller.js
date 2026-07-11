"use strict";
const service = require("./regie.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!row) throw new AppError("NOT_FOUND", "Régie advance not found", 404);
    res.json({ data: row });
  }),
  issue: asyncHandler(async (req, res) => {
    const b = req.body;
    const r = await req.tenantDb((c) => service.issue(c, {
      holderUserId: b.holder_user_id, amount: b.amount, entityId: b.entity_id,
      entryDate: b.entry_date, sourceDocRef: b.source_doc_ref, policyWindowDays: b.policy_window_days,
      actor: actor(req), ip: req.ip,
    }));
    res.status(201).json({ data: r });
  }),
  ageDue: asyncHandler(async (req, res) => {
    const b = req.body;
    const r = await req.tenantDb((c) => service.ageDue(c, {
      entityId: b.entity_id, entryDate: b.entry_date, sourceDocRef: b.source_doc_ref,
      actor: actor(req), ip: req.ip,
    }));
    res.json({ data: r });
  }),
};
