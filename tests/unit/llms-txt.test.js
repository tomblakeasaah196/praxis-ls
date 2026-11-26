"use strict";

/**
 * The AI profile, as AI assistants read it: /llms.txt, /llms-full.txt and the
 * Organization, WebSite and Service structured data.
 *
 * The rule these pin is that nothing is invented. No summary, no file; every
 * line printed is a field the tenant wrote; and a name people search by that
 * the site does not print reaches `alternateName`, never the visible copy.
 */

let mockProfileRow = null;

jest.mock("../../src/config/logger", () => ({
  logger: { warn() {}, info() {}, error() {} },
}));
jest.mock("../../src/services/tenant/registry.service", () => ({
  resolveByHost: async (host) => (host === "site.example" ? { status: "LIVE" } : null),
  withTenantConnection: async (_m, _e, fn) => fn({
    async query(sql) {
      if (/FROM site_ai_profile/.test(sql)) return { rows: mockProfileRow ? [mockProfileRow] : [] };
      return { rows: [] };
    },
  }),
}));
jest.mock("../../src/modules/branding/branding.service", () => ({
  getBranding: async () => ({ name: "Example Logistics" }),
}));
jest.mock("../../src/modules/site/site_content/site_content.service", () => ({
  getPublicCopy: async () => ({ en: {} }),
}));
jest.mock("../../src/modules/operations/service_type_web/service_type_web.repo", () => ({
  publicList: async () => [{ slug_en: "sea-freight", name_en: "Sea Freight", short_description_en: "Full and part loads." }],
}));
jest.mock("../../src/modules/content/insight/insight.service", () => ({
  listPublic: async () => ({
    articles: [{ slug_en: "douala-to-ndjamena", title_en: "Douala to N'Djamena", excerpt_en: "The corridor, week by week.", published_at: new Date("2026-07-27T08:00:00Z") }],
  }),
}));

const llms = require("../../src/shared/http/llms-txt");
const head = require("../../src/shared/http/public-head");
const brand = require("../../src/shared/http/public-head-brand");
const aiProfile = require("../../src/modules/site/site_settings/site_ai_profile");
const { siteSettings } = require("@praxis/shared");

const PROFILE = {
  singleton: true,
  site_ai_profile_id: "x",
  summary: "A freight forwarder with offices in Douala and Mannheim.",
  alternate_names: ["Example LS Group"],
  founded: "2009",
  offices: "Douala, Cameroon (head office)\nMannheim, Germany",
  services_summary: "Sea and air freight, customs clearance, road haulage to Chad.",
  sectors: ["Mining", "Energy"],
  areas_served: ["Cameroon", "Chad"],
  credentials: null,
  leadership: "B. Leader, Chief Executive Officer",
  not_offered: "No passenger travel.",
  contact: "hello@example.test",
  reviewed_on: "2026-11-26",
  updated_by: "u1",
};

beforeEach(() => {
  mockProfileRow = null;
  // The files are memoised like the heads; each test is a fresh edit.
  head.invalidateHost("site.example");
});

describe("/llms.txt", () => {
  test("an empty profile publishes nothing, not a file of defaults", async () => {
    expect(await llms.build("site.example", "https://site.example", "/")).toBeNull();
    mockProfileRow = { ...PROFILE, summary: "   " };
    expect(await llms.build("site.example", "https://site.example", "/", { full: true })).toBeNull();
    // A host with no live tenant has nothing to say either.
    expect(await llms.build("nobody.example", "https://nobody.example", "/")).toBeNull();
  });

  test("prints the tenant's profile in the llmstxt.org shape", async () => {
    mockProfileRow = PROFILE;
    const text = await llms.build("site.example", "https://site.example", "/");
    const lines = text.split("\n");
    expect(lines[0]).toBe("# Example Logistics");
    expect(text).toContain("> A freight forwarder with offices in Douala and Mannheim.");
    expect(text).toContain("- Also known as: Example LS Group");
    expect(text).toContain("- Founded: 2009");
    expect(text).toContain("- Areas served: Cameroon, Chad");
    expect(text).toContain("## Offices\n\nDouala, Cameroon (head office)\nMannheim, Germany");
    expect(text).toContain("## What the Company Does Not Do\n\nNo passenger travel.");
    expect(text).toContain("- [About](https://site.example/about)");
    expect(text).toContain("- [Full profile with every service and article](https://site.example/llms-full.txt)");
    expect(text).toContain("Last reviewed: 2026-11-26");
    // A field left empty is left out, heading and all.
    expect(text).not.toContain("Credentials");
    // Nothing internal leaks.
    expect(text).not.toMatch(/singleton|site_ai_profile_id|u1/);
  });

  test("the full file lists every published service and article with its address", async () => {
    mockProfileRow = PROFILE;
    const text = await llms.build("site.example", "https://site.example", "/site", { full: true });
    expect(text).toContain("- [Sea Freight](https://site.example/site/services/sea-freight): Full and part loads.");
    expect(text).toContain("- [Douala to N'Djamena](https://site.example/site/insights/douala-to-ndjamena): 2026-07-27. The corridor, week by week.");
  });

  test("a rehearsal host never publishes one", async () => {
    mockProfileRow = PROFILE;
    expect(await llms.build("staging.example.com", "https://staging.example.com", "/")).toBeNull();
  });
});

