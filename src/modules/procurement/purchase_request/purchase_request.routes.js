/** Purchase request (MOD-62). Gated; feature procurement.core. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./purchase_request.controller");
const validator = require("./purchase_request.validator");

const MODULE = "MOD-62";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.post("/:id/transition", requirePermission(MODULE, "approve"), validator.transition, controller.transition);

module.exports = { basePath: "/purchase-requests", feature: null, router };
