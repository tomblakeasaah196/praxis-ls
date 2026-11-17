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

/** The action a transition to `target` asks for. Unlisted is `approve`. */
function actionFor(map, target) {
  return (map && Object.prototype.hasOwnProperty.call(map, target) && map[target]) || FALLBACK;
}

exports.FALLBACK = FALLBACK;
exports.payrollStatus = payrollStatus;
exports.purchaseOrderTransition = purchaseOrderTransition;
exports.purchaseOrderUnlock = purchaseOrderUnlock;
exports.workOrderStatus = workOrderStatus;
exports.actionFor = actionFor;
