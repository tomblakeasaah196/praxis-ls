"use strict";
/**
 * The website's brand layer, the administrator's surface (14660): photograph
 * slots, trust documents and the privacy policy's draft.
 *
 * Gated on MOD-29 like every other part of the tenant's public face, and not
 * feature-gated, so a site can be prepared before the `website` package is
 * switched on. The stranger-facing reads are in `site_public`.
 *
 * RBAC action is `edit`, never `update`: the backend spells it that way.
 */

const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { asyncHandler } = require("../../../utils/errors");
const service = require("./site_brand.service");
const events = require("./site_brand.events");
const v = require("./site_brand.validator");

const MODULE = events.MODULE;
const router = express.Router();

router.use(authMiddleware);

const view = requirePermission(MODULE, "view");
const edit = requirePermission(MODULE, "edit");

/* ── photograph slots ───────────────────────────────────────────────────────*/

router.get("/images", view, asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((c) => service.listImages(c)) });
}));

/** The words a screen reader says for the picture in this slot. */
router.put("/images/:slot", edit, v.slotParam, v.imageAlt, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.setImageAlt(c, {
    slotKey: req.params.slot, patch: req.body, actor: req.user || {},
  }));
  res.json({ data });
}));

/** Put a photograph in the slot (replacing the one there). */
router.post("/images/:slot", edit, v.slotParam, v.imageUpload, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.uploadImage(c, {
    slotKey: req.params.slot,
    body: req.body,
    actor: req.user || {},
    slug: req.tenant && req.tenant.slug,
  }));
  res.status(201).json({ data });
}));

/** Take the photograph out of the slot. The picture is archived, not deleted. */
router.delete("/images/:slot/file", edit, v.slotParam, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.removeImage(c, {
    slotKey: req.params.slot, actor: req.user || {},
  }));
  res.json({ data });
}));

/* ── trust documents ────────────────────────────────────────────────────────*/

router.get("/documents", view, asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((c) => service.listDocuments(c)) });
}));

router.post("/documents", edit, v.createDocument, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.createDocument(c, { patch: req.body, actor: req.user || {} }));
  res.status(201).json({ data });
}));

/** Write the privacy policy's draft from the published companies, in English
 *  and German. The published copy is untouched until an editor publishes. */
router.post("/documents/privacy-draft", edit, v.noBody, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.draftPrivacy(c, { actor: req.user || {} }));
  res.json({ data });
}));

router.get("/documents/:id", view, asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((c) => service.getDocument(c, req.params.id)) });
}));

router.patch("/documents/:id", edit, v.updateDocument, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.updateDocument(c, {
    id: req.params.id, patch: req.body, actor: req.user || {},
  }));
  res.json({ data });
}));

/** Publish the draft as it stands ({published: true}) or withdraw it. Its own
 *  endpoint, not a field: publishing freezes a copy and stamps who and when. */
router.post("/documents/:id/publish", edit, v.publishDocument, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.setPublished(c, {
    id: req.params.id, published: req.body.published, actor: req.user || {},
  }));
  res.json({ data });
}));

router.delete("/documents/:id", edit, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.removeDocument(c, { id: req.params.id, actor: req.user || {} }));
  res.json({ data });
}));

/** The DRAFT as a PDF, for the editor to check the layout before publishing. */
router.get("/documents/:id/preview.pdf", view, asyncHandler(async (req, res) => {
  const lang = ["en", "fr", "de"].includes(String(req.query.lang)) ? String(req.query.lang) : "en";
  const { buffer, filename } = await req.tenantDb((c) => service.previewPdf(c, { id: req.params.id, lang }));
  res
    .set("Cache-Control", "private, no-store")
    .set("Content-Disposition", `inline; filename="${filename}"`)
    .type("application/pdf")
    .send(buffer);
}));

module.exports = { basePath: "/site-brand", feature: null, router };
