/**
 * Smart-receivables repository (MOD-52). Receipts, allocations, and the
 * outstanding/ageing reads. All SQL for this module lives here.
 */
"use strict";
const { insertOne, getById } = require("../../../shared/db/query-helpers");

const insertReceipt = (client, data) => insertOne(client, "payment_receipt", data);
const getReceipt = (client, id) => getById(client, "payment_receipt", "receipt_id", id);
const insertAllocation = (client, data) => insertOne(client, "payment_allocation", data);

const updateReceipt = (client, id, fields) => {
  const keys = Object.keys(fields);
  if (!keys.length) return getReceipt(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  return client.query("UPDATE payment_receipt SET " + set + " WHERE receipt_id = $1 RETURNING *", [id, ...keys.map((k) => fields[k])]).then((r) => r.rows[0] || null);
};

/** Treasury account -> its GL cash account (521/571/538x). */
async function treasuryCoa(client, treasuryAccountId) {
  const { rows } = await client.query("SELECT coa_code FROM treasury_account WHERE treasury_account_id = $1", [treasuryAccountId]);
  return rows[0] ? rows[0].coa_code : null;
}

/** Open FINAL invoices (issued/posted) with outstanding = total_ttc - allocated. */
async function openInvoices(client, { clientId = null }) {
  const { rows } = await client.query(
    "SELECT i.invoice_id, i.doc_number, i.client_id, i.total_ttc, i.payment_due_on, " +
      "  COALESCE(a.allocated, 0) AS allocated, " +
      "  (i.total_ttc - COALESCE(a.allocated, 0)) AS outstanding " +
      "FROM invoice i " +
      "LEFT JOIN (SELECT invoice_id, SUM(amount) AS allocated FROM payment_allocation GROUP BY invoice_id) a " +
      "  ON a.invoice_id = i.invoice_id " +
      "WHERE i.type = 'FINAL' AND i.status IN ('POSTED_LOCKED','APPROVED_LOCKED','ISSUED_LOCKED') " +
      "  AND (i.total_ttc - COALESCE(a.allocated, 0)) > 0 " +
      "  AND ($1::uuid IS NULL OR i.client_id = $1) " +
      "ORDER BY i.payment_due_on ASC NULLS LAST, i.created_at ASC",
    [clientId],
  );
  return rows;
}

async function listReceipts(client, { clientId = null, limit = 50, offset = 0 }) {
  const params = [limit, offset];
  const wh = ["1=1"];
  if (clientId) { params.push(clientId); wh.push("client_id = $" + params.length); }
  const { rows } = await client.query(
    "SELECT * FROM payment_receipt WHERE " + wh.join(" AND ") + " ORDER BY received_on DESC, created_at DESC LIMIT $1 OFFSET $2",
    params,
  );
  return rows;
}

async function allocationsForReceipt(client, receiptId) {
  const { rows } = await client.query("SELECT * FROM payment_allocation WHERE receipt_id = $1", [receiptId]);
  return rows;
}

module.exports = { insertReceipt, getReceipt, updateReceipt, insertAllocation, treasuryCoa, openInvoices, listReceipts, allocationsForReceipt };
