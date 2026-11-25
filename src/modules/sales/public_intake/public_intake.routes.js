"use strict";
/**
 * PUBLIC ROUTES ARE PINNED TO LIVE.
 *
 * These endpoints are reachable with no session, so the caller is an anonymous
 * visitor on the tenant's marketing site. `req.tenantDb` resolves the
 * environment from the `X-Praxis-Env` header, which means that visitor chose
 * it: sending `X-Praxis-Env: sandbox` made a website submission land in the
 * tenant's SANDBOX schema (verified) and made sandbox rows publicly readable.
 * The environment a request runs in is a signed-in user's choice, not the
 * internet's. `req.tenantDbIn("live", …)` is the same mechanism the careers
 * module uses for exactly this reason (src/middleware/tenant-context.js).
 *
 * THE FILTERS, in the order every write meets them:
 *
 *   1. the rate limit, keyed on the visitor's REAL address (`req.ip`, which
 *      `shared/http/visitor-ip` resolves through Cloudflare), so one visitor's
 *      flood no longer spends everybody's allowance;
 *   2. the body shape, with the honeypot and the 1.5 second timing trap;
 *   3. the Cloudflare Turnstile check (`shared/http/human-check`), when the
 *      tenant has entered its keys.
 */
const express = require("express");
const { makeLimiter } = require("../../../shared/http/rate-limit");
const { requireHuman } = require("../../../shared/http/human-check");
const { asyncHandler, AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");
const s = require("./public_intake.service");
const v = require("./public_intake.validator");
const settings = require("./website-messages.settings");
const links = require("./attachment-link");
const enquiryRepo = require("../inbound_intake/inbound_intake.repo");
const vault = require("../../vault/document_vault/document_vault.service");

const router = express.Router();
const hourly = (name, max) => makeLimiter({ name: `public-${name}`, max, windowMs: 60 * 60 * 1000 });
const configLimit = makeLimiter({ name: "public-intake-config", max: 300, windowMs: 15 * 60 * 1000 });
const linkLimit = makeLimiter({ name: "public-attachment-link", max: 120, windowMs: 15 * 60 * 1000 });

/**
 * Hand a committed message's emails to the worker. If the queue cannot take
 * the job (Redis down), deliver in this process after the response instead:
 * a slower email beats no email, and the message is safe either way.
 */
async function queueMail(req, row) {
  const data = {
    tenantMeta: req.tenant,
    enquiryId: row.contact_enquiry_id,
    tenantName: (req.tenant && req.tenant.name) || "",
    siteOrigin: `${req.protocol}://${req.get("host")}`,
  };
  try {
    const { enqueue } = require("../../../jobs/queue-producer");
    await enqueue("site-enquiry-mail", "deliver", data, { jobId: `site-enquiry-mail:${req.tenant.slug}:${row.contact_enquiry_id}` });
  } catch (err) {
    logger.warn({ err: { message: err && err.message } }, "[public_intake] could not queue the website message emails; sending in-process");
    const handler = require("../../../jobs/handlers/site-enquiry-mail");
    setImmediate(() => {
      handler({ data }).catch((e) =>
        logger.error({ err: { message: e && e.message } }, "[public_intake] website message emails failed in-process"));
    });
  }
}

/** What the website needs before it renders a form: the Turnstile site key, or null. */
router.get("/config", configLimit, asyncHandler(async (req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  res.json({ data: await req.tenantDbIn("live", (c) => settings.publicConfig(c)) });
}));

router.post("/quote-requests", hourly("quote", 5), v.quote, requireHuman("quote"), asyncHandler(async (req, res) =>
  res.status(201).json({ data: await req.tenantDbIn("live", (c) => s.submitQuote(c, req.body)) })));

router.post("/contact-enquiries", hourly("contact", 5), v.contact, requireHuman("contact"), asyncHandler(async (req, res) =>
  res.status(201).json({
    data: await req.tenantDbIn("live", (c) => s.submitContact(c, req.body, { afterCommit: (row) => queueMail(req, row) })),
  })));

/** The floating message button on every page (SmartLS website v2, PR 2). */
router.post("/messages", hourly("message", 10), v.message, requireHuman("message"), asyncHandler(async (req, res) =>
  res.status(201).json({
    data: await req.tenantDbIn("live", (c) => s.submitMessage(c, req.body, { afterCommit: (row) => queueMail(req, row) })),
  })));

/**
 * One attachment, through the signed link in the inbox email. Every refusal is
 * the same 404, so a forged, expired or foreign link tells its holder nothing.
 */
router.get("/attachments/:token", linkLimit, asyncHandler(async (req, res) => {
  const claims = links.verify(req.params.token, { slug: req.tenant && req.tenant.slug });
  const missing = () => new AppError("NOT_FOUND", "This link has expired or does not exist", 404);
  if (!claims) throw missing();
  const out = await req.tenantDbIn("live", async (c) => {
    const att = await enquiryRepo.attachmentOf(c, claims.enquiryId, claims.docId);
    if (!att) return null;
    const { buffer } = await vault.fetchBytes(c, claims.docId);
    return { att, buffer };
  });
  if (!out) throw missing();
  const name = out.att.original_name || "attachment";
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  res.set("Cache-Control", "private, no-store");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Content-Type", out.att.content_type || "application/octet-stream");
  res.set("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send(out.buffer);
}));

module.exports = { basePath: "/public/intake", feature: null, idParam: "text", router };
