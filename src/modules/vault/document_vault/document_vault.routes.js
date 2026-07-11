/** Document vault (MOD-64) — auth-gated reads + confidential download (not the
 *  public /media mount). SQL in the repo; gated per CONVENTIONS. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./document_vault.controller");

const MODULE = "MOD-64";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.get("/:id/download", requirePermission(MODULE, "view"), controller.download);

module.exports = { basePath: "/documents", feature: null, router };
