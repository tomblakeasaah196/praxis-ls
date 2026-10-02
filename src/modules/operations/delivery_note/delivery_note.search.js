/**
 * ⌘K search provider — delivery notes by number, consignee or file (MOD-32).
 *
 * Gated on the module's `view` grant by the search service, run on the
 * request's LIVE or TEST connection, bounded by the service's limit
 * (src/services/search/provider.js has the contract).
 */
"use strict";
const { recordProvider } = require("../../../services/search/provider.js");

module.exports = recordProvider({
  type: "delivery_note",
  module: "MOD-32",
  label: { en: "Delivery notes", fr: "Bons de livraison" },
  route: "/operations/delivery-notes",
  from: "delivery_note n LEFT JOIN dossier d ON d.dossier_id = n.dossier_id",
  columns: ["n.doc_number", "n.consignee", "d.ref"],
  select: "n.delivery_note_id AS id, n.doc_number AS ref, COALESCE(n.doc_number, d.ref) AS title, NULLIF(concat_ws(' · ', n.consignee, d.ref), '') AS sub, n.status AS status, n.delivery_date AS date",
  order: "n.created_at DESC",
  url: (r) => `/operations/delivery-notes/${encodeURIComponent(r.id)}`,
});
