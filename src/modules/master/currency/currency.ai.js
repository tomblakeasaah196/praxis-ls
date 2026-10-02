"use strict";
const service = require("./currency.service");
const validator = require("./currency.validator");
module.exports = {
  entity: "currency", module_key: "MOD-08", screens: [],
  reads: [
    { key: "list_currencies", service: service.listCurrencies, permission: { module: "MOD-08", action: "view" }, describe: "List active currencies." },
    { key: "fx_rate", service: service.rateFor, permission: { module: "MOD-08", action: "view" }, describe: "Resolve the FX rate for a pair on/before a date. XAF/XOF ↔ EUR is a fixed parity (655.957, BEAC/BCEAO) and comes back with is_fixed=true; a manual override stands (standing=true) until it is released." },
    { key: "fx_convert", service: service.convertAmount, permission: { module: "MOD-08", action: "view" }, describe: "Convert an amount between currencies at the stamped rate (the fixed parity for XAF/XOF ↔ EUR)." },
  ],
  writes: [
    { key: "set_fx_rate", service: (c, p, actor) => service.setRate(c, { base: p.base, quote: p.quote, rate: p.rate, asOfDate: p.as_of_date, source: p.source, isOverride: p.is_override, actor }), schema: validator.schemas.setRate, permission: { module: "MOD-08", action: "edit" }, confirm: true, describe: "Record a manual FX rate override. It stands over the daily feed until a newer override or until it is released. Refused for a fixed parity (XAF/XOF ↔ EUR)." },
    { key: "release_fx_override", service: (c, p, actor) => service.releaseOverride(c, { base: p.base, quote: p.quote, actor }), schema: validator.schemas.releaseRate, permission: { module: "MOD-08", action: "edit" }, confirm: true, describe: "Follow the feed again: release the manual override standing on a currency pair so the daily feed applies from today." },
  ],
};
