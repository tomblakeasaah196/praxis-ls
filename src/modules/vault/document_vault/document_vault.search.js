/**
 * ⌘K search provider — vault documents by file name, type or the record they belong to (MOD-64).
 *
 * Gated on the module's `view` grant by the search service, run on the
 * request's LIVE or TEST connection, bounded by the service's limit
 * (src/services/search/provider.js has the contract).
 */
"use strict";
const { recordProvider } = require("../../../services/search/provider.js");

module.exports = recordProvider({
  type: "document",
  module: "MOD-64",
  label: { en: "Documents", fr: "Documents" },
  route: "/vault/documents",
  from: "document_vault dv",
  columns: ["dv.original_name", "dv.doc_type", "dv.entity_ref"],
  select: "dv.doc_id AS id, dv.entity_ref AS ref, COALESCE(NULLIF(dv.original_name, ''), dv.doc_type) AS title, NULLIF(concat_ws(' · ', dv.doc_type, dv.entity_ref), '') AS sub, dv.status AS status, dv.created_at AS date",
  // Archived evidence stays in the vault, not in the search box; a website
  // image is the website's, not a document.
  where: "dv.status IS DISTINCT FROM 'ARCHIVED' AND dv.public_media_scope IS NULL",
  order: "dv.created_at DESC",
  url: (r) => `/vault/documents?focus=${encodeURIComponent(r.id)}`,
});
