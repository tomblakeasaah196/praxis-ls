/**
 * ⌘K search provider — quote requests by public reference, company or requester (MOD-20).
 *
 * Gated on the module's `view` grant by the search service, run on the
 * request's LIVE or TEST connection, bounded by the service's limit
 * (src/services/search/provider.js has the contract).
 */
"use strict";
const { recordProvider } = require("../../../services/search/provider.js");

module.exports = recordProvider({
  type: "quote_request",
  module: "MOD-20",
  label: { en: "Quote requests", fr: "Demandes de devis" },
  route: "/sales/quote-requests",
  from: "quote_request qr",
  columns: ["qr.public_ref", "qr.requester_company", "qr.requester_name"],
  select: "qr.quote_request_id AS id, qr.public_ref AS ref, COALESCE(NULLIF(qr.requester_company, ''), NULLIF(qr.requester_name, ''), qr.public_ref) AS title, NULLIF(concat_ws(' · ', qr.public_ref, qr.requester_name), '') AS sub, qr.status AS status, qr.created_at AS date",
  order: "qr.created_at DESC",
  url: (r) => `/sales/quote-requests/${encodeURIComponent(r.id)}`,
});
