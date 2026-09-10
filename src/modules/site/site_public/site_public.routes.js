/**
 * The website's public read.
 *
 * Pinned to the LIVE schema (`req.tenantDbIn("live", …)`) so an internet caller
 * can never select sandbox via `X-Praxis-Env` — the same rule
 * service_type_web_public follows. Gated on the `website` feature, so the
 * commercial switch governs the public site while the editor (`/site`) stays
 * available to prepare one before the package is on.
 */
"use strict";

const express = require("express");
const { makeLimiter } = require("../../../shared/http/rate-limit");
const { asyncHandler } = require("../../../utils/errors");
const service = require("../site_content/site_content.service");
const settings = require("../site_settings/site_settings.service");

const router = express.Router();
const limit = makeLimiter({ name: "site-public", max: 240, windowMs: 15 * 60 * 1000 });

/** The nav. Published pages only. */
router.get("/pages", limit, asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDbIn("live", (c) => service.listPublicPages(c)) });
}));

/**
 * One page by key, blocks in order, metrics resolved.
 *
 * 404 for unknown AND for unpublished: to a visitor they are the same fact, and
 * rendering an empty shell would put half-written copy on a URL that returns
 * 200.
 */
router.get("/pages/:key", limit, asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDbIn("live", (c) => service.getPublicPage(c, req.params.key)) });
}));

/* ── the experience reads ───────────────────────────────────────────────────
 *
 * Everything below is served to the open internet, on the same rate limiter and
 * the same LIVE-schema pin as the page reads above: `req.tenantDbIn("live", …)`
 * so an internet caller can never select sandbox through `X-Praxis-Env`.
 *
 * None of them 404 on emptiness. A tenant with no partners, no credentials and
 * no social links has an empty array in each, and the renderer draws nothing —
 * which is the correct empty state for a marketing band. A 404 would make an
 * unconfigured site look broken rather than plain.
 */

/**
 * The theme: the tenant's three colours, the palette derived from them for both
 * light and dark, the resolved fonts, and the corrections the engine had to
 * make.
 *
 * This is ON THE LCP PATH — it is the first thing the site needs and nothing
 * paints correctly before it — so it is the one read here that is cached at the
 * edge. Five minutes: long enough that a burst of visitors costs one
 * derivation, short enough that a tenant who changes their brand colour sees it
 * within a coffee break rather than filing a support ticket.
 */
router.get("/theme", limit, asyncHandler(async (req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  res.json({ data: await req.tenantDbIn("live", (c) => settings.publicTheme(c)) });
}));

/** Active partners by kind, and unexpired credentials. `permission_note` is
 *  never selected — see the service. */
router.get("/partners", limit, asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDbIn("live", (c) => settings.publicPartners(c)) });
}));

/** Platforms that have a URL. Nothing else exists. */
router.get("/social", limit, asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDbIn("live", (c) => settings.publicSocial(c)) });
}));

/** The group story and group-level leadership. */
router.get("/about", limit, asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDbIn("live", (c) => settings.publicAbout(c)) });
}));

/** Public-enabled entities and their leadership. No RCCM, no NIU, no cap
 *  table, no governance — an allow-list, not a deletion. */
router.get("/entities", limit, asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDbIn("live", (c) => settings.publicEntities(c)) });
}));

module.exports = { basePath: "/public/site", feature: "website", idParam: "text", router };
