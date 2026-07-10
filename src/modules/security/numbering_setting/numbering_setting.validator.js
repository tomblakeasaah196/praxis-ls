"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const scheme = z.object({
  prefix: z.string().max(12).optional(),
  code: z.string().max(12).optional(),
  padding: z.number().int().min(1).max(10).optional(),
  reset: z.enum(["yearly", "never"]).optional(),
  separator: z.string().max(3).optional(),
});
const put = z.object({ scheme });
const schemas = { put };
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};
module.exports = { put: mw("put"), schemas };
