/** Supplier invoice (MOD-61) — three-way match + GL post. Gated. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./supplier_invoice.controller");
const validator = require("./supplier_invoice.validator");

const MODULE = "MOD-61";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.post("/:id/match", requirePermission(MODULE, "edit"), controller.match);
router.post("/:id/post", requirePermission(MODULE, "approve"), validator.post, controller.post);

module.exports = { basePath: "/supplier-invoices", feature: null, router };
