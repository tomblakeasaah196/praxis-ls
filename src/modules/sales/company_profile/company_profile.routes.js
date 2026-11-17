"use strict";
/**
 * Company Profile, staff side (guide §3.6). MOD-26, beside Success Stories:
 * view reads, edit writes the draft and the logo library, create raises a share
 * link, approve publishes. The public link is company_profile_public.
 */
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const c = require("./company_profile.controller");
const v = require("./company_profile.validator");
const { MODULE } = require("./company_profile.events");

const router = express.Router();
router.use(authMiddleware);
const view = requirePermission(MODULE, "view");
const edit = requirePermission(MODULE, "edit");

router.get("/", view, c.get);
router.patch("/draft/sections/:key", edit, v.section, c.saveSection);
router.post("/draft/cover", edit, v.cover, c.setCover);
router.delete("/draft/cover", edit, c.clearCover);
router.post("/publish", requirePermission(MODULE, "approve"), v.publish, c.publish);
router.get("/versions", view, c.history);
router.get("/versions/:id/diff", view, c.diff);
router.get("/preview", view, c.preview);
router.get("/pdf", view, c.pdf);
router.post("/refresh", edit, c.refresh);
router.get("/logos", view, c.logos);
router.post("/logos", edit, v.logo, c.addLogo);
router.post("/logos/:id/retire", edit, c.retireLogo);
router.get("/shares", view, c.shares);
router.post("/shares", requirePermission(MODULE, "create"), v.share, c.createShare);
router.post("/shares/:id/revoke", edit, c.revokeShare);
router.get("/shares/:id/opens", view, c.shareOpens);

module.exports = { basePath: "/company-profile", feature: null, router };
