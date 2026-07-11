"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const issue = z.object({
  holder_user_id: z.string().uuid().optional(),
  amount: z.number().positive(),
  entity_id: z.string().uuid(),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source_doc_ref: z.string().min(1),
  policy_window_days: z.number().int().positive().optional(),
});
const ageDue = z.object({
  entity_id: z.string().uuid(),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source_doc_ref: z.string().min(1),
});
const schemas = { issue, ageDue };
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};
module.exports = { issue: mw("issue"), ageDue: mw("ageDue"), schemas };
