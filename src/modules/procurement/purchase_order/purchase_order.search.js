/**
 * ⌘K search provider — purchase orders by number or supplier (MOD-60).
 *
 * Gated on the module's `view` grant by the search service, run on the
 * request's LIVE or TEST connection, bounded by the service's limit
 * (src/services/search/provider.js has the contract).
 */
"use strict";
const { recordProvider } = require("../../../services/search/provider.js");

module.exports = recordProvider({
  type: "purchase_order",
  module: "MOD-60",
  label: { en: "Purchase orders", fr: "Bons de commande" },
  route: "/procurement/purchase-orders",
  from: "purchase_order po LEFT JOIN supplier_master s ON s.supplier_id = po.supplier_id",
  columns: ["po.doc_number", "po.supplier_name", "s.name"],
  select: "po.po_id AS id, po.doc_number AS ref, COALESCE(po.doc_number, s.name, po.supplier_name) AS title, COALESCE(s.name, po.supplier_name) AS sub, po.status AS status, po.total_ttc AS amount, po.currency AS currency",
  order: "po.created_at DESC",
  url: (r) => `/procurement/purchase-orders?focus=${encodeURIComponent(r.id)}`,
});
