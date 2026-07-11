/** Proforma & customer advances (MOD-50). Gated + feature accounting.core. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./proforma.controller");
const validator = require("./proforma.validator");

const MODULE = "MOD-50";
const router = express.Router();
router.use(authMiddleware);
router.get("/advances", requirePermission(MODULE, "view"), controller.list);
router.get("/advances/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/pay", requirePermission(MODULE, "create"), validator.pay, controller.pay);

module.exports = { basePath: "/proformas", feature: "accounting.core", router };
