/** Expense rate cards (MOD-10). Gated. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./expense_rate.controller");
const validator = require("./expense_rate.validator");

const MODULE = "MOD-10";
const router = express.Router();
router.use(authMiddleware);
router.get("/resolve", requirePermission(MODULE, "view"), controller.resolve);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.delete("/:id", requirePermission(MODULE, "delete"), controller.remove);

module.exports = { basePath: "/expense-rates", feature: null, router };
