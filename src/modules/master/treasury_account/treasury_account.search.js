/**
 * ⌘K search provider — treasury accounts by label or bank (MOD-09).
 *
 * Gated on the module's `view` grant by the search service, run on the
 * request's LIVE or TEST connection, bounded by the service's limit
 * (src/services/search/provider.js has the contract).
 */
"use strict";
const { recordProvider } = require("../../../services/search/provider.js");

module.exports = recordProvider({
  type: "treasury_account",
  module: "MOD-09",
  label: { en: "Treasury accounts", fr: "Comptes de trésorerie" },
  route: "/master/treasury-accounts",
  from: "treasury_account t",
  // Never the account number or IBAN: a search box is not where those are typed.
  columns: ["t.label", "t.bank_name"],
  select: "t.treasury_account_id AS id, t.coa_code AS ref, t.label AS title, NULLIF(concat_ws(' · ', t.bank_name, t.kind), '') AS sub, t.currency AS currency",
  order: "t.label",
  url: (r) => `/master/treasury-accounts/${encodeURIComponent(r.id)}`,
});
