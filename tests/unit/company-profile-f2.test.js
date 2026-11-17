"use strict";
/**
 * Company Profile, Sales lean revamp PR 5 (guide §3.6, §4.7): the pieces that
 * need no database. The version lifecycle, the triggers and the share links
 * run against a real tenant in tests/integration/company-profile-versions.
 */
const fs = require("fs");
const path = require("path");
const { companyProfile } = require("@praxis/shared");
const presentation = require("../../src/modules/sales/company_profile/company_profile.presentation");
const registry = require("../../src/services/documents/templates/registry");
const kit = require("../../src/services/documents/templates/kit");
const { imageKind, expiryFrom } = require("../../src/modules/sales/company_profile/company_profile.service");

const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");
const repoSource = read("src/modules/sales/company_profile/company_profile.repo.js");
const m14560 = read("migrations/tenant/14560_company_profile_versions.sql");
const m14561 = read("migrations/tenant/14561_company_profile_version_one.sql");
const m14562 = read("migrations/tenant/14562_company_profile_projects_to_stories.sql");

const UUID1 = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";

function rows(overrides = {}) {
  const base = {
    cover: { structure: { on: true, image_key: null }, text_en: { tagline: "Beyond borders" }, text_fr: { tagline: "Au-delà des frontières" } },
    who_we_are: { structure: { on: true, show: { positioning: true, history: false, mission: true } }, text_en: { positioning: "We move freight.", history: "Since 1999.", mission: "On time." }, text_fr: { positioning: "Nous transportons." } },
    services: { structure: { on: true, items: [{ id: UUID1, on: true }, { id: UUID2, on: false }] }, text_en: { [UUID1]: "Sea freight, done well.", [UUID2]: "Hidden service words" }, text_fr: {} },
    capacity: { structure: { on: true, figures: { fleet_size: true, fleet_mix: false, warehouse: true, offices: true, gateways: true, regions: true } }, text_en: { network: "Our corridors." }, text_fr: {} },
    certifications: { structure: { on: true, items: [{ id: "c1", kind: "CERTIFICATION", held: true, document_id: null }, { id: "c2", kind: "MEMBERSHIP", held: false, document_id: null }] }, text_en: { c1: "ISO 9001", c2: "Lapsed membership" }, text_fr: { c1: "ISO 9001", c2: "Adhésion expirée" } },
    case_stories: { structure: { on: true, story_ids: [UUID1] }, text_en: {}, text_fr: {} },
    clients: { structure: { on: false, logo_ids: [UUID1] }, text_en: {}, text_fr: {} },
    why_us: { structure: { on: true, items: [{ id: "w1", on: true }, { id: "w2", on: false }] }, text_en: { "w1.title": "Own fleet", "w1.body": "Our trucks.", "w2.title": "Secret" }, text_fr: { "w1.title": "Flotte propre" } },
    contact: { structure: { on: true, show: { address: true, phone: true, email: false, website: true } }, text_en: {}, text_fr: {} },
  };
  return Object.entries({ ...base, ...overrides }).map(([section_key, r]) => ({ section_key, ...r }));
}

const options = {
  services: [
    { service_type_id: UUID1, name_en: "Sea Freight", name_fr: "Fret maritime", short_description_en: "Web words", short_description_fr: "Mots du site" },
    { service_type_id: UUID2, name_en: "Hidden", name_fr: "Caché" },
  ],
  stories: [{ success_story_id: UUID1, title: "Kribi move", client_name: null, headline: "250 TEU in 12 days", kpis: [{ label: "TEU", value: "250" }] }],
  logos: [{ logo_id: UUID1, name: "Client A", url: "/media/tenant_x/branding/a.png" }],
  contact: { legal_name: "Smart SARL", address: "Bonanjo, Douala", phone: "+237 6 99", email: "hidden@example.org", website: "smart.cm" },
  derived: {
    fleet_count: 24, fleet_composition: { Truck: 20, Van: 4 }, warehouse_capacity: 1250, warehouse_count: 2,
    office_list: [{ name: "Head office", city: "Douala" }, { name: "Branch", city: "Yaoundé" }],
    gateway_list: [{ name: "Douala" }, { name: "Kribi" }], region_list: ["CM", "TD"],
  },
  brand: { name: "Smart Logistics", logo_url: null },
};

