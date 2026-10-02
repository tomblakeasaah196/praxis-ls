/** Quotation (MOD-27). Gated; feature commercial.quotation. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireTransitionPermission } = require("../../../shared/http/transition-permission");
const controller = require("./quotation.controller");
const validator = require("./quotation.validator");

const MODULE = "MOD-27";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
// "Create quotation" on a costing (meeting 6, G1). Declared before "/:id" so
// "from-costing" never parses as a quotation id. The preview writes nothing —
// it is what the button's dialog shows (the prices, the own-cost floor, the
// requests it could answer); the POST is the one click.
router.get("/from-costing/:costingId", requirePermission(MODULE, "view"), validator.costingParam, controller.fromCostingPreview);
router.post("/from-costing/:costingId", requirePermission(MODULE, "create"), validator.costingParam, validator.fromCosting, controller.fromCosting);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
// Sending your own quotation out is not a decision; accepting or rejecting one
// is. See shared/http/transition-permission.js.
const TRANSITION_ACTION = { SENT: "edit", CONVERTED: "edit", EXPIRED: "edit", ACCEPTED: "approve", REJECTED: "approve" };

router.post("/:id/transition", validator.transition, requireTransitionPermission(MODULE, TRANSITION_ACTION), controller.transition);
router.post("/:id/accept", requirePermission(MODULE, "approve"), validator.accept, controller.accept);
// ACCEPTED → a final-invoice DRAFT (meeting 6, G4). A client accepting in the
// portal never converts; this is the team's step afterwards. `edit`, the grant
// the CONVERTED transition already takes above.
router.post("/:id/convert", requirePermission(MODULE, "edit"), validator.convert, controller.convert);

module.exports = { basePath: "/quotations", feature: "commercial.quotation", router };
