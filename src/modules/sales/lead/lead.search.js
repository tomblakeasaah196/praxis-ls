/**
 * ⌘K search provider — leads by company, contact or reference (MOD-20).
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
  from: "lead l",
  columns: ["l.company_name", "l.contact_name", "l.public_ref"],
  select: "l.lead_id AS id, l.public_ref AS ref, COALESCE(NULLIF(l.company_name, ''), l.contact_name) AS title, NULLIF(concat_ws(' · ', l.contact_name, l.public_ref), '') AS sub, l.status AS status",
  order: "l.created_at DESC",
  url: (r) => `/sales/leads/${encodeURIComponent(r.id)}`,
});
