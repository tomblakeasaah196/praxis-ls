/** Numbering schemes (MOD-70) — tenant-configurable document numbering. Gated. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./numbering_setting.controller");
const validator = require("./numbering_setting.validator");

const MODULE = "MOD-70";
const router = express.Router();
router.use(authMiddleware);
router.get("/:moduleKey", requirePermission(MODULE, "view"), controller.get);
router.put("/:moduleKey", requirePermission(MODULE, "edit"), validator.put, controller.put);

module.exports = { basePath: "/numbering-schemes", feature: null, router };
