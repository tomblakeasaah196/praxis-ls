"use strict";

/**
 * English first (website v2, PR 1): the one rule for which language a
 * tenant's website REQUIRES, and what its public reads may serve.
 *
 * The helper is pinned directly, then each writer that uses it is pinned on an
 * English-only tenant (the default since 14600): an English line is accepted
 * with no French, a French line with no English is refused, and the public
 * reads never carry French.
 */

jest.mock("../../src/modules/site/site_settings/site_switches", () => ({
  load: jest.fn(),
}));
jest.mock("../../src/modules/site/site_content/site_content.repo");
jest.mock("../../src/modules/operations/service_type_web/service_type_web.repo");
jest.mock("../../src/shared/db/tx", () => ({ atomically: (_c, fn) => fn() }));
jest.mock("../../src/shared/events/emit", () => ({ audit: jest.fn(), emitEvent: jest.fn() }));

const { siteLanguages, siteSettings } = require("@praxis/shared");
const switches = require("../../src/modules/site/site_settings/site_switches");
const contentRepo = require("../../src/modules/site/site_content/site_content.repo");
const content = require("../../src/modules/site/site_content/site_content.service");
const webRepo = require("../../src/modules/operations/service_type_web/service_type_web.repo");
const web = require("../../src/modules/operations/service_type_web/service_type_web.service");

const EN = { languages: ["en"] };
const BOTH = { languages: ["en", "fr"] };

beforeEach(() => {
  jest.clearAllMocks();
  switches.load.mockResolvedValue(EN);
});

describe("the rule", () => {
  it("offers English always and French only when asked", () => {
    expect(siteLanguages.normaliseLanguages([])).toEqual(["en"]);
    expect(siteLanguages.normaliseLanguages(["fr"])).toEqual(["en", "fr"]);
    expect(siteLanguages.normaliseLanguages(["FR", "en", "de"])).toEqual(["en", "fr"]);
    expect(siteLanguages.normaliseLanguages(undefined)).toEqual(["en"]);
  });

  it("requires English on an English-only site and French where French is offered", () => {
    expect(siteLanguages.requiredLanguage(EN)).toBe("en");
    expect(siteLanguages.requiredLanguage(BOTH)).toBe("fr");
    expect(siteLanguages.requiredLanguage(["en"])).toBe("en");
    expect(siteLanguages.requiredLanguage(null)).toBe("en");
  });

  it("finds every bilingual value missing the required half, wherever it sits", () => {
    const tree = {
      title: { fr: "Titre", en: "" },
      items: [{ label: { en: "Sea" } }, { label: { fr: "Air" } }],
      subtitle: null,
    };
    expect(siteLanguages.bilingualGaps(tree, EN)).toEqual(["title", "items.1.label"]);
    expect(siteLanguages.bilingualGaps(tree, BOTH)).toEqual(["items.0.label"]);
  });

  it("checks flat column pairs, and insists only where told to", () => {
    const row = { summary_fr: "Bonjour", summary_en: "", title_fr: "", title_en: "" };
    expect(siteLanguages.pairGaps(row, ["summary", "title"], EN)).toEqual(["summary_en"]);
    expect(
      siteLanguages.pairGaps(row, ["summary", "title"], EN, { mustHave: ["title"] }),
    ).toEqual(["summary_en", "title_en"]);
    expect(siteLanguages.pairGaps(row, ["summary"], BOTH)).toEqual([]);
  });

  it("takes French out of a public payload, and leaves addresses alone", () => {
    const payload = {
      title: { fr: "Titre", en: "Title" },
      name_fr: "Fret",
      name_en: "Freight",
      slug_fr: "fret",
      slug_en: "freight",
      highlights_fr: ["a"],
      highlights_en: ["b"],
      rows: [{ label_fr: "Douala", label_en: null }],
    };
    const out = siteLanguages.withoutUnofferedLanguage(payload, EN);
    expect(out.title).toEqual({ fr: null, en: "Title" });
    expect(out.name_fr).toBeNull();
    expect(out.slug_fr).toBe("fret");
    expect(out.highlights_fr).toEqual([]);
    expect(out.rows[0].label_fr).toBeNull();
    // The input is not touched, and a bilingual tenant gets it back as it was.
    expect(payload.name_fr).toBe("Fret");
    expect(siteLanguages.withoutUnofferedLanguage(payload, BOTH)).toBe(payload);
  });
});

