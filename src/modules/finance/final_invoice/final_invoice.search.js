/**
 * ⌘K search provider — final invoices by number or client (MOD-51).
 *
 * Gated on the module's `view` grant by the search service, run on the
 * request's LIVE or TEST connection, bounded by the service's limit
 * (src/services/search/provider.js has the contract).
 */
"use strict";
const { recordProvider } = require("../../../services/search/provider.js");

module.exports = recordProvider({
  type: "invoice",
  module: "MOD-51",
  label: { en: "Invoices", fr: "Factures" },
  route: "/finance/invoices",
  from: "invoice i LEFT JOIN client_master c ON c.client_id = i.client_id",
  columns: ["i.doc_number", "c.name"],
  select: "i.invoice_id AS id, i.doc_number AS ref, COALESCE(i.doc_number, c.name) AS title, CASE WHEN i.doc_number IS NOT NULL THEN c.name END AS sub, i.status AS status, i.total_ttc AS amount, i.currency AS currency, i.payment_due_on AS date",
  where: "i.type = 'FINAL'",
  order: "i.created_at DESC",
  url: (r) => `/finance/invoices?focus=${encodeURIComponent(r.id)}`,
});
