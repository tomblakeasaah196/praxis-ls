/** Quotation (MOD-27). Gated; feature commercial.quotation. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireTransitionPermission } = require("../../../shared/http/transition-permission");
// The maps below live in @praxis/shared so the screens offer exactly the buttons
// these routes accept (rules/transition-actions.js).
const { transitionActions } = require("@praxis/shared");
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
// The template library (lean revamp §3.5). Declared before "/:id" so
// "templates" never parses as a quotation id. Reading is `view`; changing the
// defaults every new quotation starts from is `edit`.
router.get("/templates", requirePermission(MODULE, "view"), controller.templates);
router.post("/templates", requirePermission(MODULE, "edit"), validator.template, controller.createTemplate);
router.get("/templates/:templateId", requirePermission(MODULE, "view"), controller.template);
router.patch("/templates/:templateId", requirePermission(MODULE, "edit"), validator.templatePatch, controller.updateTemplate);
router.get("/templates/:templateId/preview", requirePermission(MODULE, "view"), validator.renderQuery, controller.previewTemplate);
// The reasons a client declines for, in both languages (the same list the link offers).
router.get("/decline-reasons", requirePermission(MODULE, "view"), controller.declineReasons);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
// The one render: preview (HTML) and the PDF, as Full or Extract, EN or FR.
router.get("/:id/preview", requirePermission(MODULE, "view"), validator.renderQuery, controller.preview);
router.get("/:id/pdf", requirePermission(MODULE, "view"), validator.renderQuery, controller.pdf);
router.get("/:id/views", requirePermission(MODULE, "view"), controller.views);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
// Sending your own quotation out is not a decision; accepting or rejecting one
// is. See shared/http/transition-permission.js.
const TRANSITION_ACTION = transitionActions.quotationTransition;

router.post("/:id/transition", validator.transition, requireTransitionPermission(MODULE, TRANSITION_ACTION), controller.transition);
router.post("/:id/accept", requirePermission(MODULE, "approve"), validator.accept, controller.accept);
// Decline with a reason, recorded by staff: the grant the REJECTED step takes.
router.post("/:id/decline", requirePermission(MODULE, TRANSITION_ACTION.REJECTED), validator.decline, controller.decline);
// Send (§3.4) is sending your own quotation out: the grant the SENT step takes.
router.post("/:id/send", requirePermission(MODULE, TRANSITION_ACTION.SENT), validator.send, controller.send);
router.post("/:id/share", requirePermission(MODULE, "edit"), validator.share, controller.share);
router.post("/:id/share/revoke", requirePermission(MODULE, "edit"), validator.revoke, controller.revokeShare);
// Revise makes a new quotation (version + 1), so it takes `create`.
router.post("/:id/revise", requirePermission(MODULE, "create"), validator.revise, controller.revise);
router.post("/:id/draft-sections", requirePermission(MODULE, "edit"), validator.draftSections, controller.draftSections);
// ACCEPTED → a final-invoice DRAFT (meeting 6, G4). A client accepting in the
// portal never converts; this is the team's step afterwards. `edit`, the grant
// the CONVERTED transition already takes above.
router.post("/:id/convert", requirePermission(MODULE, "edit"), validator.convert, controller.convert);

module.exports = { basePath: "/quotations", feature: "commercial.quotation", router };
