/**
 * AI Governance (AII control) — pure rules, DB-free (KB / AI_ARCHITECTURE §6).
 *   estimateCostXaf  tokens/audio × vendor rate → XAF (native→XAF via fx factor)
 *   capState         spend vs soft/hard cap → OK | WARN | BLOCK
 *   canUse           flag on + grant active + budget not hard-blocked
 * All money in major XAF units; rounded to 2dp.
 */
"use strict";
const round2 = (n) => Math.round(n * 100) / 100;

function estimateCostXaf({ inputTokens = 0, outputTokens = 0, audioSeconds = 0, vendor = {}, fxToXaf = 1 }) {
  const inK = Number(inputTokens) / 1000;
  const outK = Number(outputTokens) / 1000;
  const mins = Number(audioSeconds) / 60;
  const native =
    inK * Number(vendor.cost_per_1k_input_tokens || 0) +
    outK * Number(vendor.cost_per_1k_output_tokens || 0) +
    mins * Number(vendor.cost_per_audio_minute || 0);
  return round2(native * Number(fxToXaf || 1));
}

/** capState(spentXaf, { soft_cap_xaf, hard_cap_xaf }) → OK | WARN | BLOCK. */
function capState(spentXaf, caps = {}) {
  const spent = Number(spentXaf || 0);
  const hard = caps.hard_cap_xaf === null || caps.hard_cap_xaf === undefined ? null : Number(caps.hard_cap_xaf);
  const soft = caps.soft_cap_xaf === null || caps.soft_cap_xaf === undefined ? null : Number(caps.soft_cap_xaf);
  if (hard !== null && spent >= hard) return "BLOCK";
  if (soft !== null && spent >= soft) return "WARN";
  return "OK";
}

/** canUse({ flag, grant, budgetState }) → { allowed, reason }. */
function canUse({ flag, grant, budgetState }) {
  if (!flag || !flag.is_enabled) return { allowed: false, reason: "feature disabled for this tenant" };
  if (!grant || grant.revoked_at) return { allowed: false, reason: "user has no active access grant" };
  if (budgetState === "BLOCK") return { allowed: false, reason: "budget hard cap reached" };
  return { allowed: true, reason: budgetState === "WARN" ? "over soft cap (warned)" : "ok" };
}

module.exports = { estimateCostXaf, capState, canUse };
