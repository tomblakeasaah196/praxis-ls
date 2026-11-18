"use strict";
/**
 * The public quotation link (lean revamp §3.4 "The link"): read, download,
 * accept on the signature programme, decline.
 *
 * PUBLIC ROUTES ARE PINNED TO LIVE, as every anonymous route is: a visitor
 * does not choose the tenant environment through X-Praxis-Env (see
 * sales/proposal_public for the incident behind the rule). Every route is
 * rate-limited; the answering routes far tighter than the read, and keyed on
 * the token, so one link cannot be hammered from many addresses.
 */
const express = require("express");
const { quotation: shared } = require("@praxis/shared");
const { makeLimiter } = require("../../../shared/http/rate-limit");
const { asyncHandler, AppError } = require("../../../utils/errors");
const s = require("./quotation_public.service");

const router = express.Router();
const limit = makeLimiter({ name: "quotation-public", max: 120, windowMs: 15 * 60 * 1000 });
const pdfLimit = makeLimiter({ name: "quotation-public-pdf", max: 20, windowMs: 15 * 60 * 1000 });
/**
 * Keyed on the link's token (read off the path: `req.params` is not set when a
 * limiter runs), so a client's office behind one NAT is not throttled by a
 * colleague; the IP when there is no token, which is what a scanner sends.
 */
const byToken = (req) => {
  const [, token] = String(req.path || "").split("/");
  return token ? `t:${token}` : `ip:${req.ip}`;
};
const answerLimit = makeLimiter({ name: "quotation-public-answer", max: 20, windowMs: 15 * 60 * 1000, keyGenerator: byToken });

const lang = (req) => {
  const v = String(req.query.lang || "").toUpperCase().slice(0, 2);
  return v === "FR" || v === "EN" ? v : null;
};
const tenantName = (req) => (req.tenant && req.tenant.name) || "";
const body = (schema) => (req, _res, next) => {
  const p = schema.safeParse(req.body || {});
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};
const live = (req, fn) => req.tenantDbIn("live", fn);

router.get("/:token", limit, asyncHandler(async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ data: await live(req, (c) => s.open(c, { token: req.params.token, language: lang(req), ip: req.ip, ua: req.get("user-agent") || "" })) });
}));

router.get("/:token/pdf", pdfLimit, asyncHandler(async (req, res) => {
  const { buffer, filename } = await live(req, (c) => s.download(c, { token: req.params.token, language: lang(req), ip: req.ip, ua: req.get("user-agent") || "" }));
  res.set("Cache-Control", "no-store").type("application/pdf").set("Content-Disposition", `attachment; filename="${filename}"`).send(buffer);
}));

router.post("/:token/accept/start", answerLimit, body(shared.linkAcceptStart), asyncHandler(async (req, res) => {
  res.json({ data: await live(req, (c) => s.startAccept(c, { token: req.params.token, fullName: req.body.full_name, role: req.body.role || null, lang: lang(req) || "EN", tenantName: tenantName(req) })) });
}));

router.post("/:token/accept/resend", answerLimit, body(shared.revise), asyncHandler(async (req, res) => {
  res.json({ data: await live(req, (c) => s.resendCode(c, { token: req.params.token, lang: lang(req) || "EN", tenantName: tenantName(req) })) });
}));

router.post("/:token/accept/complete", answerLimit, body(shared.linkAcceptComplete), asyncHandler(async (req, res) => {
  const b = req.body;
  res.json({
    data: await live(req, (c) => s.completeAccept(c, {
      token: req.params.token, code: b.code, presetCode: b.preset_code, fullName: b.full_name, role: b.role || null,
      markImageB64: b.mark_image_b64 || null, ip: req.ip, userAgent: req.get("user-agent") || null, lang: lang(req) || "EN",
      origin: `${req.protocol}://${req.get("host")}`,
    })),
  });
}));

router.post("/:token/accept", answerLimit, body(shared.linkAcceptConfirm), asyncHandler(async (req, res) => {
  res.json({ data: await live(req, (c) => s.confirmAccept(c, { token: req.params.token, fullName: req.body.full_name, role: req.body.role || null, ip: req.ip, lang: lang(req) || "EN" })) });
}));

router.post("/:token/decline", answerLimit, body(shared.decline), asyncHandler(async (req, res) => {
  res.json({ data: await live(req, (c) => s.decline(c, { token: req.params.token, reasonCode: req.body.reason_code, note: req.body.note || null, lang: lang(req) || "EN" })) });
}));

module.exports = { basePath: "/public/quotations", feature: null, idParam: "text", router };
