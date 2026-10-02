/**
 * ⌘K search provider — financial dictionary lines by code or label, English or French (MOD-05).
 *
 * Gated on the module's `view` grant by the search service, run on the
 * request's LIVE or TEST connection, bounded by the service's limit
 * (src/services/search/provider.js has the contract).
 */
"use strict";
const { recordProvider } = require("../../../services/search/provider.js");

module.exports = recordProvider({
  type: "dictionary_item",
  module: "MOD-05",
  label: { en: "Dictionary lines", fr: "Lignes du dictionnaire" },
  route: "/master/financial-dictionary",
  from: "dictionary_item di",
  columns: ["di.code", "di.label_en", "di.label_fr"],
  select: "di.dictionary_item_id AS id, di.code AS ref, COALESCE(NULLIF(di.label_en, ''), di.label_fr) AS title, COALESCE(NULLIF(di.label_fr, ''), di.label_en) AS title_fr, di.direction AS sub",
  // The bin is not the dictionary.
  where: "di.binned_at IS NULL",
  order: "di.code",
  url: (r) => `/master/financial-dictionary?focus=${encodeURIComponent(r.id)}`,
});
