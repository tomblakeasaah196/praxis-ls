"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const line = z.object({
  account_code: z.string().min(1),
  debit: z.number().nonnegative().optional(),
  credit: z.number().nonnegative().optional(),
  dossier_id: z.string().uuid().optional(),
  dictionary_item_id: z.string().uuid().optional(),
  is_debours: z.boolean().optional(),
  tax_code_id: z.string().uuid().optional(),
  currency: z.string().length(3).optional(),
  fx_rate: z.number().positive().optional(),
});

const post = z.object({
  journal_code: z.string().min(1).optional(),
  journal_id: z.string().uuid().optional(),
  entity_id: z.string().uuid(),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "entry_date must be YYYY-MM-DD"),
  description: z.string().optional(),
  source_doc_ref: z.string().optional(),
  source: z.enum(["SYSTEM_AUTO", "SYSTEM_RULE", "HUMAN_MANUAL", "HUMAN_CORRECTION"]).optional(),
  validate: z.boolean().optional(),
  lines: z.array(line).min(2),
}).refine((v) => v.journal_code || v.journal_id, {
  message: "journal_code or journal_id is required",
  path: ["journal_code"],
});

const reverse = z.object({
  reason: z.string().optional(),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const schemas = { post, reverse };
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { post: mw("post"), reverse: mw("reverse"), schemas };
