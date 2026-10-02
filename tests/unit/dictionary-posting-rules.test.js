"use strict";

/**
 * Meeting 6, PR 3 — section C, the pure half (F3 / F7).
 *
 *   - the question's identity: the cache key strips accents, punctuation and
 *     the sibling suffixes, so every mode of a service shares one answer;
 *   - the model: the strongest GENERALLY AVAILABLE Gemini Pro with grounding,
 *     never a preview;
 *   - the reply: strict, so an answer that does not parse is a failure;
 *   - the cost: the model's own prices plus the search fee;
 *   - the mapping onto THIS tenant's chart: never an invented account;
 *   - the local suggestion: the tenant's own lines, else the OHADA KB.
 */
const rules = require("../../src/services/ai/dictionary-posting/posting.rules");
const { chooseFromList } = require("../../src/services/ai/dictionary-posting/model.service");

describe("the question's identity", () => {
  it("normalises the label: accents, punctuation, spaces and the sibling suffix", () => {
    expect(rules.normaliseLabel("Gate-Pass Fee — Client Account")).toBe("gate pass fee");
    expect(rules.normaliseLabel("  Frais  d'Escale — Charge Propre")).toBe("frais d escale");
    expect(rules.normaliseLabel("Dépôt de garantie")).toBe("depot de garantie");
  });

  it("keys on label, category and direction ('*' when not chosen)", () => {
    expect(rules.cacheKey({ label_en: "Gate-Pass Fee", label_fr: "Ticket", category: "overhead" })).toBe("gate pass fee|overhead|*");
    expect(rules.cacheKey({ label_en: "Gate-Pass Fee — Own Cost", label_fr: "x", category: "overhead", direction: "EXPENSE" })).toBe("gate pass fee|overhead|EXPENSE");
    expect(rules.cacheKey({ label_fr: "Frais de dossier", category: "service" })).toBe("frais de dossier|service|*");
  });

  it("the prompt carries the label, category and direction — and nothing about the tenant", () => {
    const p = rules.buildPrompt({ label_en: "Gate-Pass Fee", label_fr: "Saisie du ticket", category: "overhead", direction: "EXPENSE" });
    expect(p).toMatch(/"Gate-Pass Fee"/);
    expect(p).toMatch(/Category: overhead/);
    expect(p).toMatch(/direction is fixed: EXPENSE/);
    expect(p).not.toMatch(/XAF|client name|dossier/i);
  });
});

describe("the model is chosen automatically", () => {
  const m = (name, methods = ["generateContent"]) => ({ name: `models/${name}`, supportedGenerationMethods: methods });

  it("the strongest GA Pro model with grounding wins; previews and experiments never do", () => {
    expect(
      chooseFromList([
        m("gemini-2.5-pro"),
        m("gemini-3.1-pro"),
        m("gemini-3.5-pro-preview-06-01"),
        m("gemini-3-pro-exp"),
        m("gemini-3.5-flash"),
        m("gemini-1.5-pro"),
      ]),
    ).toBe("gemini-3.1-pro");
  });

  it("prefers the plain alias over a dated build of the same version", () => {
    expect(chooseFromList([m("gemini-2.5-pro-002"), m("gemini-2.5-pro")])).toBe("gemini-2.5-pro");
  });

  it("refuses a model that cannot generate content, and a pre-grounding generation", () => {
    expect(chooseFromList([m("gemini-3-pro", ["embedContent"]), m("gemini-1.5-pro")])).toBeNull();
  });
});

