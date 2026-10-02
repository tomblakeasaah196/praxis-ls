/**
 * ⌘K search provider — proposals by number, title or client (MOD-23).
 *
 * Gated on the module's `view` grant by the search service, run on the
 * request's LIVE or TEST connection, bounded by the service's limit
 * (src/services/search/provider.js has the contract).
 */
"use strict";
const { recordProvider } = require("../../../services/search/provider.js");

module.exports = recordProvider({
  type: "proposal",
  module: "MOD-23",
  label: { en: "Proposals", fr: "Propositions" },
  route: "/sales/proposals",
  from: "proposal p LEFT JOIN client_master c ON c.client_id = p.client_id",
  columns: ["p.doc_number", "p.title", "c.name"],
  select: "p.proposal_id AS id, p.doc_number AS ref, COALESCE(NULLIF(p.title, ''), p.doc_number) AS title, NULLIF(concat_ws(' · ', p.doc_number, c.name), '') AS sub, p.status AS status, p.currency AS currency",
  order: "p.created_at DESC",
  url: (r) => `/sales/proposals?focus=${encodeURIComponent(r.id)}`,
});
