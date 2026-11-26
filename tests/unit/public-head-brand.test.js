/**
 * The search heads of the brand pages and the Organization data (PR 4).
 *
 * Asserted against the ROUTES table and stubbed tenant reads, so no database
 * is needed: each route's `load` is handed a client that answers the queries
 * it makes, and its `shape` is what the head would print.
 */
"use strict";

jest.mock("../../src/config/logger", () => ({
  logger: { warn() {}, info() {}, error() {} },
}));
jest.mock("../../src/modules/site/site_settings/site_switches", () => ({
  load: jest.fn(async () => ({ languages: ["en"] })),
}));

const brand = require("../../src/shared/http/public-head-brand");
const head = require("../../src/shared/http/public-head");

function stub(tables) {
  return {
    async query(sql) {
      const text = String(sql);
      for (const [table, rows] of Object.entries(tables)) {
        if (new RegExp(`FROM ${table}\\b`).test(text)) return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

const route = (path) => {
  const r = brand.ROUTES.find((x) => x.test.test(path));
  if (!r) throw new Error(`no route for ${path}`);
  return { r, m: r.test.exec(path) };
};

describe("the brand page heads", () => {
  test("every brand page is matched, and none collides with the older table", () => {
    for (const p of ["/", "/about", "/services", "/services/sea-freight", "/partners", "/trust", "/trust/quality-policy", "/legal/privacy", "/legal/impressum"]) {
      expect(route(p)).toBeTruthy();
    }
    // The older table's paths still reach their own entries.
    expect(brand.ROUTES.some((r) => r.test.test("/insights/some-article"))).toBe(false);
    expect(brand.ROUTES.some((r) => r.test.test("/q/abc"))).toBe(false);
    // And the combined table carries both.
    expect(head.ROUTES.length).toBeGreaterThan(brand.ROUTES.length);
  });

  test("a written meta title is printed as written; without one, the page's Link Previews title", async () => {
    const { r, m } = route("/about");
    const withMeta = r.shape(await r.load(stub({
      site_page: [{ meta_title_en: "About Us | Smart Logistics and Services, Douala and Mannheim", meta_description_en: "Freight forwarding between Europe and Central Africa." }],
    }), m[1]));
    expect(withMeta).toMatchObject({
      title: "About Us | Smart Logistics and Services, Douala and Mannheim",
      fullTitle: true,
      description: "Freight forwarding between Europe and Central Africa.",
    });
    const without = r.shape(await r.load(stub({ site_about: [{ summary_en: "From our own offices." }] }), m[1]));
    expect(without).toMatchObject({ title: "About Us", fullTitle: false, description: "From our own offices." });
  });

  test("the About head carries its hero photograph", async () => {
    const { r, m } = route("/about");
    const shaped = r.shape(await r.load(stub({ site_image: [{ vault_id: "doc-1" }] }), m[1]));
    expect(shaped.image).toBe("/api/tenant/public/site/media/doc-1");
  });

  test("a service card prints the website's name for the service, not the operations name", () => {
    const r = brand.ROUTES.find((x) => x.test.test("/services/sea-freight"));
    const shaped = r.shape({
      row: { name_en: "Sea Freight Import", web_name_en: "Sea Freight", meta_title_en: "Sea Freight to Douala and Kribi" },
      mediaByRole: new Map(),
    });
    expect(shaped).toMatchObject({ headline: "Sea Freight", title: "Sea Freight to Douala and Kribi", fullTitle: true });
    expect(shaped.trail[1].name).toBe("Sea Freight");
  });

  test("an unpublished document describes nothing", async () => {
    const { r, m } = route("/trust/not-here");
    await expect(r.load(stub({}), m[1])).rejects.toMatchObject({ status: 404 });
  });
});

describe("the Organization data", () => {
  test("names both offices as places, with the founding year and the social profiles", async () => {
    const client = stub({
      corporate_entity: [
        { entity_id: "cm", legal_name: "Smart Logistics and Services Ltd", country_code: "CM", email: "info@example.com", phone: "+237 233 420 281" },
        { entity_id: "de", legal_name: "Smart Logistics and Services UG (haftungsbeschränkt)", country_code: "DE" },
      ],
      entity_address: [
        { entity_id: "cm", type: "REGISTERED", line1: "1030, Avenue Douala Manga Bell", city: "Douala", country_code: "CM", is_primary: true, is_active: true },
        { entity_id: "de", type: "REGISTERED", line1: "Rheingoldstraße 103", postal_code: "68199", city: "Mannheim", country_code: "DE", is_primary: true, is_active: true },
      ],
      site_about: [{
        founded_year: 2021,
        sections: { offices: { items: [{ entity_id: "cm", heading: { en: "Douala, Cameroon" } }, { entity_id: "de", heading: { en: "Mannheim, Germany" } }] } },
      }],
      site_social_link: [{ url: "https://www.linkedin.com/company/example" }],
    });
    const org = await brand.offices(client);
    expect(org.places.map((p) => p.name)).toEqual(["Douala, Cameroon", "Mannheim, Germany"]);
    expect(org.places[1].address).toMatchObject({ streetAddress: "Rheingoldstraße 103", postalCode: "68199", addressLocality: "Mannheim", addressCountry: "DE" });
    expect(org.founded).toBe("2021");
    expect(org.sameAs).toEqual(["https://www.linkedin.com/company/example"]);
    expect(org.email).toBe("info@example.com");
  });
});
