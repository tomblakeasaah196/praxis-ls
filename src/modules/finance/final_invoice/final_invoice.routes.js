/** Final invoice (MOD-51) — full lifecycle. Gated + feature accounting.core. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./final_invoice.controller");
const validator = require("./final_invoice.validator");

const MODULE = "MOD-51";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.createDraft, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.updateDraft, controller.update);
router.post("/:id/submit", requirePermission(MODULE, "approve"), validator.submit, controller.submit);

module.exports = { basePath: "/final-invoices", feature: "accounting.core", router };
