"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const schemas = {
  create: z.object({ code: z.string().min(1), legal_name: z.string().min(1), niu: z.string().optional().nullable(), rccm: z.string().optional().nullable(), country_code: z.string().length(2).optional(), address: z.string().optional().nullable(), bank_block: z.record(z.any()).optional(), doc_prefix: z.string().optional(), default_language: z.enum(["fr", "en"]).optional(), fiscal_year_start_month: z.number().int().min(1).max(12).optional() }),
  update: z.object({ legal_name: z.string().optional(), niu: z.string().optional().nullable(), rccm: z.string().optional().nullable(), country_code: z.string().length(2).optional(), address: z.string().optional().nullable(), bank_block: z.record(z.any()).optional(), doc_prefix: z.string().optional(), default_language: z.enum(["fr", "en"]).optional(), fiscal_year_start_month: z.number().int().min(1).max(12).optional() }),
  setActive: z.object({ active: z.boolean() }),
};
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { create: mw("create"), update: mw("update"), setActive: mw("setActive"), schemas };
