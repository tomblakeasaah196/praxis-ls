/**
 * Milestone owners (MOD-31) — the registry behind a stage's owner dropdown.
 * CRUD, gated on the milestones module: the people who author a chain are the
 * people who need a party added to it (meeting 7, 01:57:20).
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { controller } = require("./milestone_owner.repo");

const MODULE = "MOD-31";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), controller.update);
router.delete("/:id", requirePermission(MODULE, "delete"), controller.remove);

module.exports = { basePath: "/milestone-owners", feature: null, router };
