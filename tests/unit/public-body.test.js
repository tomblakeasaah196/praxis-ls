"use strict";

/**
 * What a reader that runs no JavaScript receives, and which paths are pages.
 *
 * Measured on the live site on 26 Nov 2026: an article answered GPTBot with 34
 * words (the `<noscript>` line), and a path that exists nowhere answered 200
 * with the site's title, which every search engine files as a soft 404. These
 * pin both fixes end to end through `makeHtmlSender`, with the tenant's reads
 * stubbed: the served HTML of an article carries its body, and an unknown path
 * or an unknown article answers 404 with `noindex`.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const mockArticle = {
  slug_en: "douala-to-ndjamena",
  title_en: "Douala to N'Djamena by Road",
  excerpt_en: "What the corridor takes, week by week.",
  body_en: "## The border at Kousseri\n\nTrucks cross at **Kousseri** after the Garoua leg.\n\n- Customs at the frontier\n- Escort through the north",
  published_at: "2026-07-27T08:00:00Z",
  author: { name: "A. Writer", title: "Head of Operations" },
  tags: ["corridors"],
  related: [],
};

jest.mock("../../src/config/logger", () => ({
  logger: { warn() {}, info() {}, error() {} },
}));
jest.mock("../../src/services/tenant/registry.service", () => ({
  resolveByHost: async (host) => (host === "site.example" ? { status: "LIVE", tenant_id: "t1" } : null),
  withTenantConnection: async (_meta, _env, fn) => fn({
    async query(sql) {
      if (/FROM site_social_link/.test(sql)) {
        return { rows: [{ url: "https://www.linkedin.com/company/example" }, { url: "https://wa.me/237600000000" }] };
      }
      if (/FROM site_ai_profile/.test(sql)) {
        return { rows: [{ summary: "A freight forwarder in Douala.", alternate_names: ["Example Group"], sectors: ["Mining"], areas_served: ["Chad"] }] };
      }
      return { rows: [] };
    },
  }),
}));
jest.mock("../../src/modules/content/insight/insight.service", () => ({
  getPublic: async (_c, slug) => {
    if (slug === "douala-to-ndjamena") return mockArticle;
    const err = new Error("Article not found");
    err.status = 404;
    throw err;
  },
  listPublic: async () => ({ articles: [mockArticle] }),
}));
jest.mock("../../src/modules/site/site_settings/site_settings.service", () => ({
  getTheme: async () => ({ label_case: "TITLE" }),
  publicAbout: async () => ({
    headline: { en: "Freight Between Europe and Central Africa" },
    summary: { en: "From our own offices in two countries." },
    sections: {},
    leaders: [{ id: "l1", name: "B. Leader", role: { en: "Chief Executive Officer" }, bio: {} }],
  }),
}));
jest.mock("../../src/modules/branding/branding.service", () => ({
  getBranding: async () => ({ name: "Example Logistics", logoUrl: "/api/logo.png" }),
}));
jest.mock("../../src/modules/site/site_content/site_content.service", () => ({
  getPublicCopy: async () => ({ en: {} }),
}));
jest.mock("../../src/modules/site/site_settings/site_switches", () => ({
  load: async () => ({ languages: ["en"], portfolio: false }),
}));
jest.mock("../../src/modules/site/site_brand/site_brand.service", () => ({
  publicLegal: async () => [{
    id: "e1", legal_name: "Example Logistics Ltd", country: "Cameroon", country_code: "CM",
    address_lines: ["1 Port Road", "Douala"], email: "hello@example.test", phone: "+237 600 00 00 00",
    representatives: [],
  }],
  publicDocuments: async () => [],
  publicDocument: async () => {
    const err = new Error("Document not found");
    err.status = 404;
    throw err;
  },
}));
jest.mock("../../src/modules/operations/service_type_web/service_type_web.repo", () => ({
  publicList: async () => [{ slug_en: "sea-freight", name_en: "Sea Freight", short_description_en: "Full and part loads.", group_name_en: "Freight" }],
  publicDetail: async (_c, slug) => (slug === "sea-freight"
    ? { row: { service_type_id: "s1", slug_en: "sea-freight", name_en: "Sea Freight", short_description_en: "Full and part loads.", long_description_en: "We book space **weekly**.", highlights_en: ["Weekly sailings"] }, mediaByRole: new Map() }
    : null),
  publicFaq: async () => [{ question_en: "Do you consolidate?", answer_en: "Yes, every week." }],
}));

const head = require("../../src/shared/http/public-head");
const body = require("../../src/shared/http/public-body");

const SHELL = [
  "<!doctype html>",
  "<html><head>",
  "<title>Praxis</title>",
  '<meta name="robots" content="index, follow" />',
  "</head>",
  '<body><div id="root"></div></body></html>',
].join("\n");

let dir;
let send;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "public-body-"));
  fs.writeFileSync(path.join(dir, "index.html"), SHELL);
  send = head.makeHtmlSender(dir);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** One HTML navigation through the real sender; resolves with what it sent. */
