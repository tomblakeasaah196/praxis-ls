"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const schemas = {
  create: z.object({ po_id: z.string().uuid(), received_by: z.string().uuid().optional().nullable(), supplier_invoice_ref: z.string().optional(), entity_id: z.string().uuid().optional().nullable(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
};
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { create: mw("create"), schemas };
