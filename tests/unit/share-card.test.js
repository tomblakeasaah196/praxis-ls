/**
 * The share card: the picture a chat app shows for a shared page.
 *
 * Built after the first tenant's owner would not send his website's link to
 * his CEO (25 Nov 2026): WhatsApp showed the legal name, the logo cropped to
 * two letters and no sentence. These pin the three things that went wrong and
 * the one that would go wrong next.
 */
"use strict";

jest.mock("../../src/services/tenant/registry.service", () => ({
  resolveByHost: async () => null,
  withTenantConnection: async () => null,
}));
jest.mock("../../src/config/logger", () => ({
  logger: { warn() {}, info() {}, error() {} },
}));

const sharp = require("sharp");
const card = require("../../src/services/share-card/share-card.service");
const share = require("../../src/shared/http/public-head-share");
const head = require("../../src/shared/http/public-head");
const brand = require("../../src/shared/http/public-head-brand");

const photo = () =>
  sharp({ create: { width: 1600, height: 900, channels: 3, background: "#3a5a78" } }).jpeg().toBuffer();
const transparentLogo = () =>
  sharp({ create: { width: 600, height: 200, channels: 4, background: { r: 240, g: 126, b: 0, alpha: 1 } } })
    .extend({ top: 20, bottom: 20, left: 20, right: 20, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

describe("the card", () => {
  test("is a 1200 x 630 JPEG, small enough for WhatsApp to draw it large", async () => {
    const out = await card.renderCard({
      photo: await photo(),
      logo: await transparentLogo(),
      headline: "Your Cargo, Already There",
      address: "smartlsgroup.com",
      accent: "#F07E00",
      font: "archivo",
    });
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("jpeg");
    expect([meta.width, meta.height]).toEqual([1200, 630]);
    // WhatsApp falls back to its small thumbnail above roughly 300 kB.
    expect(out.length).toBeLessThan(300 * 1024);
  });

  test("still draws with no photograph, no logo, an unknown face and a bad colour", async () => {
    const out = await card.renderCard({ headline: "Contact Us", accent: "red; drop", font: "comic-sans" });
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 630]);
  });

  test("an unreadable photograph is skipped, not fatal", async () => {
    const out = await card.renderCard({ photo: Buffer.from("not an image"), headline: "Track a Shipment" });
    expect((await sharp(out).metadata()).format).toBe("jpeg");
  });

  test("a long article headline steps down and wraps rather than being cut", () => {
    const { createCanvas } = require("@napi-rs/canvas");
    const ctx = createCanvas(10, 10).getContext("2d");
    const long = "Douala to N’Djamena: What the 1,800 Kilometres Actually Involve for a Container";
    const fit = card.fitHeadline(ctx, long, "sans-serif", 680);
    expect(fit.lines.length).toBeLessThanOrEqual(4);
    expect(fit.lines.join(" ")).toBe(long);
    const short = card.fitHeadline(ctx, "Sea Freight", "sans-serif", 680);
    expect(short).toMatchObject({ size: 76, lines: ["Sea Freight"] });
  });
});

describe("the words a shared link carries", () => {
  const tree = (s) => ({ site: { share: s } });

  test("the site name defaults to the brand name and takes the tenant's own", () => {
    expect(share.siteName(share.empty(), { name: "Smart Logistics & Services Ltd" })).toBe("Smart Logistics & Services Ltd");
    const written = share.reader(tree({ siteName: "Smart Logistics and Services" }));
    expect(share.siteName(written, { name: "Smart Logistics & Services Ltd" })).toBe("Smart Logistics and Services");
    expect(share.siteName(share.empty(), null)).toBe("Praxis");
  });

  test("a page title follows the site's Title Case, unless the tenant chose As written", () => {
    const r = share.reader(tree({ homeTitle: "Your cargo, already there" }));
    expect(share.page(r, "home").title).toBe("Your Cargo, Already There");
    const asWritten = share.reader(tree({ homeTitle: "your cargo, already there" }), { titles: false });
    expect(share.page(asWritten, "home").title).toBe("your cargo, already there");
  });

  test("every built-in page has a shipped title and sentence, with no dash in either", () => {
    for (const stem of ["home", "about", "services", "insights", "track", "quote", "contact", "careers", "partners", "trust", "portfolio", "verify"]) {
      const words = share.page(share.empty(), stem);
      expect(words.title).toBeTruthy();
      expect(words.description).toBeTruthy();
      expect(words.title + words.description).not.toMatch(/[–—]|--/);
      expect(words.writtenDescription).toBeNull();
    }
  });
});

