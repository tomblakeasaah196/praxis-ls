"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireTransitionPermission, requireLifecyclePermissionOnPatch } = require("../../../shared/http/transition-permission");
const controller = require("./quote_request.controller");
const validator = require("./quote_request.validator");
const MODULE = "MOD-20";

/**
 * Quote request routes (MOD-20-intake) — the logistics-scope intake register
 * (F6, doc/SALES_CRM_FEATURES.md).
 *
 * Per-state RBAC: advancing through the intake funnel is `edit`; the
 * decision that ENDS the record (CONVERTED / CLOSED) is `approve`. Anything
 * unmapped falls back to `approve` so a state added later fails closed —
 * the same pattern lead.routes.js uses.
 */
const TRANSITION_ACTION = {
  UNDER_REVIEW: "edit",
  CLARIFICATION_REQUIRED: "edit",
  QUOTED: "edit",
  CONVERTED_TO_OPPORTUNITY: "approve",
  CLOSED_NO_ACTION: "approve",
};

const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/export.csv", requirePermission(MODULE, "view"), controller.exportCsv);
// The tile vocabulary the register renders, so the screen does not keep its
// own copy of the status list and drift from the one the API partitions on.
router.get("/tiles", requirePermission(MODULE, "view"), controller.tiles);
// Which client a requester's address belongs to (meeting 6, owner decision
// Q5) — the form's and the email conversion's one-tap suggestion. Declared
// before `/:id` so it is never read as an id.
router.get("/client-match", requirePermission(MODULE, "view"), validator.clientMatch, controller.clientMatch);
// The services a request can name — the desk's picker, each with its card,
// flow and Incoterms (14300).
router.get("/services", requirePermission(MODULE, "view"), controller.services);
// The 360° dossier — the request's full logistics scope, its attachments, the
// lead it came from and the opportunity it became, in one call. Same gate as
// the plain read; money is gated separately on finance visibility.
router.get("/:id/360", requirePermission(MODULE, "view"), controller.dossier);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update,
  requireLifecyclePermissionOnPatch(MODULE, TRANSITION_ACTION, { field: "status" }), controller.update);
router.post("/:id/transition", validator.transition, requireTransitionPermission(MODULE, TRANSITION_ACTION), controller.transition);
router.post("/:id/convert-to-opportunity", requirePermission(MODULE, "approve"), validator.convertToOpportunity, controller.convertToOpportunity);

// Attachments
router.get("/:id/attachments", requirePermission(MODULE, "view"), controller.listAttachments);
router.post("/:id/attachments", requirePermission(MODULE, "edit"), validator.attachment, controller.addAttachment);
router.delete("/:id/attachments/:attachmentId", requirePermission(MODULE, "edit"), controller.removeAttachment);
// A file a client sent in their portal chat, filed on one of their requests.
router.post("/:id/attachments/from-chat", requirePermission(MODULE, "edit"), validator.fromChat, controller.fileFromChat);

module.exports = { basePath: "/quote-requests", feature: null, router };
