"use strict";
const orchestrator = require("../../src/services/ai/orchestrator.service");

// Fake tenant client that answers the governance gate queries by SQL shape.
function fakeClient({ enabled, grant = null, period = null }) {
  return {
    query: async (sql) => {
      if (/FROM ai_feature_flag/.test(sql)) return { rows: [{ feature_key: "assistant", is_enabled: enabled }] };
      if (/FROM ai_access_grant/.test(sql)) return { rows: grant ? [grant] : [] };
      if (/FROM ai_budget_period/.test(sql)) return { rows: period ? [period] : [] };
      if (/SUM\(cost_xaf\)/.test(sql)) return { rows: [{ spent: 0 }] };
      return { rows: [] };
    },
  };
}
const user = { user_id: "11111111-1111-1111-1111-111111111111" };

describe("assistant governance gate", () => {
  test("feature disabled → blocked, no model call, no actions", async () => {
    const res = await orchestrator.ask({ client: fakeClient({ enabled: false }), user, message: "raise an invoice" });
    expect(res.blocked).toBe(true);
    expect(res.actions).toEqual([]);
    expect(res.answer).toMatch(/unavailable/i);
  });

  test("enabled but no access grant → blocked", async () => {
    const res = await orchestrator.ask({ client: fakeClient({ enabled: true, grant: null }), user, message: "hi" });
    expect(res.blocked).toBe(true);
    expect(res.answer).toMatch(/grant/i);
  });

  test("enabled + active grant + budget hard-capped → blocked", async () => {
    const client = {
      query: async (sql) => {
        if (/FROM ai_feature_flag/.test(sql)) return { rows: [{ is_enabled: true }] };
        if (/FROM ai_access_grant/.test(sql)) return { rows: [{ revoked_at: null }] };
        if (/FROM ai_budget_period/.test(sql)) return { rows: [{ period_id: "p1", soft_cap_xaf: 100, hard_cap_xaf: 200 }] };
        if (/SUM\(cost_xaf\)/.test(sql)) return { rows: [{ spent: 250 }] }; // over hard cap
        return { rows: [] };
      },
    };
    const res = await orchestrator.ask({ client, user, message: "hi" });
    expect(res.blocked).toBe(true);
    expect(res.answer).toMatch(/budget/i);
  });
});