describe("the reply is read strictly", () => {
  const reply = (text, extra = {}) => ({
    candidates: [{
      content: { parts: [{ text }] },
      groundingMetadata: {
        webSearchQueries: ["syscohada ticket de sortie port compte"],
        searchEntryPoint: { renderedContent: "<div class=\"chip\">ticket</div>" },
        groundingChunks: [{ web: { uri: "https://example.org/syscohada", title: "SYSCOHADA révisé" } }, { web: { uri: "https://example.org/syscohada", title: "dup" } }],
      },
      ...extra,
    }],
    usageMetadata: { promptTokenCount: 400, candidatesTokenCount: 150, thoughtsTokenCount: 50 },
  });
  const good = JSON.stringify({
    direction: "EXPENSE", is_disbursement: false, vat_treatment: "STANDARD",
    postings: [{ context: "purchase", debit: "6131", credit: "4011" }],
    confidence: "high", sources_agree: true, rationale: "Charges de transport.",
  });

  it("takes the answer, the sources, the Search Suggestions and the usage", () => {
    const out = rules.parseGrounded(reply("```json\n" + good + "\n```"));
    expect(out.answer.postings[0]).toEqual({ context: "purchase", debit: "6131", credit: "4011" });
    expect(out.sources).toEqual([{ title: "SYSCOHADA révisé", uri: "https://example.org/syscohada" }]);
    expect(out.search_suggestion_html).toMatch(/chip/);
    expect(out.queries).toBe(1);
    expect(out.usage).toEqual({ input_tokens: 400, output_tokens: 200 }); // thinking bills as output
  });

  it("an answer that does not parse is a failure, never half-applied", () => {
    expect(() => rules.parseGrounded(reply("I think it is 6131."))).toThrow(expect.objectContaining({ code: "UNPARSEABLE" }));
    const disbWithVat = JSON.stringify({ direction: "DISBURSEMENT", is_disbursement: true, vat_treatment: "STANDARD", postings: [{ context: "sale", debit: "4111", credit: "4731" }], confidence: "high" });
    expect(() => rules.parseGrounded(reply(disbWithVat))).toThrow(expect.objectContaining({ code: "UNPARSEABLE" }));
    expect(() => rules.parseGrounded({ promptFeedback: { blockReason: "SAFETY" } })).toThrow(expect.objectContaining({ code: "BLOCKED" }));
  });

  it("only our structured answer is cacheable — Google's rationale is dropped", () => {
    const out = rules.parseGrounded(reply(good));
    expect(rules.cacheable(out.answer)).not.toHaveProperty("rationale");
  });
});

describe("the cost is the model's own, plus the search fee", () => {
  const prices = [
    { model_prefix: "gemini-3", input_per_1m: 2, output_per_1m: 12, search_fee: 14, search_fee_per: 1000, search_unit: "query", currency: "USD" },
    { model_prefix: "gemini-2.5-pro", input_per_1m: 1.25, output_per_1m: 10, search_fee: 35, search_fee_per: 1000, search_unit: "prompt", currency: "USD" },
    { model_prefix: "*", input_per_1m: 2, output_per_1m: 12, search_fee: 14, search_fee_per: 1000, search_unit: "query", currency: "USD" },
  ];

  it("Gemini 3.x is priced per search query", () => {
    const p = rules.priceFor(prices, "gemini-3.1-pro");
    expect(p.model_prefix).toBe("gemini-3");
    const c = rules.priceCall(p, { input_tokens: 1_000_000, output_tokens: 100_000, queries: 2, grounded: true });
    expect(c.tokens).toBe(3.2);
    expect(c.search).toBe(0.028);
  });

  it("Gemini 2.5 Pro is priced per grounded prompt, whatever the query count", () => {
    const c = rules.priceCall(rules.priceFor(prices, "gemini-2.5-pro"), { input_tokens: 0, output_tokens: 0, queries: 3, grounded: true });
    expect(c.search).toBe(0.035);
  });

  it("an unpriced model takes the conservative default", () => {
    expect(rules.priceFor(prices, "gemini-9-ultra").model_prefix).toBe("*");
  });
});

