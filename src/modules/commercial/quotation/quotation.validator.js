"use strict";
const { z } = require("zod");
const { quotation: shared } = require("@praxis/shared");
const { AppError } = require("../../../utils/errors");
const line = z.object({ dictionary_item_id: z.string().uuid().optional().nullable(), label: z.string().optional(), qty: z.number().positive().optional(), unit_price: z.number().nonnegative().optional(), is_disbursement: z.boolean().optional(), tax_code_id: z.string().uuid().optional().nullable(), container_type_ref_id: z.string().uuid().nullish(), client_heading: z.string().trim().max(120).nullish() });
const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// Meeting 6, PR 4: the request a quotation answers, and the order its families
// print in — `familyOrder` is the shared definition the staff screens use too.
const linkage = { quote_request_id: z.string().uuid().optional().nullable(), family_order: shared.familyOrder.optional().nullable() };
const schemas = {
  create: z.object({ entity_id: z.string().uuid().optional().nullable(), client_id: z.string().uuid().optional().nullable(), dossier_id: z.string().uuid().optional().nullable(), costing_id: z.string().uuid().optional().nullable(), opportunity_id: z.string().uuid().optional().nullable(), currency: z.string().length(3).optional(), quote_model: z.enum(["HT_ON_TOP", "TTC"]).optional(), margin_percent: z.number().optional().nullable(), valid_until: d.optional().nullable(), lines: z.array(line).optional(), ...linkage }),
  update: z.object({ client_id: z.string().uuid().optional().nullable(), dossier_id: z.string().uuid().optional().nullable(), costing_id: z.string().uuid().optional().nullable(), opportunity_id: z.string().uuid().optional().nullable(), currency: z.string().length(3).optional(), quote_model: z.enum(["HT_ON_TOP", "TTC"]).optional(), margin_percent: z.number().optional().nullable(), valid_until: d.optional().nullable(), lines: z.array(line).optional(), ...linkage }),
  transition: z.object({ to: z.enum(["SENT", "REJECTED", "EXPIRED"]), entity_id: z.string().uuid().optional().nullable() }),
  accept: z.object({ convert: z.boolean().optional() }),
  // ACCEPTED → invoice draft takes nothing from the body: the lines are the
  // quotation's own. Strict, so a stray key is refused rather than ignored.
  convert: z.object({}).strict(),
  // "Create quotation" on a costing (G1) — the shared definition.
  fromCosting: shared.fromCosting,
  // AI-facing: quotation_id in the payload (REST uses the URL). Maps to a
  // list_quotations picker in the copilot form.
  aiTransition: z.object({ quotation_id: z.string().uuid(), to: z.enum(["SENT", "REJECTED", "EXPIRED"]), entity_id: z.string().uuid().optional().nullable() }),
  aiAccept: z.object({ quotation_id: z.string().uuid(), convert: z.boolean().optional() }),
  aiConvert: z.object({ quotation_id: z.string().uuid() }),
  // AI-facing: the costing in the payload (REST uses the URL).
  aiFromCosting: shared.fromCosting.extend({ costing_id: z.string().uuid() }),
  aiFromCostingPreview: z.object({ costing_id: z.string().uuid() }),
  costingParam: z.object({ costingId: z.string().uuid() }),
};
const mw = (k) => (req, _res, next) => { const p = schemas[k].safeParse(req.body); if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors)); req.body = p.data; return next(); };
const costingParam = (req, _res, next) => { const p = schemas.costingParam.safeParse(req.params); if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid costing id", 422, p.error.flatten().fieldErrors)); return next(); };
module.exports = { create: mw("create"), update: mw("update"), transition: mw("transition"), accept: mw("accept"), convert: mw("convert"), fromCosting: mw("fromCosting"), costingParam, schemas };
