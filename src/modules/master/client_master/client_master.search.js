/**
 * ⌘K search provider — clients by name, legal name or reference, and their contacts by name or email (MOD-03).
 *
 * Gated on the module's `view` grant by the search service, run on the
 * request's LIVE or TEST connection, bounded by the service's limit
 * (src/services/search/provider.js has the contract).
 */
"use strict";
const { recordProvider } = require("../../../services/search/provider.js");

module.exports = [
  recordProvider({
    type: "client",
    module: "MOD-03",
    label: { en: "Clients", fr: "Clients" },
    route: "/master/clients",
    from: "client_master c",
    columns: ["c.name", "c.legal_name", "c.ref"],
    select: "c.client_id AS id, c.ref AS ref, c.name AS title, NULLIF(concat_ws(' · ', c.legal_name, c.city), '') AS sub",
    // A merged duplicate is not a client any more; its survivor is.
    where: "c.merged_into_id IS NULL",
    order: "c.name",
    url: (r) => `/master/clients?focus=${encodeURIComponent(r.id)}`,
  }),
  recordProvider({
    type: "contact",
    module: "MOD-03",
    label: { en: "Client contacts", fr: "Contacts clients" },
    route: "/master/clients",
    from: "client_contact cc JOIN client_master c ON c.client_id = cc.client_id",
    columns: ["cc.name", "cc.email"],
    select: "cc.contact_id AS id, NULL AS ref, cc.name AS title, NULLIF(concat_ws(' · ', c.name, cc.title, cc.email::text), '') AS sub, cc.client_id AS party_id",
    where: "cc.is_active IS NOT FALSE",
    order: "cc.name",
    // The contact lives on its client's 360, Contacts tab.
    url: (r) => `/master/clients?focus=${encodeURIComponent(r.party_id)}&tab=Contacts`,
  }),
];
