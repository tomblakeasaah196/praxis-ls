/**
 * ⌘K search provider — opportunities by name (MOD-24).
 *
 * Gated on the module's `view` grant by the search service, run on the
 * request's LIVE or TEST connection, bounded by the service's limit
 * (src/services/search/provider.js has the contract).
 */
"use strict";
const { recordProvider } = require("../../../services/search/provider.js");

module.exports = recordProvider({
  type: "opportunity",
  module: "MOD-24",
  label: { en: "Opportunities", fr: "Opportunités" },
  route: "/sales/opportunities",
  from: "opportunity o LEFT JOIN client_master c ON c.client_id = o.client_id",
  columns: ["o.name"],
  select: "o.opportunity_id AS id, NULL AS ref, o.name AS title, c.name AS sub, o.status AS status, o.estimated_value AS amount, o.currency AS currency",
  order: "o.created_at DESC",
  url: (r) => `/sales/opportunities?focus=${encodeURIComponent(r.id)}`,
});
