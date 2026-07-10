/** Statements (MOD-59) — trial balance, Compte de résultat, Bilan. Read-only, gated. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./financial_statement.controller");
const validator = require("./financial_statement.validator");

const MODULE = "MOD-59";
const router = express.Router();
router.use(authMiddleware);
router.get("/trial-balance", requirePermission(MODULE, "view"), validator.query, controller.trialBalance);
router.get("/income-statement", requirePermission(MODULE, "view"), validator.query, controller.compteDeResultat);
router.get("/balance-sheet", requirePermission(MODULE, "view"), validator.query, controller.bilan);

module.exports = { basePath: "/statements", feature: "accounting.statements", router };