describe("mapping onto THIS tenant's chart", () => {
  const accounts = [
    { code: "4011", is_postable: true },
    { code: "4111", is_postable: true },
    { code: "706", is_postable: false, label_fr: "Services vendus" },
    { code: "7061", is_postable: true },
    { code: "613", is_postable: true },
    { code: "61", is_postable: false },
  ];
  const taxCodes = [{ tax_code_id: "t-std", code: "TVA_STD" }, { tax_code_id: "t-in", code: "TVA_INPUT_PURCH" }];

  it("exact, else the nearest postable leaf under it, else a mint proposal — never invented", () => {
    expect(rules.mapAccount("4011", accounts)).toEqual({ suggested: "4011", account: "4011", how: "exact" });
    expect(rules.mapAccount("706", accounts)).toEqual({ suggested: "706", account: "7061", how: "child" });
    expect(rules.mapAccount("6131", accounts)).toEqual({ suggested: "6131", account: null, how: "mint", mint: { code: "6131", parent_code: "613", label_fr: null } });
  });

  test("a party control account maps to itself even once it has auxiliary children", () => {
    // After the first client is activated, 4111 is a non-postable parent of
    // that client's 41110001. A dictionary line's 4111 means "this invoice's
    // client" — never one client's own account.
    const chart = [
      { code: "4111", is_postable: false },
      { code: "41110001", is_postable: true },
      { code: "4011", is_postable: false },
      { code: "40110001", is_postable: true },
    ];
    expect(rules.mapAccount("4111", chart)).toEqual({ suggested: "4111", account: "4111", how: "exact" });
    expect(rules.mapAccount("4011", chart)).toEqual({ suggested: "4011", account: "4011", how: "exact" });
  });

  test("the control accounts are exactly party-accounting's", () => {
    const { PARTY } = require("../../src/modules/master/party-accounting.service");
    expect([...rules.PARTY_CONTROL_ACCOUNTS].sort()).toEqual(Object.values(PARTY).map((p) => p.parent).sort());
  });

  it("lowers the confidence when an account is mapped to a leaf or minted, or the sources disagree", () => {
    const answer = { direction: "REVENUE", is_disbursement: false, vat_treatment: "STANDARD", postings: [{ context: "sale", debit: "4111", credit: "706" }], confidence: "high" };
    const out = rules.mapToTenant(answer, { accounts, taxCodes });
    expect(out.rules[0]).toMatchObject({ applies_context: "sale", debit_account: "4111", credit_account: "7061", tax_code_id: "t-std", is_disbursement: false });
    expect(out.confidence).toBe("medium");
    const disagree = rules.mapToTenant({ ...answer, postings: [{ context: "sale", debit: "4111", credit: "7061" }], sources_agree: false }, { accounts, taxCodes });
    expect(disagree.confidence).toBe("medium");
    const minted = rules.mapToTenant({ ...answer, direction: "EXPENSE", postings: [{ context: "purchase", debit: "6131", credit: "4011" }] }, { accounts, taxCodes });
    expect(minted.needs_mint).toBe(true);
    expect(minted.rules[0].debit_account).toBeNull();
  });

  it("a débours carries no tax code", () => {
    const out = rules.mapToTenant(
      { direction: "DISBURSEMENT", is_disbursement: true, vat_treatment: "DISBURSEMENT", postings: [{ context: "sale", debit: "4111", credit: "4011" }], confidence: "high" },
      { accounts, taxCodes },
    );
    expect(out.rules[0].tax_code_id).toBeNull();
    expect(out.rules[0].is_disbursement).toBe(true);
  });
});

describe("the local suggestion — without a web search", () => {
  it("posts like the tenant's own most similar audited line", () => {
    const out = rules.localSuggestion({
      category: "overhead",
      direction: "EXPENSE",
      similar: [{ code: "#E013", label: "Gate-Pass Fee", direction: "EXPENSE", is_disbursement: false, taxed: true, similarity: 0.7, rules: [{ applies_context: "purchase", debit_account: "6271", credit_account: "4011" }] }],
    });
    expect(out.basis).toMatchObject({ kind: "tenant_line", code: "#E013" });
    expect(out.answer.postings).toEqual([{ context: "purchase", debit: "6271", credit: "4011" }]);
    expect(out.answer.confidence).toBe("medium");
  });

  it("falls back to the OHADA KB default for the direction — a débours through 4731", () => {
    const out = rules.localSuggestion({ category: "disbursement", similar: [] });
    expect(out.basis).toMatchObject({ kind: "ohada_kb" });
    expect(out.answer.direction).toBe("DISBURSEMENT");
    expect(out.answer.postings).toEqual([
      { context: "purchase", debit: "4731", credit: "4011" },
      { context: "sale", debit: "4111", credit: "4731" },
    ]);
    expect(out.answer.confidence).toBe("low");
  });
});
