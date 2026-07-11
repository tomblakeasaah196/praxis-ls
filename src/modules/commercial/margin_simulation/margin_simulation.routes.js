/** Margin simulator (MOD-27) — rapid quote, no GL. Gated (view/create). */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./margin_simulation.controller");
const validator = require("./margin_simulation.validator");

const MODULE = "MOD-27";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/preview", requirePermission(MODULE, "view"), validator.compute, controller.preview);
router.post("/", requirePermission(MODULE, "create"), validator.compute, controller.create);

module.exports = { basePath: "/margin-simulations", feature: null, router };