describe("Company Profile: the shared contract", () => {
  test("nine fixed sections, in print order", () => {
    expect(companyProfile.SECTION_KEYS).toEqual([
      "cover", "who_we_are", "services", "capacity", "certifications", "case_stories", "clients", "why_us", "contact",
    ]);
  });

  test("a cover PATCH cannot set the image key: only the upload can point the PDF at a file", () => {
    const r = companyProfile.section("cover").safeParse({ structure: { on: true, image_key: "tenant_x/vault/doc.pdf" } });
    expect(r.success).toBe(false);
  });

  test("Why Choose Us holds at most six promises", () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ id: `w${i + 1}`, on: true }));
    expect(companyProfile.section("why_us").safeParse({ structure: { on: true, items } }).success).toBe(false);
    expect(companyProfile.section("why_us").safeParse({ structure: { on: true, items: items.slice(0, 6) } }).success).toBe(true);
  });

  test("words are kept only for ids the structure names, and an over-long one is an error", () => {
    const { text, errors } = companyProfile.cleanText("why_us", { items: [{ id: "w1" }] }, {
      "w1.title": "  Own fleet ", "w9.title": "orphan", "w1.body": "x".repeat(companyProfile.LIMITS.promise_body + 1),
    });
    expect(text).toEqual({ "w1.title": "Own fleet" });
    expect(Object.keys(errors)).toEqual(["w1.body"]);
  });

  test("a share needs a lead or a recipient, and a real day", () => {
    expect(companyProfile.share.safeParse({ expires_on: "2026-12-31" }).success).toBe(false);
    expect(companyProfile.share.safeParse({ recipient_name: "Total", expires_on: "2026-02-31" }).success).toBe(false);
    const ok = companyProfile.share.parse({ lead_id: UUID1, expires_on: "2026-12-31", recipient_email: "" });
    expect(ok).toMatchObject({ language: "EN", pin_version: false, recipient_email: null });
  });

  test("a link expires at the end of its last day, and not more than a year ahead", () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    expect(expiryFrom(tomorrow).toISOString()).toBe(`${tomorrow}T23:59:59.999Z`);
    expect(() => expiryFrom("2020-01-01")).toThrow(/today or later/);
    const far = new Date(Date.now() + 400 * 86400000).toISOString().slice(0, 10);
    expect(() => expiryFrom(far)).toThrow(/at most/);
  });
});

describe("Company Profile: hidden items are removed when data is read", () => {
  const v = presentation.visible(rows());

  test("a section switched off is gone", () => {
    expect(v.clients).toBeUndefined();
  });

  test("items switched off, and their words in both languages, are gone", () => {
    expect(v.services.structure.items.map((i) => i.id)).toEqual([UUID1]);
    expect(v.services.text_en[UUID2]).toBeUndefined();
    expect(v.why_us.text_en["w2.title"]).toBeUndefined();
    expect(v.certifications.structure.items.map((i) => i.id)).toEqual(["c1"]);
    expect(v.certifications.text_fr.c2).toBeUndefined();
    expect(v.who_we_are.text_en.history).toBeUndefined();
  });

  test("nothing a renderer receives mentions a hidden item", () => {
    const out = JSON.stringify(presentation.build(rows(), options, "EN"));
    for (const hidden of ["Hidden service words", "Lapsed membership", "Secret", "Since 1999", "hidden@example.org", "Client A", "Fleet Mix"]) {
      expect(out).not.toContain(hidden);
    }
  });
});

describe("Company Profile: the presentation", () => {
  test("English, with derived figures formatted once, server side", () => {
    const p = presentation.build(rows(), options, "EN");
    expect(p.company).toMatchObject({ name: "Smart Logistics", tagline: "Beyond borders" });
    const cap = p.sections.find((s) => s.key === "capacity");
    expect(cap.figures.map((f) => f.key)).toEqual(["fleet_size", "warehouse", "offices", "gateways", "regions"]);
    expect(cap.figures.find((f) => f.key === "warehouse").value).toBe("1,250");
    expect(cap.figures.find((f) => f.key === "regions").value).toBe("Cameroon, Chad");
    expect(p.sections.map((s) => s.key)).toEqual(["who_we_are", "services", "capacity", "certifications", "case_stories", "why_us", "contact"]);
  });

  test("French: sentence-case titles, French names, and a missing word falls back to English", () => {
    const p = presentation.build(rows(), options, "FR");
    expect(p.sections.find((s) => s.key === "why_us").title).toBe("Pourquoi nous choisir");
    expect(p.sections.find((s) => s.key === "services").items[0]).toEqual({ name: "Fret maritime", sentence: "Sea freight, done well." });
    const promise = p.sections.find((s) => s.key === "why_us").items[0];
    expect(promise).toEqual({ title: "Flotte propre", body: "Our trucks." });
    expect(p.sections.find((s) => s.key === "capacity").figures.find((f) => f.key === "regions").value).toBe("Cameroun, Tchad");
  });

  test("consent is respected: a story's client is anonymised unless they said NAMED", () => {
    const p = presentation.build(rows(), options, "EN");
    expect(p.sections.find((s) => s.key === "case_stories").items[0].client).toBe("Client anonymised");
  });

  test("the cover photograph appears only when one is set", () => {
    expect(presentation.build(rows(), { ...options, coverUrl: "/media/x.jpg" }, "EN").company.cover_url).toBeNull();
    const withCover = rows({ cover: { structure: { on: true, image_key: "tenant_x/site/c.jpg" }, text_en: {}, text_fr: {} } });
    expect(presentation.build(withCover, { ...options, coverUrl: "/media/x.jpg" }, "EN").company.cover_url).toBe("/media/x.jpg");
  });
});

