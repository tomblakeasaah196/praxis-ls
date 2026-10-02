/**
 * ⌘K search provider — transit orders by OT number or file (MOD-30).
 *
 * Gated on the module's `view` grant by the search service, run on the
 * request's LIVE or TEST connection, bounded by the service's limit
 * (src/services/search/provider.js has the contract).
 */
"use strict";
const { recordProvider } = require("../../../services/search/provider.js");

module.exports = recordProvider({
  type: "transit_order",
  module: "MOD-30",
  label: { en: "Transit orders", fr: "Ordres de transit" },
  route: "/operations/transit-orders",
  from: "transit_order t LEFT JOIN dossier_visible d ON d.dossier_id = t.dossier_id",
  columns: ["t.ot_number", "d.ref"],
  select: "t.transit_order_id AS id, t.ot_number AS ref, COALESCE(t.ot_number, d.ref) AS title, d.ref AS sub, t.status AS status",
  order: "t.created_at DESC",
  url: (r) => `/operations/transit-orders/${encodeURIComponent(r.id)}`,
});
