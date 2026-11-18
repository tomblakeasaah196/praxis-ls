/**
 * Worker job: a SENT quotation past its last valid day becomes EXPIRED
 * (lean revamp PR 4, §3.4 statuses). The public link already refuses an answer
 * from that day (quotation.rules answerable); this makes the register, the
 * portal and the lead's timeline say so. Job data: { tenantMeta, env }.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { expireOverdue } = require("../../modules/commercial/quotation/quotation.send");
const { logger } = require("../../config/logger");

module.exports = async function quotationExpiry(job) {
  const { tenantMeta, env = "live" } = job.data || {};
  if (!tenantMeta) throw new Error("quotation-expiry job needs tenantMeta");
  const out = await registry.withTenantConnection(tenantMeta, env, (c) => expireOverdue(c));
  if (out.expired) logger.info({ tenant: tenantMeta.slug, env, ...out }, "[quotation] offers expired");
  return out;
};