describe("the switches payload", () => {
  it("is all off and English only unless a person says otherwise", () => {
    const parsed = siteSettings.siteSwitches.safeParse({
      languages: [],
      top_rail: false,
      portfolio: false,
      corridors: false,
      case_notes: false,
      careers_in_header: false,
      visitor_theme_switch: true,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data.languages).toEqual(["en"]);
    expect(siteSettings.siteSwitches.safeParse({ languages: ["de"] }).success).toBe(false);
  });
});

describe("site content on an English-only site", () => {
  it("accepts an English block with no French", async () => {
    contentRepo.getPage.mockResolvedValue({ page_id: "p" });
    contentRepo.createBlock.mockImplementation(async (_c, _p, row) => ({ block_id: "b", ...row }));
    await expect(
      content.createBlock({}, {
        pageId: "p",
        patch: { type: "cta_band", content: { title: { en: "Talk to the desk" } } },
      }),
    ).resolves.toMatchObject({ block_id: "b" });
  });

  it("refuses a French block with no English, naming the field", async () => {
    contentRepo.getPage.mockResolvedValue({ page_id: "p" });
    await expect(
      content.createBlock({}, {
        pageId: "p",
        patch: { type: "cta_band", content: { title: { fr: "Parlez au bureau" } } },
      }),
    ).rejects.toMatchObject({ status: 422, details: { title: expect.any(Array) } });
  });

  it("still requires French of a tenant that offers it", async () => {
    switches.load.mockResolvedValue(BOTH);
    contentRepo.getPage.mockResolvedValue({ page_id: "p" });
    await expect(
      content.createBlock({}, {
        pageId: "p",
        patch: { type: "cta_band", content: { title: { en: "Talk to the desk" } } },
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("requires a page title in English", async () => {
    contentRepo.pageKeyTaken.mockResolvedValue(false);
    await expect(
      content.createPage({}, { patch: { key: "home", title_fr: "Accueil" } }),
    ).rejects.toMatchObject({ status: 422, details: { title_en: expect.any(Array) } });
  });

  it("serves a published page with no French in it", async () => {
    contentRepo.getPageByKey.mockResolvedValue({
      page_id: "p", key: "home", title_fr: "Accueil", title_en: "Home",
    });
    contentRepo.listBlocks.mockResolvedValue([
      { block_id: "b", type: "cta_band", content: { title: { fr: "Bonjour", en: "Hello" } } },
    ]);
    const page = await content.getPublicPage({}, "home");
    expect(page.title_fr).toBeNull();
    expect(page.blocks[0].content.title).toEqual({ fr: null, en: "Hello" });
  });
});

describe("service web profiles on an English-only site", () => {
  it("refuses a pillar named only in French", async () => {
    await expect(
      web.createGroup({}, { patch: { key: "freight", name_fr: "Fret" } }),
    ).rejects.toMatchObject({ status: 422, details: { name_en: expect.any(Array) } });
  });

  it("accepts a pillar named only in English", async () => {
    webRepo.groupKeyTaken.mockResolvedValue(false);
    webRepo.createGroup.mockImplementation(async (_c, row) => ({ group_id: "g", ...row }));
    await expect(
      web.createGroup({}, { patch: { key: "freight", name_en: "International Freight" } }),
    ).resolves.toMatchObject({ group_id: "g" });
  });

  it("refuses a question with no English", async () => {
    webRepo.serviceTypeExists.mockResolvedValue(true);
    await expect(
      web.replaceFaq({}, {
        serviceTypeId: "s",
        rows: [{ question_fr: "Quel délai ?", answer_fr: "Deux semaines." }],
      }),
    ).rejects.toMatchObject({ status: 422 });
  });
});