describe("the profile's validator", () => {
  test("blanks are null, lists are trimmed and deduplicated, dates are ISO days", () => {
    const parsed = siteSettings.aiProfile.parse({
      summary: "  ",
      alternate_names: ["Example LS Group", " ", "Example LS Group", "ELS"],
      reviewed_on: "",
    });
    expect(parsed.summary).toBeNull();
    expect(parsed.alternate_names).toEqual(["Example LS Group", "ELS"]);
    expect(parsed.reviewed_on).toBeNull();
    expect(siteSettings.aiProfile.safeParse({ reviewed_on: "26/11/2026" }).success).toBe(false);
    expect(siteSettings.aiProfile.safeParse({ unknown: 1 }).success).toBe(false);
  });

  test("the public read hides the row's internals and says null when unwritten", async () => {
    const client = (row) => ({ query: async () => ({ rows: row ? [row] : [] }) });
    expect(await aiProfile.published(client(null))).toBeNull();
    expect(await aiProfile.published(client({ ...PROFILE, summary: null }))).toBeNull();
    const pub = await aiProfile.published(client(PROFILE));
    expect(pub.summary).toBe(PROFILE.summary);
    expect(pub).not.toHaveProperty("updated_by");
    expect(pub).not.toHaveProperty("singleton");
    // A tenant database that predates the table renders without it.
    expect(await aiProfile.published({ query: async () => { throw new Error("relation does not exist"); } })).toBeNull();
  });
});

describe("structured data from the profile", () => {
  const branding = { name: "Example Logistics", logoUrl: "/api/logo.png" };
  const org = {
    places: [],
    sameAs: ["https://www.linkedin.com/company/example"],
    legalNames: ["Example Logistics Ltd", "Example Logistics GmbH"],
    founded: "2009",
  };

  test("Organization carries the alternate names, description, sectors, areas and legal names", () => {
    const ld = head.organizationLd(branding, "https://site.example", org, PROFILE);
    expect(ld).toMatchObject({
      "@type": "Organization",
      name: "Example Logistics",
      alternateName: "Example LS Group",
      legalName: ["Example Logistics Ltd", "Example Logistics GmbH"],
      description: PROFILE.summary,
      knowsAbout: ["Mining", "Energy"],
      areaServed: ["Cameroon", "Chad"],
      logo: "https://site.example/api/logo.png",
      sameAs: ["https://www.linkedin.com/company/example"],
    });
  });

  test("without a profile, nothing is invented", () => {
    const ld = head.organizationLd(branding, "https://site.example", org, null);
    for (const k of ["alternateName", "description", "knowsAbout", "areaServed"]) expect(ld).not.toHaveProperty(k);
  });

  test("WebSite names the site, its other names and its home address", () => {
    expect(head.websiteLd("Example Logistics", "https://site.example/", PROFILE)).toEqual({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Example Logistics",
      alternateName: "Example LS Group",
      url: "https://site.example/",
    });
  });

  test("a service page is a Service with its provider", () => {
    const ld = brand.serviceLd(
      { name: "Sea Freight", description: "Full and part loads.", image: "/api/x.jpg" },
      "https://site.example",
      branding,
      "https://site.example/services/sea-freight",
    );
    expect(ld).toEqual({
      "@context": "https://schema.org",
      "@type": "Service",
      name: "Sea Freight",
      description: "Full and part loads.",
      image: "https://site.example/api/x.jpg",
      url: "https://site.example/services/sea-freight",
      provider: { "@type": "Organization", name: "Example Logistics", url: "https://site.example" },
    });
  });
});
