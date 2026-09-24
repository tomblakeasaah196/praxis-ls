/**
 * Worker job: the whole-call transcription job from before per-part
 * transcription (audit PR-2). Nothing enqueues it any more; it stays
 * registered so jobs queued before the deploy still run, as a deadline
 * finalise: parts whose job never ran are started, then the call is
 * finalised. The origin still decides whether anyone may be notified.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const pipeline = require("../../modules/smartcomm/smartcomm.call.pipeline.service");
const { logger } = require("../../config/logger");

module.exports = async function callTranscribe(job) {
  const { callId, tenantMeta, env = "live", user = null, origin = "hangup" } = job.data || {};
  if (!callId || !tenantMeta || (env !== "live" && env !== "sandbox")) {
    throw new Error("call-transcribe requires callId + a live or sandbox tenant");
  }
  const withDb = (fn) => registry.withTenantConnection(tenantMeta, env, fn);
  const result = await pipeline.finaliseCall({
    withDb, callId, tenantMeta, env, origin, deadline: true, user,
  });
  logger.info({ callId, env, origin, result }, "call-transcribe (legacy) finished");
  return result;
};
