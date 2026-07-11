"use strict";
const service = require("./purchase_order.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!row) throw new AppError("NOT_FOUND", "Purchase order not found", 404);
    res.json({ data: row });
  }),
  create: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.createDraft(c, { prId: b.pr_id, supplierId: b.supplier_id, dossierId: b.dossier_id, expenseCategory: b.expense_category, items: b.items || [], actor: actor(req) }));
    res.status(201).json({ data });
  }),
  update: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.updateDraft(c, { poId: req.params.id, items: b.items || null, patch: { supplier_id: b.supplier_id, dossier_id: b.dossier_id, expense_category: b.expense_category }, actor: actor(req) }));
    res.json({ data });
  }),
  transition: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.transition(c, { poId: req.params.id, to: b.to, entityId: b.entity_id, date: b.date, actor: actor(req) }));
    res.json({ data });
  }),
};
