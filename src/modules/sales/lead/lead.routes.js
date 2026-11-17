"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./lead.controller");
const validator = require("./lead.validator");
const MODULE = "MOD-20";

/**
 * Leads (MOD-20): the company row (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.2).
 *
 * Working a company is `edit`: logging what happened, setting and completing
 * its next step, reopening it, making it a client. ARCHIVING it is `approve`,
 * the grant the funnel's LOST always took (API F-21): it ends the record and
 * loses every request still open on it.
 *
 * The lead's own five-step lifecycle and its `/transition` route are gone with
 * it (§4.1); a deal's stage is its request's (`/quote-requests/:id/stage`).
 */
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), validator.list, controller.list);
// Declared before `/:id` so neither is read as an id.
router.get("/duplicates", requirePermission(MODULE, "view"), validator.duplicates, controller.duplicates);
router.post("/clients/:clientId/row", requirePermission(MODULE, "edit"), controller.clientRow);
// The 360° dossier, kept next to the read it extends. `view` is the right gate:
// it aggregates records the caller can already open one screen at a time, and
// the only privileged thing on it — money — is gated separately in the
// controller on finance visibility.
router.get("/:id/360", requirePermission(MODULE, "view"), controller.dossier);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.post("/:id/activities", requirePermission(MODULE, "edit"), validator.activity, controller.logActivity);
router.put("/:id/next-step", requirePermission(MODULE, "edit"), validator.nextStep, controller.setNextStep);
router.post("/:id/next-step/done", requirePermission(MODULE, "edit"), validator.done, controller.done);
router.post("/:id/archive", requirePermission(MODULE, "approve"), validator.archive, controller.archive);
router.post("/:id/reopen", requirePermission(MODULE, "edit"), validator.reopen, controller.reopen);
router.post("/:id/make-client", requirePermission(MODULE, "edit"), validator.makeClient, controller.makeClient);
module.exports = { basePath: "/leads", feature: null, router };
