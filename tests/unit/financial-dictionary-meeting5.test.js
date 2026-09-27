"use strict";
/**
 * Tenant review "meeting 5" (21 Sep 2026) — the pure halves of the dictionary
 * changes. The database halves (standard rate, re-lettered codes, apply to
 * carriers) are in tests/integration/dictionary-standard-rate.test.js.
 */
const { titleCase } = require("../../src/modules/master/financial_dictionary/financial_dictionary.rules");
const { standardRateJoin, STANDARD_RATE_COLUMNS } = require("../../src/modules/master/expense_rate/standard-rate.sql");

describe("titleCase — every word of a catalogue label starts with a capital", () => {
  test.each([
    ["shipping line charges", "Shipping Line Charges"],
    ["frais de dossier", "Frais De Dossier"],
    // Only the first letter moves: acronyms survive, unlike initcap().
    ["THC per box", "THC Per Box"],
    ["IT equipment & hardware", "IT Equipment & Hardware"],
    ["air waybill (awb) fee", "Air Waybill (Awb) Fee"],
    // A hyphen, a slash and a bracket start a word; an apostrophe does not.
    ["last-mile / port exit", "Last-Mile / Port Exit"],
    ["frais d'agence", "Frais D'agence"],
    ["écrou", "Écrou"],
  ])("%s → %s", (input, out) => expect(titleCase(input)).toBe(out));

  test("already title case is a no-op, and a missing label stays missing", () => {
    expect(titleCase("Documentation Fee")).toBe("Documentation Fee");
    expect(titleCase(null)).toBeNull();
    expect(titleCase(undefined)).toBeUndefined();
  });
});

describe("the standard rate SQL — one definition for every reader", () => {
  test("joins the no-carrier, no-container-type rate in force today", () => {
    const sql = standardRateJoin("di");
    expect(sql).toMatch(/er\.dictionary_item_id = di\.dictionary_item_id/);
    expect(sql).toMatch(/rate_provider_id IS NULL/);
    expect(sql).toMatch(/container_type_ref_id IS NULL/);
    expect(sql).toMatch(/effective_from <= CURRENT_DATE/);
    expect(STANDARD_RATE_COLUMNS).toMatch(/sr\.rate AS default_price\b/);
  });

  test("refuses an alias that is not a bare identifier", () => {
    expect(() => standardRateJoin("di; DROP TABLE x")).toThrow(/bad alias/);
  });
});
