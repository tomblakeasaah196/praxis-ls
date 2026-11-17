/**
 * quotation.accepted → the request it answers is WON
 * (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §5.2; owner decision D7).
 *
 * `quotation.accept` commits the acceptance and emits `quotation.accepted`,
 * whoever accepted it (the client on the link or in the portal, or staff
 * recording it). This does the follow-on work, out of that transaction: the
 * request is won, a prospect becomes a DRAFT client, the operations file opens,
 * the owner is told. All of it is `quote_request.win.js`, the same function
 * Mark Won calls by hand.
 *
 * IDEMPOTENT: delivery is at-least-once, and `win` locks the request and does
 * nothing for one already won with its file. A quotation answering no request
 * (a quotation typed for a client directly) has nothing to win.
 *
 * Replaces `opportunity-won-open-dossier.js`: there is no opportunity to win.
 */
"use strict";

const { win } = require("../../modules/sales/quote_request/quote_request.win");

function idFromRef(entityRef, prefix) {
  if (!entityRef || typeof entityRef !== "string") return null;
  return entityRef.startsWith(prefix + ":") ? entityRef.slice(prefix.length + 1) : null;
}

module.exports = {
  eventKey: "quotation.accepted",
  handlerKey: "quotation.accepted:win-request",
  feature: null,
  async run(client, event) {
    const quotationId = idFromRef(event.entity_ref, "quotation");
    if (!quotationId) return { skipped: "no quotation ref" };
    const { rows } = await client.query(
      "SELECT quotation_id, quote_request_id, status FROM quotation WHERE quotation_id = $1",
      [quotationId],
    );
    const q = rows[0];
    if (!q) return { skipped: "quotation not found" };
    if (!q.quote_request_id) return { skipped: "answers no request" };
    // Accepted, or already turned into an invoice since: both are a yes.
    if (q.status !== "ACCEPTED" && q.status !== "CONVERTED") return { skipped: `quotation is ${q.status}` };
    const out = await win(client, {
      id: q.quote_request_id,
      via: "QUOTATION",
      quotationId,
      actor: { user_id: event.actor_user_id || null },
    });
    return { won: !out.already, dossier_id: out.dossier_id, file_pending: out.file_pending, client_pending: out.client_pending };
  },
};