describe("the page table", () => {
  test("Contact, Track, Quote, Careers, Insights and Verify have heads of their own now", () => {
    for (const p of ["/contact", "/track", "/quote", "/careers", "/insights", "/portfolio", "/verify"]) {
      expect(brand.ROUTES.some((r) => r.test.test(p))).toBe(true);
    }
    // A vacancy and an article still reach their own entries.
    expect(brand.ROUTES.some((r) => r.test.test("/careers/abc"))).toBe(false);
    expect(brand.ROUTES.some((r) => r.test.test("/insights/some-article"))).toBe(false);
  });

  test("a written share sentence beats the About summary; the summary beats the shipped default", async () => {
    const r = brand.ROUTES.find((x) => x.test.test("/about"));
    const loaded = { meta: null, image: "/api/tenant/public/site/media/x", extra: { description: "From our own offices." } };
    expect(r.shape(loaded, { share: share.empty() }).description).toBe("From our own offices.");
    const written = share.reader(tree({ aboutDescription: "Both ends of the line." }));
    expect(r.shape(loaded, { share: written })).toMatchObject({
      title: "About Us",
      headline: "About Us",
      description: "Both ends of the line.",
      image: "/api/tenant/public/site/media/x",
    });
  });

  function tree(s) {
    return { site: { share: s } };
  }

  /* 14720. The vacancy entry handed its pg client to `careers.findByToken`,
     which takes a REQUEST, so it threw on every call and every shared role
     link unfurled as the generic home card. It now reads the token through the
     repo, and a role with a photograph puts it on its card. */
  test("a vacancy is read by token through the repo, and its photograph is its card's", async () => {
    const vacancyRepo = require("../../src/modules/hr/vacancy/vacancy.repo");
    const spy = jest.spyOn(vacancyRepo, "publishedByToken").mockResolvedValue({
      title: "Customer Service Officer",
      description: "Be the first voice our clients hear.",
      cover_id: "d1",
    });
    try {
      const r = head.ROUTES.find((x) => x.test.test("/careers/tok%20en"));
      const client = { query: jest.fn() };
      const row = await r.load(client, "tok%20en");
      expect(spy).toHaveBeenCalledWith(client, "tok en");
      expect(r.shape(row)).toMatchObject({
        title: "Customer Service Officer",
        image: "/api/tenant/public/site/media/d1",
      });
      // No photograph: the card falls back to the site's own, as before.
      expect(r.shape({ ...row, cover_id: null }).image).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("the head", () => {
  test("every page names a card with its size, alt text and Twitter twins", async () => {
    const tags = await head.headFor("example.test", "/contact", "https://example.test", "/");
    expect(tags).toMatch(/<meta property="og:image" content="https:\/\/example\.test\/api\/tenant\/public\/site\/card\.jpg\?p=%2Fcontact&amp;v=[0-9a-f]{12}" \/>/);
    expect(tags).toContain('<meta property="og:image:width" content="1200" />');
    expect(tags).toContain('<meta property="og:image:height" content="630" />');
    expect(tags).toContain('<meta property="og:image:type" content="image/jpeg" />');
    expect(tags).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(tags).toContain('<meta name="twitter:image"');
    expect(tags).toContain('<meta property="og:image:alt"');
    // No tenant behind this host: still a sentence, never a blank card.
    expect(tags).toContain("<title>Praxis</title>");
    expect(tags).toMatch(/<meta property="og:description" content="[^"]+" \/>/);
  });

  test("the site name is spelled one way, whatever capitals a written title used", () => {
    expect(head.spellName("Sea Freight to Douala and Kribi | SMART LOGISTICS AND SERVICES", "Smart Logistics and Services"))
      .toBe("Sea Freight to Douala and Kribi | Smart Logistics and Services");
    expect(head.spellName("A (b) title", "(b)")).toBe("A (b) title");
    expect(head.spellName("Anything", "")).toBe("Anything");
  });

  test("the sitemap reads the service families, not only a flat list", () => {
    const grouped = {
      groups: [
        { key: "freight", services: [{ slug_en: "sea-freight" }, { slug_en: "air-freight" }] },
        { key: "europe", services: [{ slug_en: "sea-freight" }, { slug_en: "european-road-freight" }] },
      ],
      routing_rules: [{}],
    };
    expect(head.serviceRows(grouped).map((r) => r.slug_en)).toEqual(["sea-freight", "air-freight", "european-road-freight"]);
    expect(head.serviceRows([{ slug_en: "a" }, { slug_fr: "b" }, {}])).toHaveLength(2);
    expect(head.serviceRows(null)).toEqual([]);
  });

  test("the card's address changes with what is drawn on it", () => {
    const view = { headline: "x", photo: null, logo: null, accent: null, font: null };
    const a = head.cardUrl("https://h.test", "h.test", "/", view);
    const b = head.cardUrl("https://h.test", "h.test", "/", { ...view, headline: "y" });
    expect(a).not.toBe(b);
  });
});
