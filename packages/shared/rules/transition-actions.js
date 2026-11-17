"use strict";

/**
 * Which grant a lifecycle transition asks for, by TARGET state.
 *
 * ── WHY THIS IS IN packages/shared ─────────────────────────────────────────
 *
 * A status route does not have one grant. `POST /payroll/:id/status` asks for
 * `edit` to submit a run and `approve` to approve it, and it decides which from
 * the request body (`shared/http/transition-permission.js`). The screen draws
 * one button per target state, so to offer only the buttons the server will
 * accept it has to know the same map.
 *
 * Until now each map was a constant inside its routes file and the screen knew
 * nothing: a payroll clerk was shown Approve, Validate and Mark Disbursed, and
 * found out which were theirs by pressing them (access audit, 17 Nov 2026).
 * A second copy in the client would be a list that drifts from the one the
 * server enforces, and the visible failure is exactly the one being removed.
 * So there is one map, the routes file mounts it and the screen reads it.
 *
 * ── WHAT IT IS NOT ──────────────────────────────────────────────────────────
 *
 * Not the whole rule. A decision can also need the APPROVER capability, and
 * maker-checker forbids approving what you submitted. Neither is in the
 * client's access answer, so a button drawn here can still be refused, with a
 * message that says why. Hiding by grant removes the buttons a role can NEVER
 * use. It does not promise the ones that remain.
 *
 * ── THE FALLBACK IS THE STRICT END ──────────────────────────────────────────
 *
 * A target that is not in its map asks for `approve`, on both sides. A state
 * added later without a line here fails closed on the server and hides the
 * button from everyone but an approver, which is the same answer twice.
 */

const FALLBACK = "approve";

/** MOD-17 `POST /payroll/:id/status`, field `status`. Computing and submitting
 *  a run is payroll's own work; approving, validating and disbursing decide. */
const payrollStatus = Object.freeze({
  COMPUTED: "edit",
  SUBMITTED: "edit",
  OPEN: "edit",
  APPROVED: "approve",
  VALIDATED: "approve",
  DISBURSED: "approve",
  REJECTED: "approve",
});

/** MOD-60 `POST /purchase-orders/:id/transition`, field `to`. Issuing,
 *  receiving, closing and cancelling are procurement's own work; only
 *  APPROVED_LOCKED is a decision. */
const purchaseOrderTransition = Object.freeze({
  ISSUED_LOCKED: "edit",
  RECEIVED: "edit",
  CLOSED: "edit",
  CANCELLED: "edit",
  APPROVED_LOCKED: "approve",
});

/** MOD-60 `POST /purchase-orders/:id/unlock`, field `action`. Asking is the
 *  issuer's own act; granting or refusing is a decision. */
const purchaseOrderUnlock = Object.freeze({
  REQUEST_UNLOCK: "edit",
  UNLOCK: "approve",
  DENY_UNLOCK: "approve",
});

/** MOD-41 `POST /work-orders/:id/status` (and the same field on PATCH).
 *  Advancing is `edit`; ending the record is `approve`. */
const workOrderStatus = Object.freeze({
  OPEN: "edit",
  IN_PROGRESS: "edit",
  DONE: "approve",
  CANCELLED: "approve",
});

/** MOD-11 vacancies, field `status`. */
const vacancyStatus = Object.freeze({
  DRAFT: "edit",
  OPEN: "edit",
  PAUSED: "edit",
  CLOSED: "approve",
});

/** MOD-12 employment contracts, field `status`. */
const contractStatus = Object.freeze({
  DRAFT: "edit",
  ISSUED: "edit",
  SIGNED: "approve",
  ENDED: "approve",
});

/** MOD-18 training sessions, field `status`. */
const trainingStatus = Object.freeze({
  SCHEDULED: "edit",
  LIVE: "edit",
  DONE: "approve",
  CANCELLED: "approve",
});

/** MOD-20 quote requests, field `to`. */
const quoteRequestTransition = Object.freeze({
  UNDER_REVIEW: "edit",
  CLARIFICATION_REQUIRED: "edit",
  QUOTED: "edit",
  CLOSED_NO_ACTION: "approve",
});

/** MOD-20 quote requests, the pipeline `stage`. */
const quoteRequestStage = Object.freeze({
  NEW: "edit",
  CONTACTED: "edit",
  MEETING: "edit",
  QUOTED: "edit",
  LOST: "approve",
});

/** MOD-23 proposals, field `to`. */
const proposalTransition = Object.freeze({
  DRAFT: "edit",
  IN_REVIEW: "edit",
  SENT: "edit",
  REJECTED: "approve",
});

