/**
 * ⌘K search provider — operations files by reference, title or B/L-MAWB (MOD-29).
 *
 * Gated on the module's `view` grant by the search service, run on the
 * request's LIVE or TEST connection, bounded by the service's limit
 * (src/services/search/provider.js has the contract).
 */
"use strict";
const { recordProvider } = require("../../../services/search/provider.js");

module.exports = recordProvider({
  type: "file",
  module: "MOD-29",
  label: { en: "Operations files", fr: "Dossiers" },
  route: "/operations/files",
  from: "dossier_visible d LEFT JOIN client_master c ON c.client_id = d.client_id",
  columns: ["d.ref", "d.title", "d.bl_mawb"],
  select: "d.dossier_id AS id, d.ref AS ref, COALESCE(NULLIF(d.title, ''), d.ref) AS title, NULLIF(concat_ws(' · ', d.ref, c.name), '') AS sub, d.status AS status",
  order: "d.created_at DESC",
  url: (r) => `/operations/files/${encodeURIComponent(r.id)}`,
});
