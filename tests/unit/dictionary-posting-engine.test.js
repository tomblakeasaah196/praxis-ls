"use strict";

/**
 * Meeting 6, PR 3 — section C, the engine's orchestration (F7 / F8):
 *
 *   - concurrent requests for the same key make ONE grounded call;
 *   - a blocked gate (plan limit, budget cap, revoked user) gives the labelled
 *     local suggestion — never a dead end;
 *   - an import past its cap of fresh calls uses the local suggestion and says
 *     why;
 *   - the review lists differences and changes nothing.
 */
jest.mock("axios");
jest.mock("../../src/services/ai/dictionary-posting/cache.repo", () => ({
  exact: jest.fn(async () => null),
  near: jest.fn(async () => null),
  touch: jest.fn(async () => null),
  upsert: jest.fn(async (e) => ({ cache_entry_id: "11111111-1111-4111-8111-111111111111", answered_at: "2026-10-01", model: e.model })),
  claim: jest.fn(async () => true),
  release: jest.fn(async () => null),
  prices: jest.fn(async () => [{ model_prefix: "*", input_per_1m: 2, output_per_1m: 12, search_fee: 14, search_fee_per: 1000, search_unit: "query", currency: "USD", source: "test" }]),
}));
jest.mock("../../src/services/ai/dictionary-posting/model.service", () => ({
  postingModel: jest.fn(async () => ({ status: "ok", model: "gemini-3.1-pro" })),
  markFailed: jest.fn(),
}));
jest.mock("../../src/modules/ai/governance/governance.service", () => ({
  canUseFeature: jest.fn(async () => ({ allowed: true })),
  recordUsage: jest.fn(async () => ({})),
}));
jest.mock("../../src/services/ai/embeddings.service", () => ({ embedOne: jest.fn(async () => undefined) }));
jest.mock("../../src/services/ai/llm.service", () => ({
  resolveVendor: jest.fn(async () => ({ api_key: "k", endpoint_url: "https://generativelanguage.googleapis.com/v1beta/openai" })),
}));

const axios = require("axios");
const governance = require("../../src/modules/ai/governance/governance.service");
const engine = require("../../src/services/ai/dictionary-posting/engine.service");
const service = require("../../src/modules/master/financial_dictionary/financial_dictionary.service");

const client = () => ({
  async query(sql) {
    if (/FROM chart_of_accounts/.test(sql)) {
      return { rows: [{ code: "6131", is_postable: true }, { code: "4011", is_postable: true }, { code: "4111", is_postable: true }, { code: "4731", is_postable: true }] };
    }
    if (/FROM tax_code/.test(sql)) return { rows: [] };
    if (/similarity\(/.test(sql)) return { rows: [] };
    return { rows: [] };
  },
});

const reply = {
  data: {
    candidates: [{
      content: { parts: [{ text: JSON.stringify({ direction: "EXPENSE", is_disbursement: false, vat_treatment: "STANDARD", postings: [{ context: "purchase", debit: "6131", credit: "4011" }], confidence: "high" }) }] },
      groundingMetadata: { webSearchQueries: ["q"], groundingChunks: [] },
    }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
  },
};

beforeEach(() => {
  axios.post.mockReset();
  governance.canUseFeature.mockResolvedValue({ allowed: true });
});

describe("one call per key", () => {
  it("two concurrent requests for the same line make ONE grounded call", async () => {
    let release;
    axios.post.mockImplementation(() => new Promise((r) => { release = () => r(reply); }));
    const q = { label_fr: "Frais de port", label_en: "Port Fee", category: "overhead", direction: "EXPENSE" };
    const a = engine.suggest(client(), q);
    const b = engine.suggest(client(), q);
    await new Promise((r) => setTimeout(r, 30));
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(ra.source).toBe("search");
    expect(rb.source).toBe("cache");
    expect(rb.cost.native).toBe(0);
  });
});

describe("never a dead end", () => {
  it("a blocked gate gives the labelled local suggestion and makes no call", async () => {
    governance.canUseFeature.mockResolvedValue({ allowed: false, reason: "the plan's AI spend limit for this month has been reached" });
    const out = await engine.suggest(client(), { label_fr: "Débours douane", category: "disbursement", direction: "DISBURSEMENT" });
    expect(axios.post).not.toHaveBeenCalled();
    expect(out.source).toBe("local");
    expect(out.fallback_reason).toMatch(/plan's AI spend limit/);
    expect(out.rules.map((r) => [r.applies_context, r.debit_account, r.credit_account])).toEqual([
      ["purchase", "4731", "4011"],
      ["sale", "4111", "4731"],
    ]);
  });

  it("an import past its cap of fresh calls uses the local suggestion and says so", async () => {
    const out = await engine.suggest(client(), { label_fr: "Autre", category: "overhead", direction: "EXPENSE" }, { callBudget: { left: 0 } });
    expect(axios.post).not.toHaveBeenCalled();
    expect(out.source).toBe("local");
    expect(out.fallback_reason).toMatch(/allowance/);
  });
});

describe("the review changes nothing", () => {
  it("lists the differences between a line's posting and the suggestion", () => {
    const reasons = service.postingDifferences(
      { direction: "EXPENSE", is_disbursement: false },
      [{ applies_context: "purchase", debit_account: "6271", credit_account: "4011" }],
      { direction: "EXPENSE", is_disbursement: false, rules: [{ applies_context: "purchase", debit_account: "6131", credit_account: "4011", mapping: { debit: { suggested: "6131" }, credit: { suggested: "4011" } } }] },
    );
    expect(reasons).toEqual(["purchase: debit 6271 here, 6131 suggested"]);
  });

  it("an identical posting is a match", () => {
    expect(
      service.postingDifferences(
        { direction: "DISBURSEMENT", is_disbursement: true },
        [{ applies_context: "sale", debit_account: "4111", credit_account: "4731" }],
        { direction: "DISBURSEMENT", is_disbursement: true, rules: [{ applies_context: "sale", debit_account: "4111", credit_account: "4731", mapping: {} }] },
      ),
    ).toEqual([]);
  });
});
