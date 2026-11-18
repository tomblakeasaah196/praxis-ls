"use strict";
/**
 * PUBLIC ROUTES ARE PINNED TO LIVE, as every anonymous route is: a visitor does
 * not choose the tenant environment through X-Praxis-Env (see
 * commercial/quotation_public/quotation_public.routes.js for the incident
 * behind the rule).
 */
const express = require("express");
const { makeLimiter } = require("../../../shared/http/rate-limit");
const { asyncHandler } = require("../../../utils/errors");
const s = require("./company_profile_public.service");

const router = express.Router();
const limit = makeLimiter({ name: "company-profile-public", max: 120, windowMs: 15 * 60 * 1000 });
// A PDF is a browser render, so its budget is far smaller than the page's.
const pdfLimit = makeLimiter({ name: "company-profile-public-pdf", max: 20, windowMs: 15 * 60 * 1000 });

const lang = (req) => {
  const v = String(req.query.lang || "").toUpperCase();
  return v === "FR" || v === "EN" ? v : null;
};
const who = (req) => ({ ip: req.ip, ua: req.get("user-agent") || "" });

router.get("/:token", limit, asyncHandler(async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    data: await req.tenantDbIn("live", (c) => s.open(c, { token: req.params.token, language: lang(req), ...who(req) })),
  });
}));

router.get("/:token/pdf", pdfLimit, asyncHandler(async (req, res) => {
  const { buffer, filename } = await req.tenantDbIn("live", (c) =>
    s.download(c, { token: req.params.token, language: lang(req), ...who(req) }));
  res.set("Cache-Control", "no-store")
    .type("application/pdf")
    .set("Content-Disposition", `attachment; filename="${filename}"`)
    .send(buffer);
}));

module.exports = { basePath: "/public/company-profile", feature: null, idParam: "text", router };
