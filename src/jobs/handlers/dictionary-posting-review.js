/**
 * Worker job: one review of a tenant's dictionary postings (meeting 6, F8).
 * Job data: { tenantMeta, env, reviewId }.
 *
 * Compares every active line's posting with the AI suggestion — cache first,
 * a capped number of fresh grounded calls — and records the lines that differ.
 * It CHANGES NOTHING: a person applies a suggestion line by line through the
 * ordinary edit. A retried or restarted job resumes where it stopped, because
 * the service skips lines already examined in the run.
 */
"use strict";
const registry = require("../../services/tenant/registry.service");
const service = require("../../modules/master/financial_dictionary/financial_dictionary.service");

module.exports = async function dictionaryPostingReview(job) {
  const { tenantMeta, env = "live", reviewId } = job.data || {};
  if (!tenantMeta || !reviewId) throw new Error("dictionary-posting-review job needs tenantMeta and reviewId");
  return registry.withTenantConnection(tenantMeta, env, (c) => service.runReview(c, reviewId));
};
