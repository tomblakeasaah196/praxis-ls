"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schemas = {
  setFeature: z.object({ is_enabled: z.boolean().optional(), default_provider: z.string().optional(), default_model: z.string().optional(), est_cost_per_call_xaf: z.number().nonnegative().optional(), description: z.string().optional() }),
  grant: z.object({ user_id: z.string().uuid(), feature_key: z.string().min(1), monthly_cap_xaf: z.number().nonnegative().optional().nullable() }),
  revoke: z.object({ user_id: z.string().uuid(), feature_key: z.string().min(1), reason: z.string().optional() }),
  setBudget: z.object({ period_start: d, period_end: d, soft_cap_xaf: z.number().nonnegative().optional().nullable(), hard_cap_xaf: z.number().nonnegative().optional().nullable() }),
  setVendor: z.object({ api_key: z.string().optional(), display_name: z.string().optional(), endpoint_url: z.string().optional(), default_model: z.string().optional(), current_model: z.string().optional(), cost_per_1k_input_tokens: z.number().nonnegative().optional(), cost_per_1k_output_tokens: z.number().nonnegative().optional(), cost_per_audio_minute: z.number().nonnegative().optional(), cost_native_currency: z.string().length(3).optional(), per_vendor_monthly_cap_xaf: z.number().nonnegative().optional().nullable(), is_active: z.boolean().optional() }),
};
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { setFeature: mw("setFeature"), grant: mw("grant"), revoke: mw("revoke"), setBudget: mw("setBudget"), setVendor: mw("setVendor"), schemas };
