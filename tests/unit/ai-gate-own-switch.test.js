"use strict";

/**
 * Meeting 6, F7 — `ai.dictionary_posting` has its own gate.
 *
 * canUseFeature used to check the ASSISTANT's tenant switch
 * (`ai.assistant.backend`) whatever key it was given. The dictionary's OHADA
 * posting suggestion is on for every tenant and must work with the assistant
 * off — and switching it off must not switch the assistant off. Every OTHER
 * key must behave exactly as before; that is what the second half pins.
 */
jest.mock("../../src/modules/ai/governance/governance.repo", () => ({
  featureStateOn: jest.fn(),
  getFlag: jest.fn(async () => null),
  grantFor: jest.fn(async () => null),
  activeBudget: jest.fn(async () => null),
  spentInPeriod: jest.fn(async () => 0),
}));
jest.mock("../../src/services/platform/entitlement.service", () => ({ guard: jest.fn(async () => true) }));
jest.mock("../../src/services/tenant/registry.service", () => ({ tenantIdOf: () => "t1" }));

const repo = require("../../src/modules/ai/governance/governance.repo");
const governance = require("../../src/modules/ai/governance/governance.service");
const rules = require("../../src/modules/master/financial_dictionary/financial_dictionary.rules");

/** The assistant is OFF on this tenant; the posting feature is ON. */
const tenant = { "ai.assistant.backend": false, "ai.dictionary_posting": true };

beforeEach(() => {
  repo.featureStateOn.mockImplementation(async (_c, key) => tenant[key] === true);
});

describe("canUseFeature — whose switch", () => {
  it("ai.dictionary_posting answers to its own switch: allowed with the assistant off", async () => {
    const out = await governance.canUseFeature({}, { userId: null, featureKey: "ai.dictionary_posting" });
    expect(out.allowed).toBe(true);
    expect(repo.featureStateOn).toHaveBeenCalledWith({}, "ai.dictionary_posting");
  });

  it("…and turning it off does not touch the assistant", async () => {
    tenant["ai.dictionary_posting"] = false;
    tenant["ai.assistant.backend"] = true;
    try {
      expect((await governance.canUseFeature({}, { userId: null, featureKey: "ai.dictionary_posting" })).allowed).toBe(false);
      expect((await governance.canUseFeature({}, { userId: null, featureKey: "assistant" })).allowed).toBe(true);
    } finally {
      tenant["ai.dictionary_posting"] = true;
      tenant["ai.assistant.backend"] = false;
    }
  });

  it.each(["assistant", "mail_ai", "ai.vision", "transcription", "anything-else"])(
    "every other key (%s) still answers to ai.assistant.backend, exactly as before",
    async (featureKey) => {
      const out = await governance.canUseFeature({}, { userId: null, featureKey });
      expect(out.allowed).toBe(false);
      expect(out.reason).toBe("feature disabled for this tenant");
      expect(repo.featureStateOn).toHaveBeenLastCalledWith({}, "ai.assistant.backend");
      expect(governance.tenantSwitchFor(featureKey)).toBe("ai.assistant.backend");
    },
  );

  it("the per-user grant still applies to the posting feature", async () => {
    repo.grantFor.mockResolvedValueOnce({ revoked_at: "2026-10-01T00:00:00Z" });
    const out = await governance.canUseFeature({}, { userId: "u1", featureKey: "ai.dictionary_posting" });
    expect(out.allowed).toBe(false);
    expect(out.reason).toMatch(/no active access grant/);
  });
});

describe("an import row without a posting (F8)", () => {
  const lookups = { accounts: new Set(["6131", "4011"]), taxCodes: new Map(), serviceTypes: new Map() };
  const raw = { label_fr: "Essai", category: "overhead", direction: "EXPENSE" };

  it("is no longer rejected for that alone when the import may suggest one", () => {
    const out = rules.validateImportRow(raw, { ...lookups, allowMissingPosting: true });
    expect(out.valid).toBe(true);
    expect(out.data.needs_posting).toBe(true);
  });

  it("is still rejected where nothing will suggest one", () => {
    expect(rules.validateImportRow(raw, lookups).valid).toBe(false);
  });

  it("a posting the sheet got wrong is still a reason, not a suggestion", () => {
    const out = rules.validateImportRow({ ...raw, purchase_debit: "9999", purchase_credit: "4011" }, { ...lookups, allowMissingPosting: true });
    expect(out.valid).toBe(false);
  });
});
