/**
 * ⌘K search provider — cash requests by number, beneficiary or file (MOD-49).
 *
 * Gated on the module's `view` grant by the search service, run on the
 * request's LIVE or TEST connection, bounded by the service's limit
 * (src/services/search/provider.js has the contract).
 */
"use strict";
const { recordProvider } = require("../../../services/search/provider.js");

module.exports = recordProvider({
  type: "cash_request",
  module: "MOD-49",
  label: { en: "Cash requests", fr: "Demandes de fonds" },
  route: "/costing/cash-requests",
  from: "cash_request cr LEFT JOIN dossier_visible d ON d.dossier_id = cr.dossier_id",
  columns: ["cr.doc_number", "cr.beneficiary", "d.ref"],
  select: "cr.cash_request_id AS id, cr.doc_number AS ref, COALESCE(cr.doc_number, cr.beneficiary) AS title, NULLIF(concat_ws(' · ', cr.beneficiary, d.ref), '') AS sub, cr.status AS status, cr.amount AS amount, cr.currency AS currency",
  order: "cr.created_at DESC",
  url: (r) => `/costing/cash-requests/${encodeURIComponent(r.id)}`,
});
