"use strict";
/**
 * One quotation, printed two ways (lean revamp §3.4, §5.7; owner decision D6).
 *
 *   1. Full Proposal and Commercial Extract print the SAME numbers: every line
 *      amount and every total of one record appears identically in both, so
 *      the switch changes which sections print and never a figure.
 *   2. The Extract is the letterhead cover, Pricing, Terms and Next Steps; the
 *      Full Proposal adds what is switched on, and drops what is switched off.
 *   3. One language per sheet: EN chrome in Title Case, FR in sentence case,
 *      the section's words in that language (falling back to the other one).
 *   4. Dates are day-first, and nothing a client reads carries an em dash.
 */
const registry = require("../../src/services/documents/templates/registry");
const doc = require("../../src/services/documents/templates/quotation-document");
const rules = require("../../src/modules/commercial/quotation/quotation.rules");

const entity = { legal_name: "Smart Logistics SARL", address: "Douala", niu: "M0123" };
const cfg = (language) => ({ language, show: { signature: true } });

const record = (output) => ({
  number: "DEV-2026-0042",
  date: "2026-11-03T10:00:00.000Z",
  valid_until: "2026-12-03",
  currency: "XAF",
  output,
  title: "Sea freight, Douala to N'Djamena",
  version: 2,
  party: { name: "CIMENCAM SA", lines: ["NIU P0123"] },
  payment_terms_days: 30,
  lines: [
    { label: "Ocean freight 40ft", qty: 2, unit: 450000, tax: 19.25, tax_rate: 19.25, amount: 900000, client_heading_code: "FREIGHT", client_heading_en: "Freight", client_heading_fr: "Fret", client_heading_sort: 10 },
    { label: "Port handling", qty: 1, unit: 185500, tax: 19.25, tax_rate: 19.25, amount: 185500, client_heading_code: "PORT", client_heading_en: "Port", client_heading_fr: "Port", client_heading_sort: 20 },
    { label: "Customs duties (advance)", qty: 1, unit: 320000, tax: 19.25, tax_rate: null, amount: 320000, is_disbursement: true, client_heading_code: "CUSTOMS", client_heading_en: "Customs", client_heading_fr: "Douane", client_heading_sort: 5 },
  ],
  client_headings: [],
  totals: { service_ht: 1405500, vat_total: 208983.75, total_ttc: 1614483.75 },
  sections: [
    { section_key: "cover", enabled: true },
    { section_key: "needs", enabled: true, body_en: "Two boxes a month, cleared in Douala.", body_fr: "Deux conteneurs par mois, dédouanés à Douala." },
    { section_key: "solution", enabled: true, body_en: "One team from port to door.", body_fr: null },
    { section_key: "scope", enabled: false, body_en: "Hidden scope text", body_fr: "Périmètre masqué" },
    { section_key: "pricing", enabled: true },
    { section_key: "terms", enabled: true, body_en: "Disbursements at cost.", body_fr: "Débours au coût réel." },
    { section_key: "next_steps", enabled: true },
  ],
  contact: { name: "Awa Ndiaye", email: "awa@example.com", phone: null },
});

/** What a reader sees: the markup without its stylesheets and comments. */
const visible = (h) => h.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ");
const html = (output, language = "en") => registry.get("QUOTATION").build(record(output), cfg(language), entity, null);

/** Every money figure on the page, in order of appearance. */
const figures = (h) => (h.match(/\d[\d\u202f\u00a0 ]*(?:,\d+)? XAF/g) || []).map((s) => s.replace(/\s/g, ""));
const pricingBlock = (h) => h.slice(h.indexOf('class="q-pricing"'), h.indexOf("</table>", h.indexOf('class="totals"')));

