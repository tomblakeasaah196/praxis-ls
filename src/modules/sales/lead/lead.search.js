/**
 * ⌘K search provider — company rows (MOD-20), one per company
 * (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §5.5).
 *
 * Matched by the company, the contact, the email, the phone and the reference
 * of any of its requests: typing "SQ-2026-0042" finds the company it belongs
 * to. A row folded into its company's main row (14512) is not offered.
 *
 * Gated on the module's `view` grant by the search service, run on the
 * request's LIVE or TEST connection, bounded by the service's limit
 * (src/services/search/provider.js has the contract).
 */
"use strict";
const { recordProvider } = require("../../../services/search/provider.js");

module.exports = recordProvider({
  type: "lead",
  module: "MOD-20",
  label: { en: "Leads", fr: "Prospects" },
  route: "/sales/leads",
  from: `lead l
    LEFT JOIN LATERAL (
      SELECT string_agg(q.public_ref, ' ') AS refs FROM quote_request q WHERE q.lead_id = l.lead_id
    ) r ON true`,
  columns: ["l.company_name", "l.contact_name", "l.email", "l.phone", "r.refs"],
  where: "l.merged_into_lead_id IS NULL",
  select: "l.lead_id AS id, NULL::text AS ref, COALESCE(NULLIF(l.company_name, ''), l.contact_name) AS title, NULLIF(concat_ws(' · ', CASE WHEN l.client_id IS NOT NULL THEN 'Client' ELSE 'Prospect' END, l.contact_name), '') AS sub, l.status AS status, l.created_at AS date",
  order: "(l.status = 'OPEN') DESC, l.created_at DESC",
  url: (r) => `/sales/leads/${encodeURIComponent(r.id)}`,
});
