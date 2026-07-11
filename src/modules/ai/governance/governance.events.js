"use strict";
/**
 * AI Governance (AI control surface) — event keys. Governs the per-tenant EMV
 * toggle (ai_feature_flag), user access grants, spend caps (ai_budget_period /
 * ai_usage_ledger) and vendor credentials (ai_vendor_credential, keys encrypted).
 */
module.exports = {
  MODULE: "MOD-70",
  FEATURE_CHANGED: "ai.feature.changed",
  ACCESS_GRANTED: "ai.access.granted",
  ACCESS_REVOKED: "ai.access.revoked",
  BUDGET_SET: "ai.budget.set",
  VENDOR_SET: "ai.vendor.set",
  VENDOR_ROTATED: "ai.vendor.rotated",
  USAGE_RECORDED: "ai.usage.recorded",
};
