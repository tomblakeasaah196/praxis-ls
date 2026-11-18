"use strict";
const service = require("./quotation.service");
const sending = require("./quotation.send");
const templates = require("./quotation.templates");
const document = require("./quotation.document");
const generator = require("./quotation.generator");
const repo = require("./quotation.repo");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
/** The host a link falls back to when the tenant has no public site on file. */
const originOf = (req) => `${req.protocol}://${req.get("host")}`;
const envOf = (req) => req.env || "live";
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => { const r = await req.tenantDb((c) => service.get(c, req.params.id)); if (!r) throw new AppError("NOT_FOUND", "Quotation not found", 404); res.json({ data: r }); }),
  create: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.createDraft(c, { data: req.body, actor: actor(req) })) })),
  update: asyncHandler(async (req, res) => { const b = req.body; res.json({ data: await req.tenantDb((c) => service.updateDraft(c, { id: req.params.id, patch: b, lines: b.lines || null, actor: actor(req) })) }); }),
  transition: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.transition(c, { id: req.params.id, to: req.body.to, entityId: req.body.entity_id, actor: actor(req) })) })),
  // Record Acceptance (§3.4): the same `accept` the link and the portal call, so
  // every yes emits `quotation.accepted` and wins the request one way.
  accept: asyncHandler(async (req, res) => {
    const b = req.body;
    const by = b.by_name || b.by_email ? { name: b.by_name || null, email: b.by_email || null } : null;
    res.json({ data: await req.tenantDb((c) => service.accept(c, { id: req.params.id, convert: b.convert === true, actor: actor(req), by, via: "STAFF" })) });
  }),
  convert: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.convert(c, { id: req.params.id, actor: actor(req) })) })),
  fromCostingPreview: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.fromCostingPreview(c, { costingId: req.params.costingId })) })),
  fromCosting: asyncHandler(async (req, res) => res.status(201).json({
    data: await req.tenantDb((c) => service.createFromCosting(c, {
      costingId: req.params.costingId,
      quoteRequestId: Object.prototype.hasOwnProperty.call(req.body, "quote_request_id") ? req.body.quote_request_id : undefined,
      validUntil: req.body.valid_until || null,
      actor: actor(req),
    })),
  })),

  /* ── one document (lean revamp, PR 4) ─────────────────────────────────── */

  send: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((c) => sending.send(c, { id: req.params.id, input: req.body, actor: actor(req), origin: originOf(req), env: envOf(req) })),
  })),
  share: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((c) => sending.share(c, { id: req.params.id, expiresOn: req.body.expires_on || null, actor: actor(req), origin: originOf(req) })),
  })),
  revokeShare: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => sending.revokeShare(c, { id: req.params.id, actor: actor(req) })) })),
  revise: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => sending.revise(c, { id: req.params.id, actor: actor(req) })) })),
  draftSections: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((c) => generator.draft(c, { quotationId: req.params.id, input: req.body, actor: actor(req), env: envOf(req) })),
  })),
  views: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => repo.listViews(c, req.params.id, 200)) })),
  // The one render (§3.4): the same HTML the link shows and the PDF prints.
  preview: asyncHandler(async (req, res) => {
    const { output = null, language = "EN" } = req.validatedQuery || {};
    const out = await req.tenantDb((c) => document.render(c, { id: req.params.id, output, language, origin: originOf(req), env: envOf(req) }));
    res.json({ data: { html: out.html, language: out.language, output: out.data && out.data.output } });
  }),
  pdf: asyncHandler(async (req, res) => {
    const { output = null, language = "EN" } = req.validatedQuery || {};
    const out = await req.tenantDb((c) => document.pdf(c, { id: req.params.id, output, language, origin: originOf(req), env: envOf(req), actor: actor(req) }));
    res.type("application/pdf").set("Content-Disposition", `attachment; filename="${out.name}"`).send(out.buffer);
  }),

  templates: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => templates.list(c, { includeInactive: req.query.include_inactive === "true" })) })),
  template: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => templates.get(c, req.params.templateId)) })),
  createTemplate: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => templates.create(c, { data: req.body, actor: actor(req) })) })),
  updateTemplate: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => templates.update(c, { id: req.params.templateId, patch: req.body, actor: actor(req) })) })),
  previewTemplate: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((c) => templates.preview(c, { id: req.params.templateId, language: (req.validatedQuery && req.validatedQuery.language) || "EN" })),
  })),
};
