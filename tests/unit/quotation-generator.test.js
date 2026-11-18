"use strict";
/**
 * Draft With AI, moved from the proposal generator (lean revamp PR 4, §3.4,
 * §5.4): grounded in a closed list of numbered facts, or not written.
 */
const fs = require("fs");
const path = require("path");
const generator = require("../../src/modules/commercial/quotation/quotation.generator");

const valid = {
  needs_en: { body: "Two boxes a month." },
  needs_fr: { body: "Deux conteneurs par mois." },
  solution_en: { body: "Our fleet of 24 trucks.", fact_ids: ["F2"] },
  solution_fr: { body: "Notre flotte de 24 camions.", fact_ids: ["F2"] },
};

describe("Draft With AI", () => {
  test("builds a closed, numbered fact list", () => {
    const f = generator.facts({ slogan: "Beyond", fleet_count: 24, projects: [{ name_en: "Port", metrics: { teu: 20 } }] });
    expect(f.map((x) => x.id)).toEqual(["F1", "F2", "F3"]);
  });

  test("accepts the exact shape with citations it was given", () => {
    expect(generator.parse(JSON.stringify(valid), new Set(["F1", "F2"]))).toEqual(valid);
    expect(generator.parse("```json\n" + JSON.stringify(valid) + "\n```", new Set(["F2"]))).toEqual(valid);
  });

  test("refuses an invented citation, a malformed reply and an extra field", () => {
    expect(generator.parse(JSON.stringify({ ...valid, solution_en: { body: "x", fact_ids: ["F99"] } }), new Set(["F2"]))).toBeNull();
    expect(generator.parse("not json", new Set())).toBeNull();
    expect(generator.parse(JSON.stringify({ ...valid, price: 1 }), new Set(["F2"]))).toBeNull();
  });

  test("no cost or margin reaches the model", () => {
    expect(generator.safeValue({ teu: 20, cost_amount: 99, nested: { margin_pct: 4, days: 2 }, unit_price: 5 })).toEqual({ teu: 20, nested: { days: 2 } });
  });

  test("reads the three discovery headings, never a price, and calls no model in TEST", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../src/modules/commercial/quotation/quotation.generator.js"), "utf8");
    for (const key of ["OPERATIONS", "PAIN_POINTS", "STRATEGY"]) expect(src).toContain(`"${key}"`);
    expect(src).not.toMatch(/\b(cost_|margin_|unit_cost|purchase_price)\b/i);
    expect(src).toContain('env !== "live"');
    expect(src).toContain("attempt < 3");
  });
});
