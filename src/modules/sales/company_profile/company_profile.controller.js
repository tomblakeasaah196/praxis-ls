// search:none: one company profile per tenant, opened from Sales & CRM, Company Profile. Its shares are found on that screen.
"use strict";
const s = require("./company_profile.service");
const { asyncHandler } = require("../../../utils/errors");
const { sendPaged } = require("../../../shared/http/paged");

const actor = (req) => req.user || {};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const lang = (req) => (String(req.query.lang || "EN").toUpperCase() === "FR" ? "FR" : "EN");
const versionId = (req) => (UUID.test(String(req.query.version_id || "")) ? String(req.query.version_id) : null);
const json = (fn) => asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => fn(c, req)) }));

module.exports = {
  get: json((c) => s.editor(c)),
  saveSection: json((c, req) => s.saveSection(c, { key: req.params.key, body: req.body, actor: actor(req) })),
  setCover: json((c, req) => s.setCover(c, { dataUrl: req.body.data_url, slug: req.tenant.slug, actor: actor(req) })),
  clearCover: json((c, req) => s.clearCover(c, { actor: actor(req) })),
  publish: json((c, req) => s.publish(c, { changeNote: req.body.change_note || null, actor: actor(req) })),
  history: json((c) => s.history(c)),
  diff: json((c, req) => s.diff(c, { versionId: req.params.id })),
  preview: json((c, req) => s.preview(c, { versionId: versionId(req), language: lang(req) })),
  pdf: asyncHandler(async (req, res) => {
    const { buffer, filename } = await req.tenantDb((c) => s.pdf(c, { versionId: versionId(req), language: lang(req) }));
    res.type("application/pdf").set("Content-Disposition", `attachment; filename="${filename}"`).send(buffer);
  }),
  refresh: json((c, req) => s.refresh(c, { actor: actor(req) })),
  logos: json((c) => s.logos(c)),
  addLogo: json((c, req) => s.addLogo(c, { name: req.body.name, dataUrl: req.body.data_url, slug: req.tenant.slug, actor: actor(req) })),
  retireLogo: json((c, req) => s.retireLogo(c, { id: req.params.id, actor: actor(req) })),
  shares: asyncHandler(async (req, res) => sendPaged(res, await req.tenantDb((c) => s.shares(c, req.query)))),
  createShare: json((c, req) => s.createShare(c, { data: req.body, actor: actor(req) })),
  revokeShare: json((c, req) => s.revokeShare(c, { id: req.params.id, actor: actor(req) })),
  shareOpens: json((c, req) => s.shareOpens(c, { id: req.params.id })),
};