/** MOD-25 inbound intake, field `to`. */
const inboundIntakeTransition = Object.freeze({
  READ: "edit",
  RESPONDED: "edit",
  CLOSED: "edit",
});

/** MOD-27 quotations, field `to`. */
const quotationTransition = Object.freeze({
  SENT: "edit",
  CONVERTED: "edit",
  EXPIRED: "edit",
  ACCEPTED: "approve",
  REJECTED: "approve",
});

/** MOD-29 operations files, field `to`. */
const operationsFileTransition = Object.freeze({
  IN_PROGRESS: "edit",
  COMPLETED: "approve",
  CANCELLED: "approve",
});

/** MOD-30 transit orders, field `to`. */
const transitOrderTransition = Object.freeze({
  ISSUED: "create",
  SIGNED: "edit",
  LODGED: "edit",
  CANCELLED: "approve",
});

/** MOD-32 delivery notes, field `to`. */
const deliveryNoteTransition = Object.freeze({
  ISSUED: "create",
  DELIVERED: "edit",
  CANCELLED: "approve",
});

/** MOD-36 outbound orders, field `status`. */
const outboundStatus = Object.freeze({
  CREATED: "edit",
  PICKING: "edit",
  PACKED: "edit",
  DISPATCHED: "approve",
  CANCELLED: "approve",
});

/** MOD-37 warehouse equipment, field `status`. */
const equipmentStatus = Object.freeze({
  AVAILABLE: "edit",
  IN_USE: "edit",
  MAINTENANCE: "edit",
  OUT_OF_SERVICE: "approve",
});

/** MOD-42 fleet dispatch, field `status`. */
const dispatchStatus = Object.freeze({
  ASSIGNED: "edit",
  OUT: "edit",
  RETURNED: "edit",
  CANCELLED: "approve",
});

/** MOD-45 fleet incidents, field `status`. */
const incidentStatus = Object.freeze({
  OPEN: "edit",
  UNDER_REVIEW: "edit",
  CLOSED: "approve",
});

/** MOD-46 costings, field `to`. */
const costingTransition = Object.freeze({
  SUBMIT_VALIDATION: "edit",
  SUBMIT_APPROVAL: "edit",
  APPROVE: "approve",
  REJECT: "approve",
});

/** MOD-46 costings, the unlock loop, field `action`. */
const costingUnlock = Object.freeze({
  REQUEST_UNLOCK: "edit",
  UNLOCK: "approve",
  DENY_UNLOCK: "approve",
});

/** MOD-49 cash requests, field `to`. The finance visa (`validate`) and the cashier (`disburse`) are their own grants. */
const cashRequestTransition = Object.freeze({
  DRAFT: "edit",
  SUBMITTED: "edit",
  JUSTIFIED: "edit",
  VALIDATED: "validate",
  APPROVED: "approve",
  REJECTED: "approve",
  DISBURSED: "disburse",
});

/** MOD-62 purchase requests, field `to`. */
const purchaseRequestTransition = Object.freeze({
  SUBMITTED: "edit",
  ORDERED: "edit",
  APPROVED: "approve",
  REJECTED: "approve",
});

/** The action a transition to `target` asks for. Unlisted is `approve`. */
function actionFor(map, target) {
  return (map && Object.prototype.hasOwnProperty.call(map, target) && map[target]) || FALLBACK;
}

exports.FALLBACK = FALLBACK;
exports.payrollStatus = payrollStatus;
exports.purchaseOrderTransition = purchaseOrderTransition;
exports.purchaseOrderUnlock = purchaseOrderUnlock;
exports.workOrderStatus = workOrderStatus;
exports.vacancyStatus = vacancyStatus;
exports.contractStatus = contractStatus;
exports.trainingStatus = trainingStatus;
exports.quoteRequestTransition = quoteRequestTransition;
exports.quoteRequestStage = quoteRequestStage;
exports.proposalTransition = proposalTransition;
exports.inboundIntakeTransition = inboundIntakeTransition;
exports.quotationTransition = quotationTransition;
exports.operationsFileTransition = operationsFileTransition;
exports.transitOrderTransition = transitOrderTransition;
exports.deliveryNoteTransition = deliveryNoteTransition;
exports.outboundStatus = outboundStatus;
exports.equipmentStatus = equipmentStatus;
exports.dispatchStatus = dispatchStatus;
exports.incidentStatus = incidentStatus;
exports.costingTransition = costingTransition;
exports.costingUnlock = costingUnlock;
exports.cashRequestTransition = cashRequestTransition;
exports.purchaseRequestTransition = purchaseRequestTransition;
exports.actionFor = actionFor;
