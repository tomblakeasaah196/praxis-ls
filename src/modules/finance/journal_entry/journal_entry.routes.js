/**
 * Journal-entry routes — the ledger posting API (MOD-55).
 * Gated with authMiddleware + requirePermission (business modules were mounted
 * ungated by the generic makeRouter; posting to the ledger is high-stakes). The
 * feature gate (accounting.core) is applied by the module-loader from `feature`.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./journal_entry.controller");
const validator = require("./journal_entry.validator");

const MODULE = "MOD-55";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.post, controller.post);
router.post("/:id/reverse", requirePermission(MODULE, "approve"), validator.reverse, controller.reverse);

module.exports = { basePath: "/journal-entries", feature: "accounting.core", router };
