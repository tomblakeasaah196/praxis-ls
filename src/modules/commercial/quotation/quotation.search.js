/**
 * ⌘K search provider — quotations by number or client (MOD-27). Opens in Sales & CRM › Quotations.
 *
 * Gated on the module's `view` grant by the search service, run on the
 * request's LIVE or TEST connection, bounded by the service's limit
 * (src/services/search/provider.js has the contract).
 */
"use strict";
const { recordProvider } = require("../../../services/search/provider.js");

module.exports = recordProvider({
  type: "quotation",
  module: "MOD-27",
  label: { en: "Quotations", fr: "Devis" },
  route: "/sales/quotations",
  from: "quotation q LEFT JOIN client_master c ON c.client_id = q.client_id",
  columns: ["q.doc_number", "c.name"],
  // A draft has no number yet: it is found, and titled, by its client.
  select: "q.quotation_id AS id, q.doc_number AS ref, COALESCE(q.doc_number, c.name) AS title, CASE WHEN q.doc_number IS NOT NULL THEN c.name END AS sub, q.status AS status, q.total_ttc AS amount, q.currency AS currency",
  order: "q.created_at DESC",
  url: (r) => `/sales/quotations?focus=${encodeURIComponent(r.id)}`,
});
