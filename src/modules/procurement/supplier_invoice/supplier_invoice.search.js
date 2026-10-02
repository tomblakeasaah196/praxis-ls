/**
 * ⌘K search provider — supplier invoices by our number, the supplier's own reference or the supplier (MOD-61).
 *
 * Gated on the module's `view` grant by the search service, run on the
 * request's LIVE or TEST connection, bounded by the service's limit
 * (src/services/search/provider.js has the contract).
 */
"use strict";
const { recordProvider } = require("../../../services/search/provider.js");

module.exports = recordProvider({
  type: "supplier_invoice",
  module: "MOD-61",
  label: { en: "Supplier invoices", fr: "Factures fournisseurs" },
  route: "/procurement/supplier-invoices",
  from: "supplier_invoice si LEFT JOIN supplier_master s ON s.supplier_id = si.supplier_id",
  columns: ["si.doc_number", "si.supplier_ref", "s.name"],
  select: "si.supplier_invoice_id AS id, COALESCE(si.doc_number, si.supplier_ref) AS ref, COALESCE(si.doc_number, si.supplier_ref, s.name) AS title, NULLIF(concat_ws(' · ', s.name, si.supplier_ref), '') AS sub, si.status AS status, si.amount_ttc AS amount, si.currency AS currency, si.due_on AS date",
  order: "si.created_at DESC",
  url: (r) => `/procurement/supplier-invoices?focus=${encodeURIComponent(r.id)}`,
});
