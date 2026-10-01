"use strict";
/**
 * The Title Case standard (tenant review of 29 Sep 2026, owner decision D5),
 * from the side the repo root can see:
 *
 *   - ONE function: the financial dictionary's `titleCase` now lives in
 *     packages/shared/text/title-case.js, and the dictionary re-exports that
 *     very function — not a copy (its own tests, and seed 90995's twin, run
 *     against it unchanged);
 *   - the LABEL/PROSE list is coherent: no key in both lists, `*` for array
 *     indices, no catch-all section;
 *   - the tenant's switch: `siteSettings.theme` takes TITLE / AS_WRITTEN and
 *     nothing else, and the public theme answers the standard when the row has
 *     no value (a row from before 14262).
 */
jest.mock("../../src/modules/site/site_settings/site_settings.repo", () => ({ getTheme: jest.fn() }));

const shared = require("@praxis/shared/text/title-case");
const rules = require("../../src/modules/master/financial_dictionary/financial_dictionary.rules");
const cases = require("../../scripts/gen/site-copy-case");
const { siteSettings } = require("@praxis/shared");
const repo = require("../../src/modules/site/site_settings/site_settings.repo");
const { publicTheme } = require("../../src/modules/site/site_settings/site_settings.service");

describe("one casing function", () => {
  it("is the dictionary's, shared — the same function, not a copy", () => {
    expect(rules.titleCase).toBe(shared.titleCase);
  });

  it("cases the owner's examples in both languages", () => {
    expect(shared.titleCase("Our work", "en")).toBe("Our Work");
    expect(shared.titleCase("Request a quote", "en")).toBe("Request a Quote");
    expect(shared.titleCase("Nos réalisations", "fr")).toBe("Nos Réalisations");
    expect(shared.titleCase("Portail client", "fr")).toBe("Portail Client");
    expect(shared.titleCase("Demander un devis", "fr")).toBe("Demander un Devis");
  });
});

describe("the LABEL / PROSE list", () => {
  it("never names a key in both lists", () => {
    const seen = new Map();
    for (const { key, kind } of cases.explicitKeys()) {
      expect([key, seen.get(key)]).toEqual([key, seen.has(key) ? kind : undefined]);
      seen.set(key, kind);
    }
  });

  it("has no catch-all: every section is site.<x>, portal.<x> or the portal's own leaves", () => {
    for (const section of Object.keys(cases.CASES)) {
      expect(section === "portal" || /^(site|portal)\.[A-Za-z]+$/.test(section)).toBe(true);
    }
  });

  it("classifies an array item with its siblings", () => {
    expect(cases.classify("site.how.steps.7.t")).toBe("LABEL");
    expect(cases.classify("site.how.steps.7.d")).toBe("PROSE");
    expect(cases.classify("site.nowhere.title")).toBeNull();
  });
});

describe("the tenant's switch", () => {
  const theme = {
    primary_hex: "#ff5a00", secondary_hex: null, tertiary_hex: null,
    font_display: "archivo", font_body: "inter", font_mono: "jetbrains-mono",
    radius_px: 10, default_mode: "light",
  };

  it("accepts Title Case or As written, and nothing else", () => {
    expect(siteSettings.theme.safeParse({ ...theme, label_case: "TITLE" }).success).toBe(true);
    expect(siteSettings.theme.safeParse({ ...theme, label_case: "AS_WRITTEN" }).success).toBe(true);
    expect(siteSettings.theme.safeParse({ ...theme, label_case: "UPPER" }).success).toBe(false);
    // A screen from before the field still saves the rest of its theme.
    expect(siteSettings.theme.safeParse(theme).success).toBe(true);
  });

  it("is the standard unless the tenant chose As written", async () => {
    repo.getTheme.mockResolvedValueOnce({ ...theme });
    expect((await publicTheme({})).labelCase).toBe("TITLE");
    repo.getTheme.mockResolvedValueOnce({ ...theme, label_case: "AS_WRITTEN" });
    expect((await publicTheme({})).labelCase).toBe("AS_WRITTEN");
  });
});
