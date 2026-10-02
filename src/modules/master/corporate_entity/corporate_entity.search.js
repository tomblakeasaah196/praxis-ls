/**
 * ⌘K search provider — corporate entities by legal name, trading name or code (MOD-01).
 *
 * Gated on the module's `view` grant by the search service, run on the
 * request's LIVE or TEST connection, bounded by the service's limit
 * (src/services/search/provider.js has the contract).
 */
"use strict";
const { recordProvider } = require("../../../services/search/provider.js");

module.exports = recordProvider({
  type: "corporate_entity",
  module: "MOD-01",
  label: { en: "Corporate entities", fr: "Entités" },
  route: "/master/corporate-entities",
  from: "corporate_entity e",
  columns: ["e.legal_name", "e.trading_name", "e.code"],
  select: "e.entity_id AS id, e.code AS ref, COALESCE(NULLIF(e.trading_name, ''), e.legal_name) AS title, NULLIF(concat_ws(' · ', e.legal_name, e.country_code), '') AS sub",
  order: "e.legal_name",
  url: (r) => `/master/corporate-entities/${encodeURIComponent(r.id)}`,
});
