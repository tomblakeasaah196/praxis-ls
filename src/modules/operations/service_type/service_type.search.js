/**
 * ⌘K search provider — service types by name (EN or FR) or key (MOD-29, as the module rides).
 *
 * Gated on the module's `view` grant by the search service, run on the
 * request's LIVE or TEST connection, bounded by the service's limit
 * (src/services/search/provider.js has the contract).
 */
"use strict";
const { recordProvider } = require("../../../services/search/provider.js");

module.exports = recordProvider({
  type: "service_type",
  module: "MOD-29",
  label: { en: "Service types", fr: "Types de service" },
  route: "/master/service-types",
  from: "service_type st",
  columns: ["st.name_en", "st.name_fr", "st.key"],
  select: "st.service_type_id AS id, st.key AS ref, COALESCE(NULLIF(st.name_en, ''), st.name_fr) AS title, COALESCE(NULLIF(st.name_fr, ''), st.name_en) AS title_fr, st.transport_mode AS sub",
  order: "st.name_en",
  url: (r) => `/master/service-types?focus=${encodeURIComponent(r.id)}`,
});