function navigate(urlPath, { host = "site.example", base = "/", query = {} } = {}) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      type() { return this; },
      send(html) { resolve({ status: this.statusCode, html }); return this; },
    };
    const req = { headers: { host }, protocol: "https", path: urlPath, publicBase: base, query };
    send(req, res, () => reject(new Error("fell back to the shell")));
  });
}

describe("the page's text, for a reader that runs no script", () => {
  test("an article's served HTML carries its body, headings, byline and date", async () => {
    const { status, html } = await navigate("/insights/douala-to-ndjamena");
    expect(status).toBe(200);
    const root = html.slice(html.indexOf('<div id="root">'));
    expect(root).toContain("<h1>Douala to N'Djamena by Road</h1>");
    expect(root).toContain('<p><a href="/insights">Insights</a></p>');
    expect(root).toContain("<h2>The border at Kousseri</h2>");
    expect(root).toContain("Trucks cross at <strong>Kousseri</strong> after the Garoua leg.");
    expect(root).toContain("<li>Customs at the frontier</li>");
    expect(root).toContain("A. Writer, Head of Operations");
    expect(root).toContain('<time datetime="2026-07-27">27 July 2026</time>');
    // Inside the block the shell hides from scripted visitors, not loose in #root.
    expect(html).toContain('<div id="root"><div data-prerender>');
  });

  test("every page carries the navigation and footer as plain links", async () => {
    const { html } = await navigate("/insights/douala-to-ndjamena");
    expect(html).toMatch(/<header><a href="\/">Example Logistics<\/a><nav>/);
    expect(html).toContain('href="/services"');
    expect(html).toContain('href="/legal/impressum"');
    expect(html).toContain('<a href="mailto:hello@example.test">');
    // A social PROFILE is linked; a WhatsApp chat link is not a profile.
    expect(html).toContain('rel="me" href="https://www.linkedin.com/company/example"');
    expect(html).not.toContain("wa.me");
  });

  test("the services index and a service page print their own words", async () => {
    const index = await navigate("/services");
    expect(index.html).toContain('<a href="/services/sea-freight">Sea Freight</a><p>Full and part loads.</p>');
    const page = await navigate("/services/sea-freight");
    expect(page.status).toBe(200);
    expect(page.html).toContain("We book space <strong>weekly</strong>.");
    expect(page.html).toContain("<li>Weekly sailings</li>");
    expect(page.html).toContain("<dt>Do you consolidate?</dt><dd>Yes, every week.</dd>");
  });

  test("the About page prints its headline, summary and leadership", async () => {
    const { html } = await navigate("/about");
    expect(html).toContain("<h1>Freight Between Europe and Central Africa</h1>");
    expect(html).toContain("From our own offices in two countries.");
    expect(html).toContain("B. Leader, Chief Executive Officer");
  });

  test("text is escaped: a record cannot inject markup", () => {
    const out = body.applyBody(SHELL, "<p>" + "x".repeat(3) + "</p>");
    expect(out).toContain('<div id="root"><div data-prerender><p>xxx</p></div></div>');
    expect(body.applyBody(SHELL, null)).toBe(SHELL);
  });
});

