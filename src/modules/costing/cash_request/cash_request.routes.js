/** Cash request / disbursal (MOD-49). Gated; feature costing. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./cash_request.controller");
const validator = require("./cash_request.validator");

const MODULE = "MOD-49";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.post("/:id/transition", requirePermission(MODULE, "approve"), validator.transition, controller.transition);
router.post("/:id/disburse", requirePermission(MODULE, "approve"), validator.disburse, controller.disburse);
router.post("/:id/justify", requirePermission(MODULE, "edit"), validator.justify, controller.justify);

module.exports = { basePath: "/cash-requests", feature: "costing", router };
