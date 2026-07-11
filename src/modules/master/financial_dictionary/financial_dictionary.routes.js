/** Financial Dictionary (MOD-05) — dictionary items + their posting rules
 *  (the account-determination source, KB §4). Gated: auth + RBAC MOD-05. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const c = require("./financial_dictionary.controller");
const v = require("./financial_dictionary.validator");

const MODULE = "MOD-05";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), c.list);
router.get("/:id", requirePermission(MODULE, "view"), c.get);
router.post("/", requirePermission(MODULE, "create"), v.create, c.create);
router.patch("/:id", requirePermission(MODULE, "edit"), v.update, c.update);

module.exports = { basePath: "/financial-dictionary", feature: null, router };