describe("Company Profile: the editor's dots and history", () => {
  test("completeness: a word in one language only is partial", () => {
    const dots = presentation.completeness(rows());
    expect(dots.cover).toBe("complete");
    expect(dots.why_us).toBe("partial");
    expect(dots.clients).toBe("complete");
  });

  test("an empty draft is empty, not complete", () => {
    const empty = Object.entries(presentation.DEFAULT_STRUCTURE).map(([section_key, structure]) => ({ section_key, structure, text_en: {}, text_fr: {} }));
    const dots = presentation.completeness(empty);
    expect(dots.why_us).toBe("empty");
    expect(dots.who_we_are).toBe("empty");
  });

  test("the field diff names the section, the field and the language", () => {
    const before = rows();
    const after = rows({ cover: { structure: { on: true, image_key: null }, text_en: { tagline: "New line" }, text_fr: { tagline: "Au-delà des frontières" } } });
    expect(presentation.diff(before, after)).toEqual([
      { section_key: "cover", field: "tagline", language: "EN", before: "Beyond borders", after: "New line" },
    ]);
  });
});

describe("Company Profile: the PDF template", () => {
  const tpl = registry.get("COMPANY_PROFILE");

  test("is on the document renderer, with sample data for the Studio", () => {
    expect(tpl).toBeTruthy();
    expect(tpl.module).toBe("sales/company_profile");
    const html = tpl.build(tpl.sampleData, kit.mergeCfg({}, { language: "en" }), { legal_name: "X SARL" });
    expect(html).toContain("Who We Are");
    expect(html).toContain("02/11/2026");
    // The kit's own shell carries dashes in its CSS comments; this file's copy must not.
    expect(read("src/services/documents/templates/company-profile-document.js")).not.toMatch(new RegExp(String.fromCharCode(0x2014)));
  });

  test("prints the presentation it is given and nothing else", () => {
    const p = presentation.build(rows(), options, "EN");
    const html = tpl.build(p, kit.mergeCfg({}, { language: "en" }), { legal_name: "X SARL" });
    expect(html).toContain("Own fleet");
    expect(html).not.toContain("Secret");
    expect(html).not.toContain("Lapsed membership");
  });
});

describe("Company Profile: storage and data", () => {
  test("an image is judged by its bytes: SVG or a renamed file is not a raster", () => {
    expect(imageKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(imageKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(imageKind(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
  });

  test("derived SQL reads counts and places, never cost, margin or price", () => {
    expect(repoSource).not.toMatch(/\b(cost|margin|profit|unit_price|purchase_price)\b/i);
    expect(repoSource).toContain("SELECT count(*)::int FROM vehicle");
    expect(repoSource).toContain("entity_establishment");
    expect(repoSource).toContain("geo_place");
  });

  test("migrations: one draft, one published, frozen once published, and rerunnable", () => {
    expect(m14560).toMatch(/ux_cpv_one_draft[\s\S]*WHERE status = 'DRAFT'/);
    expect(m14560).toMatch(/ux_cpv_one_published[\s\S]*WHERE status = 'PUBLISHED'/);
    expect(m14560).toContain("BEFORE INSERT OR UPDATE OR DELETE ON company_profile_section");
    for (const sql of [m14560, m14561, m14562]) expect(sql).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/i);
    expect(m14561).toContain("IF EXISTS (SELECT 1 FROM company_profile_version)");
    expect(m14562).toContain("ON CONFLICT DO NOTHING");
    expect(m14562).toMatch(/is_published[\s\S]*false/);
  });

  test("the nightly refresh is still registered", () => {
    const workers = read("src/jobs/workers.js");
    expect(workers).toContain("company-profile-refresh-scheduler");
    expect(workers).toContain("15 2 * * *");
  });
});
