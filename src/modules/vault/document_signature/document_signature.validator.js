"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const sign = z.object({
  entity_ref: z.string().min(1),
  signer_name: z.string().optional(),
  method: z.enum(["DIGITAL", "PHYSICAL"]).optional(),
  signature_ref: z.string().optional(),
});
const schemas = { sign };
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};
module.exports = { sign: mw("sign"), schemas };
