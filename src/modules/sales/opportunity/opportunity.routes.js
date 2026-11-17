"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./opportunity.controller");
const MODULE = "MOD-24";

/**
 * Sales pipeline routes (MOD-24) — READ ONLY since the Sales lean revamp, PR 2
 * (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §4.2, owner decision D3).
 *
 * The deal now lives on its request: its stage, value, Lost reason and the
 * operations file a win opens (`/quote-requests/:id/stage`, `/mark-won`). Every
 * opportunity became a request in migration 14512. These reads keep the
 * Opportunities screen answering until PR 3 replaces it with the Leads board,
 * and PR 7 removes the module; nothing writes an opportunity any more.
 */
const router = express.Router();
router.use(authMiddleware);
router.get("/board", requirePermission(MODULE, "view"), controller.board);
router.get("/metrics", requirePermission(MODULE, "view"), controller.metrics);
router.get("/stages", requirePermission(MODULE, "view"), controller.stages);
router.get("/export.csv", requirePermission(MODULE, "view"), controller.exportCsv);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
module.exports = { basePath: "/opportunities", feature: null, router };
