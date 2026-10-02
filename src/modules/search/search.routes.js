/**
 * ⌘K record search (tenant review, meeting 6, PR 4 — G5).
 *
 *   GET /search?q=<term>[&types=client,quotation][&limit=5]
 *
 * AUTHENTICATED, NOT MODULE-GATED AT THE DOOR — on purpose. Search spans every
 * module, so no one module's grant can gate it. Each provider is gated on its
 * OWN module's `view` grant inside the service (search.service allowedModules),
 * which is the same check `requirePermission(<module>, "view")` makes — so the
 * answer contains exactly the groups this person could open, and a person with
 * no grants gets an empty answer, not a 403.
 *
 * Rate limited per user: the palette debounces, but a held-down key or a
 * script must not turn one person into a full-table load on every module.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../middleware/auth");
const { makeLimiter } = require("../../shared/http/rate-limit");
const controller = require("./search.controller");
const v = require("./search.validator");

const searchLimiter = makeLimiter({
  name: "search",
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_SEARCH_PER_MIN || 120),
  keyGenerator: (req) => (req.user && req.user.user_id ? `search:${req.user.user_id}` : `ip:${req.ip}`),
});

const router = express.Router();
router.use(authMiddleware);
router.get("/", searchLimiter, v.query, controller.search);

module.exports = { basePath: "/search", feature: null, router };
