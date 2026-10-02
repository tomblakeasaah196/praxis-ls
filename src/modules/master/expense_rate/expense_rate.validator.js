/**
 * Expense rate cards (MOD-10) — an ADAPTER over `@praxis/shared` expenseRate,
 * declaring nothing of its own. The rate dialog previews the HT of a
 * VAT-inclusive price with the same package the API stores it with (meeting
 * 6, F4), so the shapes live there too.
 */
"use strict";
const { expenseRate } = require("@praxis/shared");
const validate = require("../../../shared/http/validate");

const schemas = {
  create: expenseRate.create,
  update: expenseRate.update,
  aiUpdate: expenseRate.aiUpdate,
  resolveQuery: expenseRate.resolveQuery,
  vatBasisQuery: expenseRate.vatBasisQuery,
  importUpload: expenseRate.importUpload,
  importCommit: expenseRate.importCommit,
};

module.exports = {
  create: validate.body(schemas.create),
  update: validate.body(schemas.update),
  vatBasisQuery: validate.query(schemas.vatBasisQuery),
  importUpload: validate.body(schemas.importUpload),
  importCommit: validate.body(schemas.importCommit),
  schemas,
};
