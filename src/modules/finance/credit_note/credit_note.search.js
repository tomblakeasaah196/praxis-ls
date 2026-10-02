/**
 * ⌘K search provider — credit notes by number or client (MOD-51).
 *
 * Gated on the module's `view` grant by the search service, run on the
 * request's LIVE or TEST connection, bounded by the service's limit
 * (src/services/search/provider.js has the contract).
 */
"use strict";
const { recordProvider } = require("../../../services/search/provider.js");

module.exports = recordProvider({
  type: "credit_note",
  module: "MOD-51",
  label: { en: "Credit notes", fr: "Avoirs" },
  route: "/finance/credit-notes",
  from: "invoice i LEFT JOIN client_master c ON c.client_id = i.client_id",
  columns: ["i.doc_number", "c.name"],
  select: "i.invoice_id AS id, i.doc_number AS ref, COALESCE(i.doc_number, c.name) AS title, CASE WHEN i.doc_number IS NOT NULL THEN c.name END AS sub, i.status AS status, i.total_ttc AS amount, i.currency AS currency",
  where: "i.type = 'CREDIT_NOTE'",
  order: "i.created_at DESC",
  // The register has no record view of its own: the result opens the list.
  url: () => "/finance/credit-notes",
});