describe("real 404s", () => {
  test("a path no route answers is a 404 with noindex, and still the app's shell", async () => {
    const { status, html } = await navigate("/this-page-does-not-exist-xyz");
    expect(status).toBe(404);
    expect(html).toContain('<meta name="robots" content="noindex" />');
    expect(html).not.toContain('content="index, follow"');
    // The app reads its base from this tag, so the not-found page's links work.
    expect(html).toContain('<meta name="praxis:public-base" content="/" />');
    expect(html).toContain('<div id="root"></div>');
  });

  test("a route whose record does not exist is a 404 too", async () => {
    const article = await navigate("/insights/no-such-article");
    expect(article.status).toBe(404);
    expect(article.html).toContain('content="noindex"');
    const service = await navigate("/services/no-such-service");
    expect(service.status).toBe(404);
    const doc = await navigate("/trust/no-such-policy");
    expect(doc.status).toBe(404);
    // A section the tenant switched off answers the not-found page.
    expect((await navigate("/portfolio")).status).toBe(404);
  });

  test("a preview of another environment is never called missing", async () => {
    const { status } = await navigate("/insights/no-such-article", { query: { e: "sandbox" } });
    expect(status).toBe(200);
  });

  test("deep links that render without a public record stay 200", async () => {
    for (const p of ["/portal", "/portal/login", "/v/ABC123DEF456", "/q/some-token", "/careers/tok123", "/careers/alerts/unsubscribe/tok", "/profile/tok", "/kaizen/old-slug", "/client-portal/x"]) {
      expect(body.isKnownPath(p, "/")).toBe(true);
    }
  });
});

describe("isKnownPath against the router", () => {
  const router = fs.readFileSync(path.resolve(__dirname, "../../public-web/src/app/router.tsx"), "utf8");
  const sample = (route) => route.replace(/:[A-Za-z]+/g, "x").replace(/\*$/, "x").replace(/\/+$/, "") || "/";

  test("every route in public-web's router is a known path, on the root and under a prefix", () => {
    const prefixed = [...router.matchAll(/path=\{p\("([^"]*)"\)\}/g)].map((m) => m[1]);
    const absolute = [...router.matchAll(/path="([^"]+)"/g)].map((m) => m[1]).filter((r) => r !== "*");
    expect(prefixed.length).toBeGreaterThan(15);
    for (const r of prefixed) {
      expect([r, body.isKnownPath(sample(r) || "/", "/")]).toEqual([r, true]);
      expect([r, body.isKnownPath("/site" + (r ? sample(r) : ""), "/site")]).toEqual([r, true]);
    }
    for (const r of absolute) {
      expect([r, body.isKnownPath(sample(r), "/site")]).toEqual([r, true]);
    }
    // `p()` with no argument is the home page.
    expect(body.isKnownPath("/", "/")).toBe(true);
    expect(body.isKnownPath("/site", "/site")).toBe(true);
    // The original prefix redirects when the tenant renamed it.
    expect(body.isKnownPath("/public/about", "/site")).toBe(true);
  });

  test("anything else is unknown, and matching ignores case like the router", () => {
    expect(body.isKnownPath("/this-page-does-not-exist-xyz", "/")).toBe(false);
    expect(body.isKnownPath("/insights/a/b", "/")).toBe(false);
    expect(body.isKnownPath("/wp-login.php", "/")).toBe(false);
    expect(body.isKnownPath("/About", "/")).toBe(true);
    // A workspace host's prefix: outside it nothing here is a page.
    expect(body.isKnownPath("/about", "/public")).toBe(false);
  });
});

describe("sameAs takes profiles only", () => {
  test("WhatsApp, phone and mail links are dropped", () => {
    expect(body.socialProfiles([
      "https://www.linkedin.com/company/x",
      "https://wa.me/2376",
      "https://api.whatsapp.com/send?phone=1",
      "tel:+2376",
      "mailto:a@b.c",
      "https://facebook.com/x",
    ])).toEqual(["https://www.linkedin.com/company/x", "https://facebook.com/x"]);
  });
});
