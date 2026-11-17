/** Purchase order (MOD-60). Gated; feature procurement.core. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireTransitionPermission, requireTransitionCapability } = require("../../../shared/http/transition-permission");
const { transitionActions } = require("@praxis/shared");
const controller = require("./purchase_order.controller");
const validator = require("./purchase_order.validator");

const MODULE = "MOD-60";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
// Issuing, receiving, closing and cancelling a PO are procurement's own work;
// only APPROVED_LOCKED is a decision. See shared/http/transition-permission.js.
// The map lives in @praxis/shared so the screen offers exactly the buttons
// this route accepts (rules/transition-actions.js).
const TRANSITION_ACTION = transitionActions.purchaseOrderTransition;

router.post("/:id/transition", validator.transition, requireTransitionPermission(MODULE, TRANSITION_ACTION), controller.transition);
// Paying a PO directly moves money out of the treasury — an approval-grade
// act, same gate the SI posting uses.
router.post("/:id/pay", requirePermission(MODULE, "approve"), validator.pay, controller.pay);
// The unlock loop (10721) — mirror of costing.routes.js: asking is the
// issuer's own act (`edit`), granting/refusing is a decision (`approve` +
// APPROVER capability; CEO bypasses).
const UNLOCK_ACTION = transitionActions.purchaseOrderUnlock;
const UNLOCK_CAPABILITY = { UNLOCK: "APPROVER", DENY_UNLOCK: "APPROVER" };
router.post(
  "/:id/unlock",
  validator.unlock,
  requireTransitionPermission(MODULE, UNLOCK_ACTION, { field: "action" }),
  requireTransitionCapability(UNLOCK_CAPABILITY, { field: "action" }),
  controller.unlock,
);

module.exports = { basePath: "/purchase-orders", feature: null, router };
