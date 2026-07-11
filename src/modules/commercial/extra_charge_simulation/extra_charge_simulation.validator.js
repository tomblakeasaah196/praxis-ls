"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const tier = z.object({ from_day: z.number().int().positive(), to_day: z.number().int().positive().nullable().optional(), rate: z.number().nonnegative() });

const schemas = {
  compute: z.object({
    dossier_id: z.string().uuid().optional().nullable(),
    shipping_line: z.string().optional(),
    container_variant: z.string().optional(),
    free_days: z.number().int().nonnegative().optional(),
    occupied_days: z.number().int().nonnegative().optional(),
    out_of_port_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    currency: z.string().length(3).optional(),
    tiers: z.array(tier).optional(),
  }),
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { compute: mw("compute"), schemas };
