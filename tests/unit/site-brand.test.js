/**
 * The website's brand layer (14660): trust documents with a Draft and a
 * Published state, their PDF body, the legal facts behind the Impressum, the
 * privacy policy's first draft, and the photograph slot registry.
 *
 * The legal read is asserted on the SERIALISED body, for the reason
 * site-public-redaction.test.js gives: a leak at any depth fails.
 */
"use strict";

jest.mock("../../src/modules/site/site_settings/site_switches", () => ({
  load: jest.fn(async () => ({ languages: ["en"] })),
}));

const { siteBrand } = require("@praxis/shared");
const service = require("../../src/modules/site/site_brand/site_brand.service");
const pdf = require("../../src/modules/site/site_brand/site_brand.pdf");
const privacy = require("../../src/modules/site/site_brand/site_brand.privacy");

function stubClient(tables) {
  return {
    async query(sql) {
      const text = String(sql);
      for (const [table, rows] of Object.entries(tables)) {
        if (new RegExp(`\\bFROM ${table}\\b`).test(text)) return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

const DRAFT = {
  document_id: "d1",
  doc_key: "quality-policy",
  kind: "POLICY",
  title_en: "Quality Policy",
  summary_en: "How we make sure a shipment arrives as promised.",
  body_en: "## Scope\n\nEvery file.",
  title_fr: null,
  body_fr: null,
  title_de: null,
  body_de: null,
  version_label: "1.0",
  effective_on: "2026-11-25",
  approved_by: "Managing Director",
};

describe("trust documents: draft and published", () => {
  test("a document never published is a DRAFT", () => {
    expect(service.statusOf({ ...DRAFT, published: null })).toBe("DRAFT");
  });

  test("publishing freezes the draft, and the status reads PUBLISHED", () => {
    const published = service.snapshotOf(DRAFT);
    expect(published.langs.en.title).toBe("Quality Policy");
    expect(published.langs.fr).toBeUndefined();
    expect(service.statusOf({ ...DRAFT, published })).toBe("PUBLISHED");
  });

  test("editing after publishing reads CHANGED, and the published copy is untouched", () => {
    const published = service.snapshotOf(DRAFT);
    const edited = { ...DRAFT, body_en: "## Scope\n\nEvery file, every time.", published };
    expect(service.statusOf(edited)).toBe("CHANGED");
    expect(edited.published.langs.en.body).toBe("## Scope\n\nEvery file.");
  });

  test("a title over no body cannot be published, and the main language needs a title", () => {
    expect(siteBrand.publishGaps(DRAFT, "en")).toEqual([]);
    expect(siteBrand.publishGaps({ ...DRAFT, title_fr: "Politique qualité" }, "en")).toEqual(["body_fr"]);
    expect(siteBrand.publishGaps({ ...DRAFT, title_en: "" }, "en")).toEqual(["title_en"]);
  });

  test("the publish endpoint refuses a gap with the field named, before any write", async () => {
    const writes = [];
    const client = {
      async query(sql) {
        if (/^\s*UPDATE/i.test(sql)) writes.push(sql);
        if (/FROM site_document WHERE document_id/.test(sql)) {
          return { rows: [{ ...DRAFT, title_de: "Qualitätspolitik", published: null }] };
        }
        return { rows: [] };
      },
    };
    await expect(service.setPublished(client, { id: "d1", published: true }))
      .rejects.toMatchObject({ status: 422, details: { body_de: expect.any(Array) } });
    expect(writes).toHaveLength(0);
  });

  test("the public list carries no body and only published documents", async () => {
    const client = stubClient({
      site_document: [{
        document_id: "d1",
        doc_key: "quality-policy",
        kind: "POLICY",
        published: service.snapshotOf(DRAFT),
        published_at: "2026-11-25T10:00:00Z",
      }],
    });
    const list = await service.publicDocuments(client, { lang: "en" });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ key: "quality-policy", title: "Quality Policy", version_label: "1.0" });
    expect(JSON.stringify(list)).not.toContain("Every file");
  });
});

describe("the PDF body", () => {
  test("markup in a document is printed as text, and only safe links become links", () => {
    const html = pdf.markdownToHtml("<script>x</script> [a](javascript:alert(1)) [b](https://example.com)");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('<a href="https://example.com">b</a>');
  });

  test("headings never rise above h2, lists close, an address keeps its lines", () => {
    const html = pdf.markdownToHtml("# A\n\n## B\n\n- one\n- two\n\nLine one  \nLine two");
    expect(html).toContain("<h2>A</h2>");
    expect(html).toContain("<h2>B</h2>");
    expect(html).toContain("<ul>\n<li>one</li>\n<li>two</li>\n</ul>");
    expect(html).toContain("<p>Line one<br>Line two</p>");
  });
});

describe("the legal facts (Impressum)", () => {
  const SECRET_NIU = "NIU-M012345678901X";
  const client = stubClient({
    corporate_entity: [
      {
        entity_id: "de1", code: "SLSUG", legal_name: "Smart Logistics and Services UG (haftungsbeschränkt)",
        legal_form: "UG (haftungsbeschränkt)", country_code: "DE", email: "europe@example.com",
        phone: "+49 621 000000", website: null,
      },
      {
        entity_id: "cm1", code: "SLAS", legal_name: "Smart Logistics and Services Ltd",
        legal_form: "SARL", country_code: "CM", email: "info@example.com", phone: "+237 233 420 281",
      },
    ],
    entity_registration: [
      { entity_id: "de1", kind: "HRB", number: "HRB 700000", issuing_authority: "Amtsgericht Mannheim" },
      { entity_id: "de1", kind: "VAT", number: "DE123456789" },
      { entity_id: "cm1", kind: "NIU", number: SECRET_NIU },
      { entity_id: "cm1", kind: "RCCM", number: "RC/DLA/2021/B/0001" },
    ],
    entity_person: [{ entity_id: "de1", role: "DIRECTOR", full_name: "Vanessa Mezakeu", title: "Geschäftsführerin" }],
    entity_address: [{
      entity_id: "de1", type: "REGISTERED", line1: "Rheingoldstraße 103", postal_code: "68199",
      city: "Mannheim", country_code: "DE", is_primary: true, is_active: true,
    }],
  });

  test("states the register, the VAT number and who represents the company", async () => {
    const legal = await service.publicLegal(client);
    const de = legal.find((e) => e.id === "de1");
    expect(de.register).toEqual({ kind: "HRB", number: "HRB 700000", authority: "Amtsgericht Mannheim" });
    expect(de.vat_id).toBe("DE123456789");
    expect(de.representatives).toEqual([{ name: "Vanessa Mezakeu", title: "Geschäftsführerin" }]);
    expect(de.address_lines).toEqual(["Rheingoldstraße 103", "68199 Mannheim", "Germany"]);
  });

  test("never states any other identifier", async () => {
    const body = JSON.stringify(await service.publicLegal(client));
    expect(body).not.toContain(SECRET_NIU);
    expect(body).toContain("RC/DLA/2021/B/0001");
  });
});

describe("the privacy policy's first draft", () => {
  const legal = [
    {
      legal_name: "Smart Logistics and Services Ltd", legal_form: null, country_code: "CM",
      address_lines: ["1030, Avenue Douala Manga Bell", "Douala", "Cameroon"], representatives: [],
      email: "info@example.com", phone: null,
    },
    {
      legal_name: "Smart Logistics and Services UG (haftungsbeschränkt)", legal_form: "UG (haftungsbeschränkt)",
      country_code: "DE", address_lines: ["Rheingoldstraße 103", "68199 Mannheim", "Germany"],
      representatives: [{ name: "Vanessa Mezakeu" }], email: null, phone: null,
    },
  ];

  test("names every company in both languages and states the transfer basis", () => {
    const d = privacy.draft(legal);
    for (const lang of ["en", "de"]) {
      expect(d[lang].body).toContain("Smart Logistics and Services Ltd");
      expect(d[lang].body).toContain("Rheingoldstraße 103");
      expect(d[lang].body).toMatch(/49/);
    }
    expect(d.en.title).toBe("Privacy Policy");
    expect(d.de.title).toBe("Datenschutzerklärung");
    expect(d.de.body).toContain("Vertreten durch: Vanessa Mezakeu");
  });

  test("contains no em dash and no double dash", () => {
    const d = privacy.draft(legal);
    for (const lang of ["en", "de"]) {
      expect(d[lang].body).not.toMatch(/—|--/);
      expect(d[lang].summary).not.toMatch(/—|--/);
    }
  });
});

describe("photograph slots", () => {
  test("registry keys and family keys are slots; anything else is not", () => {
    expect(siteBrand.isImageSlot("about-hero")).toBe(true);
    expect(siteBrand.isImageSlot("family-international-freight")).toBe(true);
    expect(siteBrand.isImageSlot("../etc/passwd")).toBe(false);
    expect(siteBrand.isImageSlot("about-hero; drop")).toBe(false);
  });

  test("every slot is an atmosphere slot, so a generated picture is accepted and no person's", () => {
    const media = require("../../src/modules/site/site_settings/site_settings.media");
    expect(media.SITE_MEDIA_SLOTS["site-image"]).toMatchObject({ role: "ATMOSPHERE", evidence: false });
    expect(media.SITE_MEDIA_SLOTS["leader-portrait"].evidence).toBe(true);
  });
});

describe("editing one field of a leader", () => {
  const v = require("../../src/modules/site/site_settings/site_settings.validator");

  test("a PATCH carrying one field is accepted, and an empty name is still refused", () => {
    expect(v.schemas.updateLeader.safeParse({ role_en: "Managing Director" }).success).toBe(true);
    expect(v.schemas.updateLeader.safeParse({ partner_desk: true, email: "" }).success).toBe(true);
    expect(v.schemas.updateLeader.safeParse({ full_name: "" }).success).toBe(false);
  });

  test("a contact's email and phone are published only for the partner desk", async () => {
    const settings = require("../../src/modules/site/site_settings/site_settings.service");
    const client = stubClient({
      site_about: [{ headline_en: "We Hold Both Ends of the Line", sections: { hero_eyebrow: { en: "About Us" } } }],
      site_leader: [
        { leader_id: "l1", entity_id: null, full_name: "Desk Person", is_active: true, partner_desk: true, email: "desk@example.com", phone: "+237 1" },
        { leader_id: "l2", entity_id: null, full_name: "Private Person", is_active: true, partner_desk: false, email: "private@example.com", phone: "+237 2" },
      ],
    });
    const about = await settings.publicAbout(client);
    const body = JSON.stringify(about);
    expect(body).toContain("desk@example.com");
    expect(body).not.toContain("private@example.com");
    expect(body).not.toContain("+237 2");
    expect(about.sections.hero_eyebrow.en).toBe("About Us");
  });
});

describe("editing one field of a partner or a credential", () => {
  const v = require("../../src/modules/site/site_settings/site_settings.validator");
  const settings = require("../../src/modules/site/site_settings/site_settings.service");

  test("a PATCH of one field is accepted at the door", () => {
    expect(v.schemas.updatePartner.safeParse({ kind: "client" }).success).toBe(true);
    expect(v.schemas.updatePartner.safeParse({ member_number: "123456" }).success).toBe(true);
    expect(v.schemas.updateCredential.safeParse({ is_active: true }).success).toBe(true);
  });

  test("showing a mark with no clearance on file is still refused, on the merged row", async () => {
    const client = {
      async query(sql) {
        if (/FROM site_partner WHERE partner_id/.test(sql)) {
          return { rows: [{ partner_id: "p1", name: "GIZ", kind: "client", permission_note: null, is_active: false }] };
        }
        return { rows: [] };
      },
    };
    await expect(settings.partners.update(client, { id: "p1", patch: { is_active: true } }))
      .rejects.toMatchObject({ status: 422, details: { permission_note: expect.any(Array) } });
  });
});
