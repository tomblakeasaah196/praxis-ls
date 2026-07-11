/** Purchase order (MOD-60). Gated; feature procurement.core. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./purchase_order.controller");
const validator = require("./purchase_order.validator");

const MODULE = "MOD-60";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.post("/:id/transition", requirePermission(MODULE, "approve"), validator.transition, controller.transition);

module.exports = { basePath: "/purchase-orders", feature: null, router };
