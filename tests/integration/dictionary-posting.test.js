"use strict";

/**
 * Meeting 6, PR 3 — Definition of done #5, against a real tenant whose
 * assistant is OFF and a real platform database (the shared cache, the price
 * list). Google is the only thing faked: `axios` answers the native models
 * list and generateContent the way Gemini does.
 *
 *   - the feature's OWN gate lets it run while the assistant's gate is shut,
 *     and the assistant's gate is unchanged;
 *   - a fresh suggestion pre-fills a SYSCOHADA posting on EXISTING accounts,
 *     with its sources, the Search Suggestions and a confidence level;
 *   - the ledger records the model's own price and the search fee, under the
 *     feature's key;
 *   - the same label asked again (as another tenant would) makes no model call;
 *   - the platform cache holds our structured answer only — no Google text;
 *   - a failed call gives the labelled local suggestion, and the line saves.
 *
 * Runs only with DATABASE_URL pointing at a provisioned tenant (and the
 * platform DB_* env, as in CI's migrations job); self-skips otherwise.
 */
jest.mock("axios");
jest.mock("../../src/services/ai/llm.service", () => {
  const actual = jest.requireActual("../../src/services/ai/llm.service");
  return {
    ...actual,
    resolveVendor: jest.fn(async (_c, name) =>
      name === "gemini"
        ? { vendor: "gemini", api_key: "test-key", endpoint_url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash" }
        : null,
    ),
  };
});

const hasDb = !!process.env.DATABASE_URL && !!process.env.DB_NAME;
const d = hasDb ? describe : describe.skip;

d("AI-suggested OHADA posting (14343, platform 0119, seed 9150)", () => {
  const axios = require("axios");
  let pool;
  let c;
  let platformDb;
  const LABEL = `Pr3 Test Gate Fee ${Date.now()}`;

  const grounded = (answer) => ({
    data: {
      candidates: [{
        content: { parts: [{ text: JSON.stringify(answer) }] },
        groundingMetadata: {
          webSearchQueries: ["syscohada frais ticket de sortie terminal"],
          searchEntryPoint: { renderedContent: "<style>.c{}</style><div class=\"c\">chip</div>" },
          groundingChunks: [{ web: { uri: "https://example.org/ohada", title: "Plan comptable SYSCOHADA" } }],
        },
      }],
      usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 200, thoughtsTokenCount: 100 },
    },
  });

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    c = await pool.connect();
    platformDb = require("../../src/services/platform/db");
    require("../../src/services/ai/dictionary-posting/model.service").resetCache();
    axios.get.mockImplementation(async (url) => {
      if (/\/models$/.test(url)) {
        return { data: { models: [
          { name: "models/gemini-3.1-pro", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-3.5-pro-preview", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
        ] } };
      }
      return { data: { name: "models/gemini-3.1-pro", displayName: "Gemini 3.1 Pro", supportedGenerationMethods: ["generateContent"] } };
    });
  });
  afterAll(async () => {
    if (platformDb) await platformDb.query("DELETE FROM platform.ai_posting_cache WHERE normalised_label LIKE 'pr3 test gate fee%'").catch(() => {});
    if (c) c.release();
    if (pool) await pool.end();
    if (platformDb) await platformDb.close().catch(() => {});
  });
  beforeEach(() => axios.post.mockReset());

  test("its own gate: allowed while the assistant is off; the assistant's gate is unchanged", async () => {
    const governance = require("../../src/modules/ai/governance/governance.service");
    const assistantOn = await governance.isFeatureEnabled(c, "ai.assistant.backend");
    const own = await governance.canUseFeature(c, { userId: null, featureKey: "ai.dictionary_posting" });
    expect(own.allowed).toBe(true);
    // Every other key still answers to the assistant's switch, exactly as before.
    const mail = await governance.canUseFeature(c, { userId: null, featureKey: "mail_ai" });
    expect(mail.allowed).toBe(assistantOn);
    expect(governance.tenantSwitchFor("mail_ai")).toBe("ai.assistant.backend");
  });

  test("fresh search → existing accounts, sources, ledger at the model's own price; the same label again costs nothing", async () => {
    const engine = require("../../src/services/ai/dictionary-posting/engine.service");
    axios.post.mockResolvedValueOnce(grounded({
      direction: "EXPENSE", is_disbursement: false, vat_treatment: "STANDARD",
      postings: [{ context: "purchase", debit: "6131", credit: "4011" }],
      confidence: "high", sources_agree: true, rationale: "Google's own words about transport charges.",
    }));
    await c.query("BEGIN");
    try {
      const first = await engine.suggest(c, { label_fr: LABEL, label_en: LABEL, category: "overhead", direction: "EXPENSE" });
      expect(first.source).toBe("search");
      expect(first.model).toBe("gemini-3.1-pro");
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(axios.post.mock.calls[0][0]).toMatch(/models\/gemini-3\.1-pro:generateContent$/);
      expect(axios.post.mock.calls[0][1].tools).toEqual([{ google_search: {} }]);
      // Only the label, the category and the direction left the tenant.
      const sent = JSON.stringify(axios.post.mock.calls[0][1]);
      expect(sent).toMatch(new RegExp(LABEL));
      expect(sent).not.toMatch(/ecba|CITEST|CI Test/);

      const { rows: accounts } = await c.query("SELECT code::text AS code FROM chart_of_accounts WHERE is_postable");
      const codes = new Set(accounts.map((a) => a.code));
      for (const r of first.rules) {
        if (r.debit_account) expect(codes.has(r.debit_account)).toBe(true);
        if (r.credit_account) expect(codes.has(r.credit_account)).toBe(true);
      }
      expect(first.sources).toEqual([{ title: "Plan comptable SYSCOHADA", uri: "https://example.org/ohada" }]);
      expect(first.search_suggestion_html).toMatch(/chip/);
      expect(["high", "medium", "low"]).toContain(first.confidence);

      const { rows: ledger } = await c.query(
        "SELECT call_type, model, cost_native::float AS cost, cost_native_currency, input_tokens, output_tokens FROM ai_usage_ledger WHERE feature_key = 'ai.dictionary_posting' ORDER BY usage_id DESC LIMIT 2",
      );
      const gen = ledger.find((l) => l.call_type === "grounded_generate");
      const search = ledger.find((l) => l.call_type === "google_search");
      // Gemini 3.x: $2 / $12 per 1M tokens; thinking tokens bill as output.
      expect(gen).toMatchObject({ model: "gemini-3.1-pro", input_tokens: 500, output_tokens: 300, cost_native_currency: "USD" });
      expect(gen.cost).toBeCloseTo((500 * 2 + 300 * 12) / 1e6, 6);
      expect(search.cost).toBeCloseTo(14 / 1000, 6);

      // The shared cache holds our structured answer — not Google's text.
      const { rows: [entry] } = await platformDb.query("SELECT answer FROM platform.ai_posting_cache WHERE cache_entry_id = $1", [first.cache_entry_id]);
      expect(entry.answer).not.toHaveProperty("rationale");
      expect(JSON.stringify(entry.answer)).not.toMatch(/example\.org|chip/);

      // Asked again — as another tenant would — from the cache, with no call.
      const second = await engine.suggest(c, { label_fr: LABEL, label_en: `${LABEL} — Client Account`, category: "overhead", direction: "EXPENSE" });
      expect(second.source).toBe("cache");
      expect(second.cost.native).toBe(0);
      expect(axios.post).toHaveBeenCalledTimes(1);
    } finally {
      await c.query("ROLLBACK");
    }
  });

  test("a failed call gives the labelled local suggestion, and the line still saves", async () => {
    const engine = require("../../src/services/ai/dictionary-posting/engine.service");
    const service = require("../../src/modules/master/financial_dictionary/financial_dictionary.service");
    axios.post.mockRejectedValueOnce(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
    const label = `${LABEL} offline`;
    const sug = await engine.suggest(c, { label_fr: label, category: "disbursement", direction: "DISBURSEMENT", fresh: true });
    expect(sug.source).toBe("local");
    expect(sug.fallback_reason).toMatch(/Google could not be reached/);
    expect(sug.rules.length).toBeGreaterThan(0);
    // Suggested on EXISTING accounts, so the form saves as suggested.
    expect(sug.rules.every((r) => r.debit_account && r.credit_account)).toBe(true);

    const item = await service.create(c, {
      data: {
        label_fr: label, category: "disbursement", direction: "DISBURSEMENT",
        posting_rules: sug.rules.map((r) => ({ applies_context: r.applies_context, debit_account: r.debit_account, credit_account: r.credit_account, is_disbursement: r.is_disbursement })),
        posting_suggestion: {
          source: "local", model: null, cache_entry_id: null, confidence: sug.confidence, direction: sug.direction,
          suggested_rules: sug.rules.map((r) => ({ applies_context: r.applies_context, debit_account: r.debit_account, credit_account: r.credit_account })),
          checked: true,
        },
      },
      actor: { user_id: null },
    });
    try {
      expect(item.posting_rules.length).toBe(sug.rules.length);
      const { rows: [trail] } = await c.query(
        "SELECT after_json FROM immutable_ledger WHERE action = 'dictionary_item.posting_suggested' AND entity_ref = $1 ORDER BY ledger_id DESC LIMIT 1",
        [`dict:${item.code}`],
      );
      expect(trail.after_json).toMatchObject({ source: "local", outcome: "accepted", checked: true });
    } finally {
      // The line must never be left without a posting rule (KB §23.14), so it
      // goes whole: deleting the item cascades to its rules.
      await c.query("DELETE FROM dictionary_item WHERE dictionary_item_id = $1", [item.dictionary_item_id]);
    }
  });
});
