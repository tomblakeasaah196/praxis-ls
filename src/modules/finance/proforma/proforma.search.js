/**
 * ⌘K search provider — proformas and customer advances, by client or file (MOD-50).
 *
 * Gated on the module's `view` grant by the search service, run on the
 * request's LIVE or TEST connection, bounded by the service's limit
 * (src/services/search/provider.js has the contract).
 */
"use strict";
const { recordProvider } = require("../../../services/search/provider.js");

module.exports = recordProvider({
  type: "proforma",
  module: "MOD-50",
  label: { en: "Proformas & advances", fr: "Proformas et avances" },
  route: "/finance/proformas",
  from: "advance a LEFT JOIN client_master c ON c.client_id = a.client_id LEFT JOIN dossier_visible d ON d.dossier_id = a.dossier_id",
  columns: ["c.name", "d.ref"],
  select: "a.advance_id AS id, d.ref AS ref, COALESCE(c.name, d.ref) AS title, d.ref AS sub, a.amount AS amount, a.received_on AS date",
  order: "a.created_at DESC",
  url: (r) => `/finance/proformas?focus=${encodeURIComponent(r.id)}`,
});
