/**
 * Goods Received Note (MOD-61, KB §8.5) — records physical receipt against a PO.
 * Creating a GRN advances the PO to RECEIVED (through the PO service, so its
 * lifecycle rules apply). The three-way-match flag is set later when the supplier
 * invoice reconciles PR↔PO↔GRN↔invoice. All SQL is in the repo.
 */
"use strict";

const repo = require("./goods_received.repo");
const events = require("./goods_received.events");
const poService = require("../purchase_order/purchase_order.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "goods_received_note:" + id;

async function record(client, { poId, receivedBy = null, supplierInvoiceRef = null, entityId = null, date = null, actor = {} }) {
  const po = await repo.poStatus(client, poId);
  if (!po) throw new AppError("NOT_FOUND", "Purchase order not found", 404);
  if (!["APPROVED_LOCKED", "RECEIVED"].includes(po.status)) {
    throw new AppError("PO_NOT_RECEIVABLE", "PO must be APPROVED_LOCKED before goods can be received (is " + po.status + ")", 422);
  }
  await client.query("BEGIN");
  try {
    const grn = await repo.insertGRN(client, { po_id: poId, received_by: receivedBy || actor.user_id || null, supplier_invoice_ref: supplierInvoiceRef, three_way_matched: false });
    if (po.status === "APPROVED_LOCKED") await poService.transition(client, { poId, to: "RECEIVED", entityId, date, actor });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(grn.grn_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(grn.grn_id), after: grn });
    await client.query("COMMIT");
    return grn;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

const get = (client, id) => repo.getGRN(client, id);
const list = (client, q) => repo.listGRN(client, q);
const markMatched = (client, id, matched) => repo.update(client, id, { three_way_matched: matched === true });

module.exports = { record, get, list, markMatched };
