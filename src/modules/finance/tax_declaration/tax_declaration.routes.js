/** Tax Center (MOD-07) — TVA return + IS/minimum tax. Read-only, gated. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./tax_declaration.controller");
const validator = require("./tax_declaration.validator");

const MODULE = "MOD-07";
const router = express.Router();
router.use(authMiddleware);
router.get("/vat-return", requirePermission(MODULE, "view"), validator.query, controller.vatReturn);
router.get("/corporate-tax", requirePermission(MODULE, "view"), validator.query, controller.corporateTax);

module.exports = { basePath: "/tax", feature: "accounting.tax", router };
