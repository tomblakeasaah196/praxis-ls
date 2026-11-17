/**
 * ⌘K search provider — requests (MOD-20), each of which is also the deal
 * (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §5.5).
 *
 * Matched by reference, title, the company row's name and the requester. A
 * result opens its company's Lead 360 with the request on top
 * (`/sales/leads/<lead>?request=<id>`, the deep link PR 3's request sheet reads).
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
  label: { en: "Requests", fr: "Demandes" },
  route: "/sales/leads",
  from: "quote_request qr LEFT JOIN lead l ON l.lead_id = qr.lead_id",
  columns: ["qr.public_ref", "qr.title", "l.company_name", "qr.requester_company", "qr.requester_name"],
  select: "qr.quote_request_id AS id, qr.lead_id AS lead_id, qr.public_ref AS ref, COALESCE(NULLIF(qr.title, ''), NULLIF(l.company_name, ''), NULLIF(qr.requester_company, ''), qr.public_ref) AS title, NULLIF(concat_ws(' · ', qr.public_ref, l.company_name), '') AS sub, qr.stage AS status, qr.created_at AS date",
  order: "qr.created_at DESC",
  url: (r) => `/sales/leads/${encodeURIComponent(r.lead_id)}?request=${encodeURIComponent(r.id)}`,
});
