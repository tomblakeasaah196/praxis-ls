/**
 * A dictionary line's rate — "Edit standard rate", a carrier's cell, "Apply to
 * all carriers" — as an ADAPTER over `@praxis/shared` expenseRate, declaring
 * nothing of its own. The dialog previews the HT of a VAT-inclusive price with
 * the same package the API stores it with (meeting 6, F4).
 * (financial_dictionary.validator.js keeps its own, unshared shapes; this file
 * is separate so the shared-schema gate can tell the two apart.)
 *
 * Supersede, not edit: `effective_from` is the pivot the open row is expired
 * against, so it is required.
 */
"use strict";

const { expenseRate } = require("@praxis/shared");
const validate = require("../../../shared/http/validate");

const uuid = expenseRate.vatBasisQuery.shape.dictionary_item_id;
const schemas = {
  rateSupersede: expenseRate.supersede,
  rateApplyAll: expenseRate.applyAll,
  aiRateSupersede: expenseRate.supersede.extend({ dictionary_item_id: uuid }),
  aiRateApplyAll: expenseRate.applyAll.extend({ dictionary_item_id: uuid }),
};

module.exports = {
  rateSupersede: validate.body(schemas.rateSupersede),
  rateApplyAll: validate.body(schemas.rateApplyAll),
  schemas,
};
