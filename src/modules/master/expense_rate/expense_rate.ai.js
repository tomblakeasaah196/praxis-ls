"use strict";
const service = require("./expense_rate.service");
const validator = require("./expense_rate.validator");
module.exports = {
  entity: "expense_rate", module_key: "MOD-10", screens: [],
  reads: [
    { key: "list_expense_rates", service: service.list, permission: { module: "MOD-10", action: "view" }, describe: "List expense rate cards." },
    { key: "get_expense_rate", service: service.get, permission: { module: "MOD-10", action: "view" }, describe: "Get an expense rate by id." },
    { key: "get_rate_vat_basis", service: (c, p) => service.vatBasisFor(c, { dictionaryItemId: p.dictionary_item_id, date: p.date }), schema: validator.schemas.vatBasisQuery, permission: { module: "MOD-10", action: "view" }, describe: "The VAT rate a dictionary line's VAT-inclusive (TTC) price is divided by to store its HT, and whether \"price includes VAT\" is offered (never on a débours)." },
    { key: "list_rates_to_review_for_vat", service: (c) => service.vatReview(c), permission: { module: "MOD-10", action: "view" }, describe: "Rates in force, entered HT, whose note says the price includes VAT (TTC / VAT inclusive / TVA incluse) — for a person to review. Nothing is changed." },
    { key: "resolve_expense_rate", service: service.resolve, permission: { module: "MOD-10", action: "view" }, describe: "Resolve the effective rate for an item at a date, optionally scoped to a carrier/authority and container type." },
  ],
  writes: [
    { key: "create_expense_rate", service: (c, p, actor) => service.create(c, { dictionaryItemId: p.dictionary_item_id, rateProviderId: p.rate_provider_id, containerTypeRefId: p.container_type_ref_id, rate: p.rate, currency: p.currency, effectiveFrom: p.effective_from, effectiveTo: p.effective_to, note: p.note, priceIncludesVat: p.price_includes_vat === true, actor }), schema: validator.schemas.create, permission: { module: "MOD-10", action: "create" }, confirm: true, describe: "Add an effective-dated expense rate, optionally scoped to a carrier/authority and container type. rate is HT unless price_includes_vat is true, in which case it is the TTC price and the HT is stored (TTC ÷ (1 + the line's VAT rate)); never on a débours." },
    { key: "update_expense_rate", service: (c, p, actor) => (({ expense_rate_id, ...patch }) => service.update(c, { id: expense_rate_id, patch, actor }))(p), schema: validator.schemas.aiUpdate, permission: { module: "MOD-10", action: "edit" }, confirm: true, describe: "Edit an expense rate by id. price_includes_vat says whether rate (or the figure last typed) is TTC; the HT is then stored." },
  ],
};
