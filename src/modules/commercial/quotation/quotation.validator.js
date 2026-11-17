"use strict";
const { z } = require("zod");
const { quotation: shared } = require("@praxis/shared");
const { AppError } = require("../../../utils/errors");
const line = z.object({ dictionary_item_id: z.string().guid().optional().nullable(), label: z.string().optional(), qty: z.number().positive().optional(), unit_price: z.number().nonnegative().optional(), is_disbursement: z.boolean().optional(), tax_code_id: z.string().guid().optional().nullable(), container_type_ref_id: z.string().guid().nullish(), client_heading: z.string().trim().max(120).nullish() });
const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// Meeting 6, PR 4: the request a quotation answers, and the order its families
// print in — `familyOrder` is the shared definition the staff screens use too.
// Lean revamp PR 4: the one document's fields (lead_id, title, language, the
// Full/Extract switch, the template) and its sections, all from @praxis/shared.
// `opportunity_id` is still accepted, to find the request an old opportunity
// became; it is never stored (quotation.service PATCHABLE).
const linkage = { quote_request_id: z.string().guid().optional().nullable(), family_order: shared.familyOrder.optional().nullable(), ...shared.documentFields, sections: shared.sections.optional() };
const header = { client_id: z.string().guid().optional().nullable(), dossier_id: z.string().guid().optional().nullable(), costing_id: z.string().guid().optional().nullable(), opportunity_id: z.string().guid().optional().nullable(), currency: z.string().length(3).optional(), quote_model: z.enum(["HT_ON_TOP", "TTC"]).optional(), margin_percent: z.number().optional().nullable(), valid_until: d.optional().nullable(), lines: z.array(line).optional(), ...linkage };
const schemas = {
  create: z.object({ entity_id: z.string().guid().optional().nullable(), ...header }),
  update: z.object({ entity_id: z.string().guid().optional().nullable(), ...header }),
  transition: z.object({ to: z.enum(["SENT", "REJECTED", "EXPIRED"]), entity_id: z.string().guid().optional().nullable() }),
  // Record Acceptance (lean revamp §3.4): optionally who at the client said yes.
  accept: shared.recordAcceptance,
  // ACCEPTED → invoice draft takes nothing from the body: the lines are the
  // quotation's own. Strict, so a stray key is refused rather than ignored.
  convert: z.object({}).strict(),
  // "Create quotation" on a costing (G1) — the shared definition.
  fromCosting: shared.fromCosting,
  send: shared.send,
  share: shared.share,
  revise: shared.revise,
  revoke: z.object({}).strict(),
  draftSections: shared.draftSections,
  template: shared.template,
  templatePatch: shared.templatePatch,
  // AI-facing: quotation_id in the payload (REST uses the URL). Maps to a
  // list_quotations picker in the copilot form.
  aiTransition: z.object({ quotation_id: z.string().guid(), to: z.enum(["SENT", "REJECTED", "EXPIRED"]), entity_id: z.string().guid().optional().nullable() }),
  aiAccept: shared.recordAcceptance.extend({ quotation_id: z.string().guid() }),
  aiConvert: z.object({ quotation_id: z.string().guid() }),
  aiSend: shared.send.extend({ quotation_id: z.string().guid() }),
  aiRevise: z.object({ quotation_id: z.string().guid() }),
  aiDraftSections: shared.draftSections.extend({ quotation_id: z.string().guid() }),
  aiUpdateSections: z.object({ quotation_id: z.string().guid(), sections: shared.sections, default_output: z.enum(shared.OUTPUTS).optional(), language: z.enum(shared.LANGUAGES).optional(), title: z.string().trim().max(200).nullable().optional() }).strict(),
  // AI-facing: the costing in the payload (REST uses the URL).
  aiFromCosting: shared.fromCosting.extend({ costing_id: z.string().guid() }),
  aiFromCostingPreview: z.object({ costing_id: z.string().guid() }),
  costingParam: z.object({ costingId: z.string().guid() }),
  render: z.object({ output: z.enum(shared.OUTPUTS).optional(), language: z.enum(["EN", "FR"]).optional() }),
};
const mw = (k) => (req, _res, next) => { const p = schemas[k].safeParse(req.body); if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors)); req.body = p.data; return next(); };
const costingParam = (req, _res, next) => { const p = schemas.costingParam.safeParse(req.params); if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid costing id", 422, p.error.flatten().fieldErrors)); return next(); };
/** ?output=FULL|EXTRACT&language=EN|FR on the preview and the PDF. */
const renderQuery = (req, _res, next) => {
  const q = { output: req.query.output ? String(req.query.output).toUpperCase() : undefined, language: req.query.language ? String(req.query.language).toUpperCase().slice(0, 2) : undefined };
  const p = schemas.render.safeParse(q);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid output or language", 422, p.error.flatten().fieldErrors));
  req.validatedQuery = p.data;
  return next();
};
module.exports = {
  create: mw("create"), update: mw("update"), transition: mw("transition"), accept: mw("accept"), convert: mw("convert"), fromCosting: mw("fromCosting"),
  send: mw("send"), share: mw("share"), revise: mw("revise"), revoke: mw("revoke"), draftSections: mw("draftSections"),
  template: mw("template"), templatePatch: mw("templatePatch"), costingParam, renderQuery, schemas,
};
