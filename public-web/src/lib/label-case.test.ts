/**
 * The Title Case standard (owner decision D5, tenant review of 29 Sep 2026):
 * every LABEL key renders in Title Case in English and French, prose stays as
 * written, interpolated values are never cased, and "As written" turns it off.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import i18n from "@/lib/i18n";
import { caseInterpolated, caseLabel, isLabelKey, setLabelCase } from "./label-case";

// The harness pins "As written" for component tests (src/test/setup.ts); the
// standard itself is what this file tests, so it is on here.
beforeEach(() => setLabelCase("TITLE", i18n));
afterEach(async () => {
  setLabelCase("AS_WRITTEN", i18n);
  await i18n.changeLanguage("en");
});

describe("the labels", () => {
  it("render in Title Case in English", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("site.nav.portfolio")).toBe("Our Work");
    expect(i18n.t("site.chrome.portalEntry")).toBe("Client Portal");
    expect(i18n.t("site.hero.cta")).toBe("Request a Quote");
  });

  it("and in French, with French small words left small", async () => {
    await i18n.changeLanguage("fr");
    expect(i18n.t("site.nav.portfolio")).toBe("Nos Réalisations");
    expect(i18n.t("site.chrome.portalEntry")).toBe("Portail Client");
    expect(i18n.t("site.hero.cta")).toBe("Demander un Devis");
  });

  it("leave prose exactly as written", async () => {
    await i18n.changeLanguage("en");
    expect(isLabelKey("site.hero.sub")).toBe(false);
    expect(i18n.t("site.hero.sub")).toMatch(/^Sea, air and hinterland logistics/);
  });

  it("never case what was put into a {{token}}", () => {
    expect(caseInterpolated("Not marie@acme.cm?", "Not {{email}}?", "en")).toBe("Not marie@acme.cm?");
    expect(caseInterpolated("Page 2 of 5", "Page {{page}} of {{total}}", "en")).toBe("Page 2 of 5");
    expect(caseInterpolated("welcome to smartls", "welcome to {{brand}}", "en")).toBe("Welcome to smartls");
  });

  it("finish a split headline mid-phrase", () => {
    expect(caseLabel("the freight", "en", { continues: true })).toBe("the Freight");
    expect(caseLabel("the freight", "en")).toBe("The Freight");
  });

  it("stop at the tenant's 'As written'", async () => {
    await i18n.changeLanguage("en");
    setLabelCase("AS_WRITTEN", i18n);
    expect(i18n.t("site.nav.portfolio")).toBe("Our work");
    setLabelCase("TITLE", i18n);
    expect(i18n.t("site.nav.portfolio")).toBe("Our Work");
  });

  it("case a tenant's own override the same way, through the same store", async () => {
    await i18n.changeLanguage("en");
    i18n.addResourceBundle("en", "translation", { site: { nav: { careers: "work with us" } } }, true, true);
    expect(i18n.t("site.nav.careers")).toBe("Work with Us");
    i18n.addResourceBundle("en", "translation", { site: { nav: { careers: "Careers" } } }, true, true);
  });
});
