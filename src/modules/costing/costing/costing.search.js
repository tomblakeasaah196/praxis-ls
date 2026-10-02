/**
 * ⌘K search provider — costings by number or by the file they price (MOD-46).
 *
 * Gated on the module's `view` grant by the search service, run on the
 * request's LIVE or TEST connection, bounded by the service's limit
 * (src/services/search/provider.js has the contract).
 */
"use strict";
const { recordProvider } = require("../../../services/search/provider.js");

module.exports = recordProvider({
  type: "costing",
  module: "MOD-46",
  label: { en: "Costings", fr: "Prix de revient" },
  route: "/costing/costing",
  from: "costing k JOIN dossier d ON d.dossier_id = k.dossier_id LEFT JOIN client_master c ON c.client_id = d.client_id",
  columns: ["k.doc_number", "d.ref"],
  select: "k.costing_id AS id, k.doc_number AS ref, COALESCE(k.doc_number, d.ref) AS title, NULLIF(concat_ws(' · ', d.ref, c.name), '') AS sub, k.status AS status, k.total_ttc AS amount, k.currency AS currency",
  order: "k.created_at DESC",
  url: (r) => `/costing/costing/${encodeURIComponent(r.id)}`,
});
