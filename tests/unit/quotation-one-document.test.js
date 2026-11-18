"use strict";
/**
 * Quotations absorb proposals, the pure parts (lean revamp PR 4, §3.4, §3.5).
 *
 *   rules       the link opens and answers only when it should; expiry is the
 *               end of the offer's last day; three working days skip weekends
 *   sections    a template is COPIED; Your Needs is prefilled from the request
 *               and discovery; an editor's save changes only what it names;
 *               Pricing cannot be switched off; automatic sections take no text
 *   templates   the leanest builder keeps only on/off and the three texts
 *   shared      the API and the editor accept the same shapes
 *   send        the covering mail carries the link and no em dash
 *   proposals   every write refused with the quotation it became; the public
 *               proposal link resolves through the quotation
 */
const rules = require("../../src/modules/commercial/quotation/quotation.rules");
const sections = require("../../src/modules/commercial/quotation/quotation.sections");
const templates = require("../../src/modules/commercial/quotation/quotation.templates");
const { mailBody, tokenHash, mintToken, linkUrl } = require("../../src/modules/commercial/quotation/quotation.send");
const { quotation: shared } = require("@praxis/shared");

const NOW = new Date("2026-11-17T12:00:00Z");

describe("the link", () => {
  const sent = { status: "SENT", share_token_hash: "h", share_expires_at: "2026-12-31T23:59:59Z", valid_until: "2026-11-30" };

  test("open while sent and in date; answerable until the last valid day", () => {
    expect(rules.linkState(sent, NOW)).toBe("OPEN");
    expect(rules.answerable(sent, NOW)).toBe(true);
    expect(rules.answerable({ ...sent, valid_until: "2026-11-17" }, NOW)).toBe(true);
    expect(rules.answerable({ ...sent, valid_until: "2026-11-16" }, NOW)).toBe(false);
  });

  test("revoked, expired, never minted and draft links do not open", () => {
    expect(rules.linkState({ ...sent, share_revoked_at: "2026-11-10" }, NOW)).toBe("REVOKED");
    expect(rules.linkState({ ...sent, share_expires_at: "2026-11-01T00:00:00Z" }, NOW)).toBe("EXPIRED");
    expect(rules.linkState({ ...sent, share_token_hash: null }, NOW)).toBe("CLOSED");
    expect(rules.linkState({ ...sent, status: "DRAFT" }, NOW)).toBe("CLOSED");
  });

  test("an answered quotation still READS on its link, but cannot be answered again", () => {
    const accepted = { ...sent, status: "ACCEPTED" };
    expect(rules.linkState(accepted, NOW)).toBe("OPEN");
    expect(rules.answerable(accepted, NOW)).toBe(false);
  });

  test("the link lasts until the end of the offer's last day", () => {
    expect(rules.shareExpiry("2026-11-30").toISOString()).toBe("2026-11-30T23:59:59.999Z");
    expect(rules.shareExpiry(null, NOW).toISOString()).toBe("2026-12-17T12:00:00.000Z");
  });

  test("a token is 32 random bytes, kept only as its sha256", () => {
    const t = mintToken();
    expect(Buffer.from(t, "base64url")).toHaveLength(32);
    expect(tokenHash(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash(t)).not.toContain(t);
    expect(linkUrl("https://smartls.cm", "abc")).toBe("https://smartls.cm/q/abc");
  });

  test("Follow up quotation is three WORKING days out", () => {
    // Friday → Wednesday.
    expect(rules.workingDaysFrom(new Date("2026-11-20T15:00:00Z"), 3).toISOString()).toBe("2026-11-25T09:00:00.000Z");
    // Tuesday → Friday.
    expect(rules.workingDaysFrom(new Date("2026-11-17T15:00:00Z"), 3).toISOString()).toBe("2026-11-20T09:00:00.000Z");
  });

  test("a quotation is for someone", () => {
    expect(() => rules.assertParty({ client_id: null, lead_id: null })).toThrow(expect.objectContaining({ code: "QUOTATION_PARTY_REQUIRED" }));
    expect(rules.assertParty({ client_id: null, lead_id: "l1" })).toBeUndefined();
  });
});

describe("sections", () => {
  const template = {
    sections: {
      about_us: { enabled: false },
      solution: { enabled: true, body_en: "One team.", body_fr: "Une équipe." },
      scope: { enabled: true, body_en: "Listed services.", body_fr: "Prestations listées." },
      terms: { body_en: "Valid 30 days." },
      cover: { body_en: "ignored, cover is automatic" },
    },
  };
  const request = { origin_location: "Douala", destination_location: "N'Djamena", incoterm: "FOB", cargo_description: "Cement", estimated_weight: 24000 };
  const discovery = { sections: [{ section_key: "OPERATIONS", body: "Two boxes a month." }, { section_key: "STRATEGY", body: "Rail to Ngaoundéré." }] };

  test("a new quotation gets all nine, in the library's order, copied from the template", () => {
    const rows = sections.fromTemplate(template, { request, discovery, serviceName: "Sea Freight" });
    expect(rows.map((r) => r.section_key)).toEqual(shared.SECTION_KEYS);
    expect(rows.find((r) => r.section_key === "about_us").enabled).toBe(false);
    expect(rows.find((r) => r.section_key === "scope").body_en).toBe("Listed services.");
    expect(rows.find((r) => r.section_key === "cover").body_en).toBeNull();
  });

  test("Your Needs reads the request and discovery; Our Solution adds the strategy", () => {
    const rows = sections.fromTemplate(template, { request, discovery, serviceName: "Sea Freight" });
    const needs = rows.find((r) => r.section_key === "needs");
    expect(needs.body_en).toContain("Route: Douala to N'Djamena");
    expect(needs.body_en).toContain("Weight: 24000 kg");
    expect(needs.body_en).toContain("Two boxes a month.");
    expect(needs.body_fr).toContain("Itinéraire : Douala vers N'Djamena");
    const solution = rows.find((r) => r.section_key === "solution");
    expect(solution.body_en).toBe("Rail to Ngaoundéré.\n\nOne team.");
  });

  test("an Incoterm the client did not know is not printed", () => {
    expect(sections.needsText({ request: { incoterm: "NOT_SURE" } }, "EN")).toBeNull();
  });

  test("a save changes only what it names", () => {
    const rows = sections.fromTemplate(template, {});
    const merged = sections.merge(rows, [{ section_key: "scope", body_fr: "Nouveau" }, { section_key: "about_us", enabled: true }]);
    const scope = merged.find((r) => r.section_key === "scope");
    expect(scope.body_en).toBe("Listed services.");
    expect(scope.body_fr).toBe("Nouveau");
    expect(merged.find((r) => r.section_key === "about_us").enabled).toBe(true);
  });

  test("Pricing cannot be switched off and an automatic section takes no text", () => {
    expect(() => sections.merge([], [{ section_key: "pricing", enabled: false }])).toThrow(expect.objectContaining({ code: "PRICING_ALWAYS_ON" }));
    expect(() => sections.merge([], [{ section_key: "cover", body_en: "x" }])).toThrow(expect.objectContaining({ code: "SECTION_AUTOMATIC" }));
  });

  test("Case Stories keeps at most three stories", () => {
    const merged = sections.merge([], [{ section_key: "case_stories", story_ids: ["a", "b", "c", "d", "a"] }]);
    expect(merged[0].story_ids).toEqual(["a", "b", "c"]);
  });
});

describe("the leanest template builder (D8)", () => {
  test("every key on or off, words only on Our Solution, Scope and Terms, Pricing always on", () => {
    const out = templates.normaliseSections({ pricing: { enabled: false }, terms: { body_fr: "Conditions." }, needs: { enabled: false } });
    expect(Object.keys(out)).toEqual(shared.SECTION_KEYS);
    expect(out.pricing.enabled).toBe(true);
    expect(out.needs.enabled).toBe(false);
    expect(out.terms).toEqual({ enabled: true, body_fr: "Conditions." });
    expect(() => templates.normaliseSections({ needs: { body_en: "x" } })).toThrow(expect.objectContaining({ code: "SECTION_AUTOMATIC" }));
  });
});

describe("one shape for the API and the editor (@praxis/shared)", () => {
  test("Send needs a recipient and a subject; output and language are the vocabularies", () => {
    expect(shared.send.safeParse({ to: "a@b.cm", subject: "Offer", output: "EXTRACT", language: "FR", cc: ["c@d.cm"] }).success).toBe(true);
    expect(shared.send.safeParse({ to: "nope", subject: "Offer" }).success).toBe(false);
    expect(shared.send.safeParse({ to: "a@b.cm", subject: "" }).success).toBe(false);
    expect(shared.send.safeParse({ to: "a@b.cm", subject: "x", output: "SUMMARY" }).success).toBe(false);
  });

  test("sections: known keys, once each, Pricing on", () => {
    expect(shared.sections.safeParse([{ section_key: "needs", body_en: "x" }]).success).toBe(true);
    expect(shared.sections.safeParse([{ section_key: "needs" }, { section_key: "needs" }]).success).toBe(false);
    expect(shared.sections.safeParse([{ section_key: "pricing", enabled: false }]).success).toBe(false);
    expect(shared.sections.safeParse([{ section_key: "appendix" }]).success).toBe(false);
  });

  test("accepting on the link: a six-digit code and a stamp or a drawn mark", () => {
    expect(shared.linkAcceptComplete.safeParse({ code: "123456", preset_code: "DRAWN", full_name: "Awa Ndiaye" }).success).toBe(true);
    expect(shared.linkAcceptComplete.safeParse({ code: "12345", preset_code: "DRAWN", full_name: "Awa Ndiaye" }).success).toBe(false);
    expect(shared.linkAcceptComplete.safeParse({ code: "123456", preset_code: "QES", full_name: "Awa Ndiaye" }).success).toBe(false);
  });

  test("a template names itself and keeps the library's keys", () => {
    expect(shared.template.safeParse({ name: "Sea", sections: { solution: { body_en: "x" } } }).success).toBe(true);
    expect(shared.template.safeParse({ name: "Sea", sections: { appendix: {} } }).success).toBe(false);
    expect(shared.template.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("the covering mail", () => {
  test.each(["EN", "FR"])("carries the message, the link and no em dash (%s)", (language) => {
    const out = mailBody({ message: "Bonjour <Awa>\nVoici l'offre.", url: "https://x.cm/q/tok", language, number: "DEV-1" });
    expect(out.html).toContain('href="https://x.cm/q/tok"');
    expect(out.html).toContain("Bonjour &lt;Awa&gt;<br>");
    expect(out.text).toContain("https://x.cm/q/tok");
    expect(`${out.html}${out.text}`).not.toContain("—");
  });
});

describe("proposals are read only now", () => {
  const proposalService = require("../../src/modules/sales/proposal/proposal.service");
  const client = { query: jest.fn(async () => ({ rows: [{ quotation_id: "q-9" }] })) };

  test.each([
    ["createDraft", () => proposalService.createDraft(client, { data: {} })],
    ["updateDraft", () => proposalService.updateDraft(client, { id: "p1" })],
    ["transition", () => proposalService.transition(client, { id: "p1", to: "SENT" })],
    ["accept", () => proposalService.accept(client, { id: "p1" })],
    ["share", () => proposalService.share(client, { id: "p1" })],
    ["generate", () => proposalService.generate(client, { proposalId: "p1" })],
  ])("%s is refused with 410 and the quotation it became", async (_name, call) => {
    await expect(call()).rejects.toMatchObject({ code: "PROPOSAL_RETIRED", status: 410 });
  });

  test("the refusal names the migrated quotation", async () => {
    await expect(proposalService.accept(client, { id: "p1" })).rejects.toMatchObject({ details: { quotation_id: "q-9" } });
  });
});
