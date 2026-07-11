/** Smart Receivables (MOD-52) — receipts, allocation, ageing, dunning. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./smart_receivables.controller");
const validator = require("./smart_receivables.validator");

const MODULE = "MOD-52";
const router = express.Router();
router.use(authMiddleware);
router.get("/ageing", requirePermission(MODULE, "view"), controller.ageing);
router.get("/reminders", requirePermission(MODULE, "view"), controller.reminders);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.post("/:id/post", requirePermission(MODULE, "approve"), validator.post, controller.post);

module.exports = { basePath: "/receivables", feature: "accounting.core", router };
