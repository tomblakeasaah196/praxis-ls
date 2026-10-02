"use strict";

/**
 * Meeting 6, register 3.5 — "Where it operates" countries come from the ISO
 * list, an incomplete row is refused with a message, and stored rows that need
 * a person's eye are flagged (never rewritten).
 */
const { coverage, siteSettings } = require("@praxis/shared");

describe("coverage — what a complete row is", () => {
  test("only a real ISO 3166-1 alpha-2 code is a country", () => {
    expect(coverage.isCountryCode("GA")).toBe(true);
    expect(coverage.isCountryCode("ga")).toBe(true);
    expect(coverage.isCountryCode("XX")).toBe(false);
    expect(coverage.isCountryCode("GAB")).toBe(false);
    expect(coverage.isCountryCode("")).toBe(false);
  });

  test("a row needs a country and a label", () => {
    expect(coverage.rowProblems({ country_code: "CM", label_fr: "Douala" })).toEqual([]);
    expect(coverage.rowProblems({ country_code: "CM", label_en: "Douala" })).toEqual([]);
    expect(coverage.rowProblems({ country_code: "", label_fr: "Douala" })).toEqual(["Pick the country."]);
    expect(coverage.rowProblems({ country_code: "XX", label_fr: "Douala" })[0]).toMatch(/not a country code/);
    expect(coverage.rowProblems({ country_code: "CM", label_fr: " ", label_en: null })).toEqual([
      "Give the place a label, in French or English.",
    ]);
  });

  test("the API schema refuses what the tab refuses", () => {
    const parse = (rows) => siteSettings.entityPublicStory.safeParse({ public_coverage: rows });
    expect(parse([{ country_code: "ga", label_fr: "Libreville" }]).data.public_coverage[0].country_code).toBe("GA");
    const bad = parse([{ country_code: "XX", label_fr: "Nowhere" }, { country_code: "CM" }]);
    expect(bad.success).toBe(false);
    const paths = bad.error.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(["public_coverage.0.country_code", "public_coverage.1.label_fr"]);
  });
});

describe("coverage — flags on stored rows", () => {
  test("Libreville under GB is flagged as a place in Gabon", () => {
    const flags = coverage.flags([
      { country_code: "CM", label_fr: "Douala et le littoral", label_en: "Douala and the coast" },
      { country_code: "GB", label_fr: "Libreville", label_en: "Libreville" },
    ]);
    expect(flags).toEqual([
      expect.objectContaining({ index: 1, kind: "PLACE_ELSEWHERE", place: "Libreville", place_country: "GA" }),
    ]);
  });

  test("a code that is not a country is flagged", () => {
    expect(coverage.flags([{ country_code: "ZZ", label_fr: "Quelque part" }])).toEqual([
      expect.objectContaining({ index: 0, kind: "NOT_A_COUNTRY" }),
    ]);
  });

  test("names that legitimately overlap do not flag", () => {
    expect(
      coverage.flags([
        { country_code: "GA", label_fr: "Libreville, Gabon" },
        { country_code: "GQ", label_fr: "Guinée équatoriale — Malabo" }, // not "Guinée" (GN)
        { country_code: "NG", label_en: "Port Harcourt and the Niger Delta" }, // not Niger (NE)
        { country_code: "CM", label_fr: "Extrême-Nord, lac Tchad" }, // the lake is shared
        { country_code: "CD", label_fr: "Kinshasa, Congo" }, // "Congo" names both
        { country_code: "CG", label_fr: "Pointe-Noire (Congo)" },
        { country_code: "TD", label_fr: "N'Djamena" },
      ]),
    ).toEqual([]);
  });

  test("nothing is flagged for a place the list does not know", () => {
    expect(coverage.flags([{ country_code: "CM", label_fr: "Mbanga" }])).toEqual([]);
    expect(coverage.flags(null)).toEqual([]);
  });
});
