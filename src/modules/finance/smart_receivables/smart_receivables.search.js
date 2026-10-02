/**
 * ⌘K search provider — payment receipts by client or treasury account (MOD-52).
 *
 * Gated on the module's `view` grant by the search service, run on the
 * request's LIVE or TEST connection, bounded by the service's limit
 * (src/services/search/provider.js has the contract).
 */
"use strict";
const { recordProvider } = require("../../../services/search/provider.js");

module.exports = recordProvider({
  type: "receipt",
  module: "MOD-52",
  label: { en: "Receipts", fr: "Encaissements" },
  route: "/finance/receivables",
  from: "payment_receipt r LEFT JOIN client_master c ON c.client_id = r.client_id LEFT JOIN treasury_account t ON t.treasury_account_id = r.treasury_account_id",
  columns: ["c.name", "t.label"],
  select: "r.receipt_id AS id, NULL AS ref, c.name AS title, NULLIF(concat_ws(' · ', t.label, r.method), '') AS sub, r.status AS status, r.amount AS amount, t.currency AS currency, r.received_on AS date",
  order: "r.received_on DESC",
  url: (r) => `/finance/receivables?focus=${encodeURIComponent(r.id)}`,
});
