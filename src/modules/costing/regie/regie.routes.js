/** Régie d'avance (MOD-49) — issue/age + reads. Gated + feature accounting.core. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./regie.controller");
const validator = require("./regie.validator");

const MODULE = "MOD-49";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/issue", requirePermission(MODULE, "create"), validator.issue, controller.issue);
router.post("/age-due", requirePermission(MODULE, "approve"), validator.ageDue, controller.ageDue);

module.exports = { basePath: "/regie", feature: "accounting.core", router };
