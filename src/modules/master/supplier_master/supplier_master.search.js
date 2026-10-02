/**
 * ⌘K search provider — suppliers by name, legal name or reference, and their contacts (MOD-04).
 *
 * Gated on the module's `view` grant by the search service, run on the
 * request's LIVE or TEST connection, bounded by the service's limit
 * (src/services/search/provider.js has the contract).
 */
"use strict";
const { recordProvider } = require("../../../services/search/provider.js");

module.exports = [
  recordProvider({
    type: "supplier",
    module: "MOD-04",
    label: { en: "Suppliers", fr: "Fournisseurs" },
    route: "/master/suppliers",
    from: "supplier_master s",
    columns: ["s.name", "s.legal_name", "s.ref"],
    select: "s.supplier_id AS id, s.ref AS ref, s.name AS title, NULLIF(concat_ws(' · ', s.legal_name, s.city), '') AS sub",
    order: "s.name",
    url: (r) => `/master/suppliers?focus=${encodeURIComponent(r.id)}`,
  }),
  recordProvider({
    type: "supplier_contact",
    module: "MOD-04",
    label: { en: "Supplier contacts", fr: "Contacts fournisseurs" },
    route: "/master/suppliers",
    from: "supplier_contact sc JOIN supplier_master s ON s.supplier_id = sc.supplier_id",
    columns: ["sc.name", "sc.email"],
    select: "sc.contact_id AS id, NULL AS ref, sc.name AS title, NULLIF(concat_ws(' · ', s.name, sc.title, sc.email::text), '') AS sub, sc.supplier_id AS party_id",
    where: "sc.is_active IS NOT FALSE",
    order: "sc.name",
    url: (r) => `/master/suppliers?focus=${encodeURIComponent(r.party_id)}&tab=Contacts`,
  }),
];
