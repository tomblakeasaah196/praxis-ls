/**
 * The AI-suggested OHADA posting's request (meeting 6, F3) — an ADAPTER over
 * `@praxis/shared` dictionaryPosting, declaring nothing of its own, so the
 * wizard that sends the request and the API that reads it agree on one shape.
 * (financial_dictionary.validator.js keeps its own, unshared shapes; this
 * file is separate so the shared-schema gate can tell the two apart.)
 */
"use strict";

const { dictionaryPosting } = require("@praxis/shared");
const validate = require("../../../shared/http/validate");

module.exports = {
  postingSuggestion: validate.body(dictionaryPosting.request),
  schemas: { postingSuggestion: dictionaryPosting.request, provenance: dictionaryPosting.provenance },
};
