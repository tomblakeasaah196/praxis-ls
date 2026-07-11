"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const pay = z.object({
  entity_id: z.string().uuid(),
  client_id: z.string().uuid().optional(),
  dossier_id: z.string().uuid().optional(),
  amount: z.number().positive(),
  treasury_coa: z.string().optional(),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source_doc_ref: z.string().min(1),
});
const schemas = { pay };
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};
module.exports = { pay: mw("pay"), schemas };
