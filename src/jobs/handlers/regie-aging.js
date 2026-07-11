/**
 * Worker job: age a tenant's régie d'avances past their policy window
 * (581 -> 4211, KB §6.8). Job data: { tenantMeta, env, entityId, entryDate?,
 * sourceDocRef? }. The periodic per-tenant enqueue is a scheduled fan-out
 * (an app scheduled-task or cron can also call POST /regie/age-due directly).
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const regie = require("../../modules/costing/regie/regie.service");

module.exports = async function regieAging(job) {
  const { tenantMeta, env = "live", entityId, entryDate = null, sourceDocRef = "system:regie-aging" } = job.data || {};
  if (!tenantMeta || !entityId) throw new Error("regie-aging job needs tenantMeta + entityId");
  return registry.withTenantConnection(tenantMeta, env, (c) =>
    regie.ageDue(c, { entityId, entryDate, sourceDocRef, actor: { user_id: null } }),
  );
};
