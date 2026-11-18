/**
 * Worker job: the nightly quotation expiry fan-out (lean revamp PR 4, §3.4).
 * One job per tenant AND environment: an expiry is a fact about the offer, not
 * a message to anyone, so TEST's quotations lapse on the same day LIVE's do.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");

module.exports = async function quotationExpiryScheduler() {
  const tenants = await registry.listActiveTenants();
  let enqueued = 0;
  for (const tenantMeta of tenants) {
    for (const env of ["live", "sandbox"]) {
      await enqueue("quotation-expiry", "expire", { tenantMeta, env }, {
        jobId: `quotation-expiry:${tenantMeta.db_name}:${env}`, attempts: 2, removeOnComplete: true, removeOnFail: true,
      });
      enqueued += 1;
    }
  }
  return { tenants: tenants.length, enqueued };
};
