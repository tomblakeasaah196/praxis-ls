/** Goods Received Note (MOD-61). Gated; feature procurement.core. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./goods_received.controller");
const validator = require("./goods_received.validator");

const MODULE = "MOD-61";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);

module.exports = { basePath: "/goods-received", feature: null, router };