describe("Full Proposal and Commercial Extract print the same numbers", () => {
  test.each(["en", "fr"])("every line and total is identical (%s)", (language) => {
    const full = html("FULL", language);
    const extract = html("EXTRACT", language);
    expect(figures(pricingBlock(full))).toEqual(figures(pricingBlock(extract)));
    expect(figures(pricingBlock(full)).length).toBeGreaterThanOrEqual(6);
    // And they are the record's own figures, nothing recomputed.
    expect(figures(full)).toContain("1614483,75XAF");
    expect(figures(extract)).toContain("1614483,75XAF");
  });

  test("the pricing rows are built once, from the record", () => {
    const a = doc.pricing(record("FULL"), cfg("en"));
    const b = doc.pricing(record("EXTRACT"), cfg("en"));
    expect(a).toEqual(b);
  });
});

describe("the switch decides which sections print", () => {
  test("Extract: cover, pricing, terms and next steps only", () => {
    const h = html("EXTRACT");
    expect(h).toContain("Pricing");
    expect(h).toContain("Terms");
    expect(h).toContain("Next Steps");
    expect(h).not.toContain("Your Needs");
    expect(h).not.toContain("Our Solution");
    expect(h).not.toContain("Sea freight, Douala"); // the Full cover's title
    expect(rules.printedKeys("EXTRACT", record("EXTRACT").sections)).toEqual(["cover", "pricing", "terms", "next_steps"]);
  });

  test("Full: what is switched on, never what is switched off", () => {
    const h = html("FULL");
    expect(h).toContain("Your Needs");
    expect(h).toContain("Two boxes a month");
    expect(h).toContain("Our Solution");
    expect(h).not.toContain("Hidden scope text");
    expect(h).toContain("Sea freight, Douala");
  });

  test("Pricing cannot be switched off", () => {
    expect(rules.printedKeys("FULL", [{ section_key: "pricing", enabled: false }])).toContain("pricing");
  });

  test("the title names the output (D6)", () => {
    expect(html("FULL")).toContain("Proposal");
    expect(html("EXTRACT")).toContain("Quotation");
    expect(html("FULL", "fr")).toContain("Proposition commerciale");
    expect(html("EXTRACT", "fr")).toContain("Devis");
  });
});

describe("one language per sheet", () => {
  test("French sheet: sentence-case chrome, French words, English where only English was written", () => {
    const h = html("FULL", "fr");
    expect(h).toContain("Vos besoins");
    expect(h).toContain("Deux conteneurs par mois");
    expect(h).not.toContain("Two boxes a month");
    // Our Solution was written in English only: it prints rather than vanishing.
    expect(h).toContain("Notre solution");
    expect(h).toContain("One team from port to door.");
    expect(h).not.toContain("Your Needs");
  });

  test("a bilingual quotation offers both; a single-language one only its own", () => {
    expect(rules.languagesOf({ language: "BILINGUAL" })).toEqual(["EN", "FR"]);
    expect(rules.languagesOf({ language: null })).toEqual(["EN", "FR"]);
    expect(rules.languagesOf({ language: "FR" })).toEqual(["FR"]);
    expect(rules.pickLanguage({ language: "FR" }, "EN")).toBe("FR");
    expect(rules.pickLanguage({ language: "BILINGUAL" }, "fr")).toBe("FR");
  });
});

describe("what a client reads", () => {
  test.each([["FULL", "en"], ["FULL", "fr"], ["EXTRACT", "en"], ["EXTRACT", "fr"]])("%s %s: day-first dates, no em dash", (output, language) => {
    const h = html(output, language);
    expect(h).toContain("03/11/2026");
    expect(h).toContain("03/12/2026");
    expect(h).not.toMatch(/2026-11-03|2026-12-03/);
    expect(visible(h)).not.toContain("—");
  });

  test("the sample record renders, for the Document Studio", () => {
    const t = registry.get("QUOTATION");
    const h = t.build(t.sampleData, cfg("en"), entity, null);
    expect(h).toContain("Pricing");
    expect(visible(h)).not.toContain("—");
  });
});
