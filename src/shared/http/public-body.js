"use strict";

/**
 * What a reader that runs no JavaScript finds inside `#root`.
 *
 * `public-head.js` gave every page a real `<head>`; the body stayed empty, so
 * GPTBot, ClaudeBot and PerplexityBot (which run no script, unlike Google)
 * read 34 words on every page: the `<noscript>` line. On 26 Nov 2026 the
 * eighteen articles, the About page and every service were invisible to them.
 *
 * This prints the page's own text into the shell the server already sends:
 * the article with its headings, byline and date; the About page; each service;
 * the indexes as linked lists; the trust documents; the contact details. And
 * the site's navigation and footer as plain links, so a crawler that lands on
 * one page can reach the rest.
 *
 * ── NOT A SECOND WEBSITE ────────────────────────────────────────────────────
 *
 * Everything here is read through the SAME public reads the pages call, from
 * the tenant's own records, so the text a crawler is given is the text a
 * visitor reads. No layout, no styling: React's `createRoot` empties `#root` on
 * its first render and draws the designed page in its place. For a visitor
 * with JavaScript the block is `display: none` from the shell's own stylesheet
 * (`public-web/index.html`), so it never flashes; the text is the same either
 * way, which is what separates this from cloaking.
 *
 * ── NOTHING HERE IS ONE TENANT'S WORDS ─────────────────────────────────────
 *
 * Headings and link labels are the website's Wording (`site.nav.*`,
 * `site.footer.*`, the Link Previews titles), read with the tenant's overrides
 * through `public-head-share`, exactly as the site prints them.
 *
 * ── WHICH PATHS ARE PAGES ───────────────────────────────────────────────────
 *
 * `isKnownPath` is the server's copy of `public-web/src/app/router.tsx`, so an
 * HTML navigation to a path no route matches can answer 404 rather than a
 * 200 that every search engine reads as a soft 404. A route added to the
 * router and not here would answer 404 while the page renders, so
 * `tests/unit/public-body.test.js` reads the router and fails on the gap.
 */

const paths = require("./public-web-paths");
const shareCopy = require("./public-head-share");
const { titleCase } = require("../../../packages/shared/text/title-case");

/* ── the router, as patterns ─────────────────────────────────────────────────*/

/** Base-relative pages: `p("/about")` in the router. */
const PAGE_PATTERNS = [
  /^\/?$/,
  /^\/track\/?$/,
  /^\/verify\/?$/,
  /^\/about\/?$/,
  /^\/services\/?$/,
  /^\/services\/[^/]+\/?$/,
  /^\/portfolio\/?$/,
  /^\/portfolio\/[^/]+\/?$/,
  /^\/q\/[^/]+\/?$/,
  /^\/proposals\/[^/]+\/?$/,
  /^\/profile\/[^/]+\/?$/,
  /^\/insights\/?$/,
  /^\/insights\/[^/]+\/?$/,
  /^\/careers\/?$/,
  /^\/careers\/alerts\/unsubscribe\/[^/]+\/?$/,
  /^\/careers\/[^/]+\/?$/,
  /^\/quote\/?$/,
  /^\/contact\/?$/,
  /^\/partners\/?$/,
  /^\/trust\/?$/,
  /^\/trust\/[^/]+\/?$/,
  /^\/legal\/impressum\/?$/,
  /^\/legal\/privacy\/?$/,
];

/** Unprefixed routes the router answers on every host. */
const ABSOLUTE_PATTERNS = [
  /^\/v\/[^/]+\/?$/,
  /^\/portal(\/.*)?$/,
  /^\/kaizen\/?$/,
  /^\/kaizen\/[^/]+\/?$/,
  /^\/tracking\/?$/,
  /^\/proposal\/[^/]+\/?$/,
  /^\/client-portal(\/.*)?$/,
];

/** The legacy redirects, answered only when the site is NOT at the root. */
const LEGACY_PATTERNS = [
  /^\/?$/,
  /^\/track\/?$/,
  /^\/portfolio\/?$/,
  /^\/portfolio\/[^/]+\/?$/,
  /^\/proposals\/[^/]+\/?$/,
  /^\/careers\/?$/,
  /^\/careers\/[^/]+\/?$/,
];

/**
 * True when `public-web`'s router has a route for `urlPath` on a host whose
 * marketing base is `base`. Case-insensitive, like react-router's matching.
 */
function isKnownPath(urlPath, base) {
  const p = String(urlPath || "/");
  const test = (list, s) => list.some((re) => new RegExp(re.source, "i").test(s));
  if (test(ABSOLUTE_PATTERNS, p)) return true;
  const rel = paths.stripBase(p, base);
  if (rel !== null && test(PAGE_PATTERNS, rel)) return true;
  if (!paths.isRoot(base)) {
    if (test(LEGACY_PATTERNS, p)) return true;
    // The original `/public` prefix, kept for good when a tenant renamed it.
    const norm = paths.normaliseBase(base) || paths.DEFAULT_BASE;
    if (norm !== paths.DEFAULT_BASE && (p === paths.DEFAULT_BASE || p.startsWith(paths.DEFAULT_BASE + "/"))) return true;
  }
  return false;
}

/* ── small HTML helpers ──────────────────────────────────────────────────────*/

const esc = (s) =>
  String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const pick = (...vals) => vals.map((v) => String(v || "").trim()).find(Boolean) || null;
const en = (node) => (node && typeof node === "object" ? pick(node.en, node.fr) : pick(node));

/** The trust documents' own renderer: escapes first, so the only markup in
 *  the output is markup it wrote, and refuses any link that is not http(s) or
 *  mailto. Required lazily: it brings the document kit with it. */
const markdown = (src) => require("../../modules/site/site_brand/site_brand.pdf").markdownToHtml(src);

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** `<time>` with the ISO day for machines and the day-first date for people. */
function timeTag(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return '<time datetime="' + d.toISOString().slice(0, 10) + '">' + esc(DAY.format(d)) + "</time>";
}

const link = (href, label) => '<a href="' + esc(href) + '">' + esc(label) + "</a>";
const para = (text) => (pick(text) ? "<p>" + esc(text) + "</p>" : "");
const heading = (level, text) => (pick(text) ? `<h${level}>${esc(text)}</h${level}>` : "");
const list = (items) => (items.length ? "<ul>" + items.map((i) => "<li>" + i + "</li>").join("") + "</ul>" : "");

/* ── the site's chrome: navigation and footer ────────────────────────────────*/

/**
 * The header's and footer's links, the way `site-header.tsx` and
 * `site-footer.tsx` list them, with the tenant's wording.
 */
function chrome(ctx) {
  const { share, at, name, switches, legal, social } = ctx;
  const label = (key) => {
    const t = share.text(key) || "";
    return share.titles ? titleCase(t, "en") : t;
  };
  const nav = [
    [at("/about"), "site.nav.about"],
    [at("/services"), "site.nav.services"],
    [at("/track"), "site.nav.track"],
    switches.portfolio ? [at("/portfolio"), "site.nav.portfolio"] : null,
    [at("/insights"), "site.nav.insights"],
    switches.careers_in_header ? [at("/careers"), "site.nav.careers"] : null,
    [at("/contact"), "site.nav.contact"],
  ].filter(Boolean);
  const foot = [
    [at("/quote"), "site.footer.quote"],
    [at("/track"), "site.footer.track"],
    [at("/about"), "site.footer.about"],
    [at("/partners"), "site.footer.partners"],
    [at("/verify"), "site.footer.verify"],
    [at("/careers"), "site.footer.careers"],
    [at("/contact"), "site.footer.contact"],
    [at("/trust"), "site.footer.trust"],
    [at("/legal/impressum"), "site.footer.impressum"],
    [at("/legal/privacy"), "site.footer.privacy"],
  ];
  const first = legal.find((e) => e.email || e.phone) || null;
  const contact = first
    ? [
      first.email ? '<a href="mailto:' + esc(first.email) + '">' + esc(first.email) + "</a>" : null,
      first.phone ? '<a href="tel:' + esc(String(first.phone).replace(/[^\d+]/g, "")) + '">' + esc(first.phone) + "</a>" : null,
    ].filter(Boolean).join(" ")
    : "";
  const header =
    "<header>" + link(at(""), name) +
    "<nav><ul>" + nav.map(([href, key]) => "<li>" + link(href, label(key)) + "</li>").join("") + "</ul></nav>" +
    "</header>";
  const footer =
    "<footer><nav><ul>" + foot.map(([href, key]) => "<li>" + link(href, label(key)) + "</li>").join("") + "</ul></nav>" +
    (contact ? "<address>" + contact + "</address>" : "") +
    (social.length ? "<p>" + social.map((u) => '<a rel="me" href="' + esc(u) + '">' + esc(u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "")) + "</a>").join(" ") + "</p>" : "") +
    "</footer>";
  return { header, footer };
}

/* ── the pages ───────────────────────────────────────────────────────────────*/

/** Every published service, once each, as the services list orders them. */
async function services(client) {
  const repo = require("../../modules/operations/service_type_web/service_type_web.repo");
  const { serviceRows } = require("./public-head");
  return serviceRows(await repo.publicList(client));
}

const serviceName = (r) => pick(r.web_name_en, r.name_en, r.web_name_fr, r.name_fr);
const serviceSlug = (r) => r.slug_en || r.slug_fr;

async function articles(client, perPage = 500) {
  const view = await require("../../modules/content/insight/insight.service")
    .listPublic(client, { page: 1, perPage });
  return (view && view.articles) || [];
}

function articleItem(a, at) {
  const title = pick(a.title_en, a.title_fr);
  const slug = a.slug_en || a.slug_fr;
  if (!title || !slug) return null;
  const excerpt = pick(a.excerpt_en, a.excerpt_fr);
  return link(at("/insights/" + encodeURIComponent(slug)), title) +
    (a.published_at ? " " + timeTag(a.published_at) : "") +
    (excerpt ? "<p>" + esc(excerpt) + "</p>" : "");
}

/** A page whose content is interactive (a form, a tracker): its title and its
 *  Link Previews sentence, so the page still says what it is for. */
const plain = (stem) => async (client, m, ctx) => {
  const words = shareCopy.page(ctx.share, stem);
  return heading(1, words.title || ctx.name) + para(words.description);
};

const PAGES = [
  {
    test: /^\/?$/,
    render: async (client, m, ctx) => {
      const words = shareCopy.page(ctx.share, "home");
      const svc = await services(client).catch(() => []);
      const latest = await articles(client, 6).catch(() => []);
      const label = (key) => ctx.label(key);
      return heading(1, words.title || ctx.name) + para(words.description) +
        (svc.length ? heading(2, label("site.nav.services")) +
          list(svc.map((r) => link(ctx.at("/services/" + encodeURIComponent(serviceSlug(r))), serviceName(r)) +
            (pick(r.short_description_en, r.short_description_fr) ? "<p>" + esc(pick(r.short_description_en, r.short_description_fr)) + "</p>" : ""))) : "") +
        (latest.length ? heading(2, label("site.nav.insights")) + list(latest.map((a) => articleItem(a, ctx.at)).filter(Boolean)) : "");
    },
  },
  {
    test: /^\/about\/?$/,
    render: async (client, m, ctx) => {
      const about = await require("../../modules/site/site_settings/site_settings.service").publicAbout(client);
      const s = about.sections || {};
      const words = shareCopy.page(ctx.share, "about");
      const out = [heading(1, en(about.headline) || words.title || ctx.name), para(en(about.summary))];
      if (Array.isArray(s.credentials) && s.credentials.length) {
        out.push(list(s.credentials.map((c) => esc([en(c.label), en(c.value)].filter(Boolean).join(": "))).filter(Boolean)));
      }
      if (s.story) {
        out.push(heading(2, en(s.story.title)));
        for (const p of s.story.paragraphs || []) out.push(para(en(p)));
      }
      out.push(para(en(about.mission)), para(en(about.vision)));
      if (s.message) {
        out.push(heading(2, en(s.message.title)));
        for (const p of s.message.paragraphs || []) out.push(para(en(p)));
        const signed = (about.leaders || []).find((l) => l.id === s.message.leader_id);
        if (signed) out.push(para([signed.name, en(signed.role)].filter(Boolean).join(", ")));
      }
      if (s.offices && Array.isArray(s.offices.items) && s.offices.items.length) {
        out.push(heading(2, en(s.offices.title)));
        for (const o of s.offices.items) {
          const entity = ctx.legal.find((e) => e.id === o.entity_id);
          out.push(heading(3, en(o.heading) || (entity && entity.country)));
          if (en(o.label)) out.push(para(en(o.label)));
          if (entity && entity.address_lines && entity.address_lines.length) out.push("<address>" + entity.address_lines.map(esc).join("<br>") + "</address>");
          if (en(o.services)) out.push(para(en(o.services)));
        }
      }
      if (s.sectors && Array.isArray(s.sectors.items) && s.sectors.items.length) {
        out.push(heading(2, en(s.sectors.title)));
        out.push(list(s.sectors.items.map((i) => "<strong>" + esc(en(i.title)) + "</strong>" + (en(i.text) ? " " + esc(en(i.text)) : ""))));
      }
      if (s.standards) out.push(heading(2, en(s.standards.title)), para(en(s.standards.text)));
      const leaders = (about.leaders || []).filter((l) => l.name);
      if (leaders.length) {
        out.push(list(leaders.map((l) =>
          "<strong>" + esc([l.name, en(l.role)].filter(Boolean).join(", ")) + "</strong>" + (en(l.bio) ? "<p>" + esc(en(l.bio)) + "</p>" : ""))));
      }
      if (s.closing) out.push(heading(2, en(s.closing.title)), para(en(s.closing.text)));
      return out.join("");
    },
  },
  {
    test: /^\/services\/?$/,
    render: async (client, m, ctx) => {
      const words = shareCopy.page(ctx.share, "services");
      const rows = await services(client);
      const groups = new Map();
      for (const r of rows) {
        const g = pick(r.group_name_en, r.group_name_fr) || "";
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(r);
      }
      const item = (r) => link(ctx.at("/services/" + encodeURIComponent(serviceSlug(r))), serviceName(r)) +
        (pick(r.short_description_en, r.short_description_fr) ? "<p>" + esc(pick(r.short_description_en, r.short_description_fr)) + "</p>" : "");
      return heading(1, words.title) + para(words.description) +
        Array.from(groups.entries()).map(([g, items]) => heading(2, g) + list(items.map(item))).join("");
    },
  },
  {
    test: /^\/services\/([^/]+)\/?$/,
    render: async (client, m, ctx) => {
      const repo = require("../../modules/operations/service_type_web/service_type_web.repo");
      const detail = await repo.publicDetail(client, decodeURIComponent(m[1]));
      if (!detail || !detail.row) return { notFound: true };
      const r = detail.row;
      const faq = await repo.publicFaq(client, r.service_type_id).catch(() => []);
      const highlights = (Array.isArray(r.highlights_en) && r.highlights_en.length ? r.highlights_en : r.highlights_fr) || [];
      const out = [
        heading(1, serviceName(r)),
        para(pick(r.short_description_en, r.short_description_fr)),
        markdown(pick(r.long_description_en, r.long_description_fr) || ""),
      ];
      const hl = highlights.map((h) => (typeof h === "string" ? h : en(h) || pick(h && h.text))).filter(Boolean);
      if (hl.length) out.push(list(hl.map(esc)));
      out.push(markdown(pick(r.coverage_en, r.coverage_fr) || ""));
      const qa = (faq || []).filter((f) => pick(f.question_en, f.question_fr));
      if (qa.length) {
        out.push("<dl>" + qa.map((f) => "<dt>" + esc(pick(f.question_en, f.question_fr)) + "</dt><dd>" + esc(pick(f.answer_en, f.answer_fr) || "") + "</dd>").join("") + "</dl>");
      }
      out.push("<p>" + link(ctx.at("/quote"), ctx.label("site.footer.quote")) + "</p>");
      return out.join("");
    },
  },
  {
    test: /^\/insights\/?$/,
    render: async (client, m, ctx) => {
      const words = shareCopy.page(ctx.share, "insights");
      const rows = await articles(client);
      return heading(1, words.title) + para(words.description) + list(rows.map((a) => articleItem(a, ctx.at)).filter(Boolean));
    },
  },
  {
    test: /^\/insights\/([^/]+)\/?$/,
    render: async (client, m, ctx) => {
      let a;
      try {
        a = await require("../../modules/content/insight/insight.service").getPublic(client, decodeURIComponent(m[1]));
      } catch (err) {
        if (err && (err.status === 404 || err.statusCode === 404)) return { notFound: true };
        throw err;
      }
      const title = pick(a.title_en, a.title_fr);
      const byline = a.author ? [a.author.name, a.author.title].filter(Boolean).join(", ") : null;
      const meta = [byline ? esc(byline) : null, a.published_at ? timeTag(a.published_at) : null].filter(Boolean).join(" | ");
      const related = (a.related || []).map((r) => articleItem(r, ctx.at)).filter(Boolean);
      const tags = Array.isArray(a.tags) ? a.tags.filter(Boolean) : [];
      return "<article>" + heading(1, title) +
        (meta ? "<p>" + meta + "</p>" : "") +
        para(pick(a.excerpt_en, a.excerpt_fr)) +
        markdown(pick(a.body_en, a.body_fr) || "") +
        (tags.length ? "<p>" + tags.map(esc).join(", ") + "</p>" : "") +
        "</article>" +
        (related.length ? list(related) : "") +
        "<p>" + link(ctx.at("/insights"), ctx.label("site.nav.insights")) + "</p>";
    },
  },
  {
    test: /^\/trust\/?$/,
    render: async (client, m, ctx) => {
      const words = shareCopy.page(ctx.share, "trust");
      const docs = await require("../../modules/site/site_brand/site_brand.service").publicDocuments(client, { lang: "en" });
      return heading(1, words.title) + para(words.description) +
        list((docs || []).filter((d) => d.key && d.title).map((d) =>
          link(ctx.at("/trust/" + encodeURIComponent(d.key)), d.title) + (d.summary ? "<p>" + esc(d.summary) + "</p>" : "")));
    },
  },
  {
    test: /^\/trust\/([^/]+)\/?$/,
    render: (client, m) => documentPage(client, decodeURIComponent(m[1])),
  },
  {
    test: /^\/legal\/privacy\/?$/,
    render: (client) => documentPage(client, "privacy-policy"),
  },
  {
    test: /^\/legal\/impressum\/?$/,
    render: async (client, m, ctx) =>
      heading(1, ctx.label("site.footer.impressum")) +
      ctx.legal.map((e) =>
        heading(2, [e.legal_name, e.legal_form].filter(Boolean).join(" ")) +
        (e.address_lines && e.address_lines.length ? "<address>" + e.address_lines.map(esc).join("<br>") + "</address>" : "") +
        list([
          ...(e.representatives || []).map((p) => esc([p.name, p.title].filter(Boolean).join(", "))),
          e.register ? esc([e.register.authority, e.register.number].filter(Boolean).join(" ")) : null,
          e.vat_id ? esc(e.vat_id) : null,
          e.email ? esc(e.email) : null,
          e.phone ? esc(e.phone) : null,
        ].filter(Boolean))).join(""),
  },
  {
    test: /^\/contact\/?$/,
    render: async (client, m, ctx) => {
      const words = shareCopy.page(ctx.share, "contact");
      return heading(1, words.title) + para(words.description) +
        ctx.legal.map((e) =>
          heading(2, e.country ? e.country : e.legal_name) +
          (e.address_lines && e.address_lines.length ? "<address>" + e.address_lines.map(esc).join("<br>") + "</address>" : "") +
          list([
            e.phone ? '<a href="tel:' + esc(String(e.phone).replace(/[^\d+]/g, "")) + '">' + esc(e.phone) + "</a>" : null,
            e.email ? '<a href="mailto:' + esc(e.email) + '">' + esc(e.email) + "</a>" : null,
          ].filter(Boolean))).join("");
    },
  },
  {
    test: /^\/careers\/?$/,
    render: async (client, m, ctx) => {
      const words = shareCopy.page(ctx.share, "careers");
      const open = await require("../../modules/hr/careers/careers.service").list(client).catch(() => []);
      return heading(1, words.title) + para(words.description) +
        list((open || []).filter((v) => v.token && v.title).map((v) =>
          link(ctx.at("/careers/" + encodeURIComponent(v.token)), v.title) + (v.location ? " " + esc(v.location) : "")));
    },
  },
  {
    test: /^\/portfolio\/?$/,
    render: async (client, m, ctx) => {
      if (!ctx.switches.portfolio) return { notFound: true };
      const words = shareCopy.page(ctx.share, "portfolio");
      const stories = await require("../../modules/sales/portfolio_public/portfolio_public.service").list(client).catch(() => []);
      return heading(1, words.title) + para(words.description) +
        list((stories || []).filter((s) => s.slug && s.title).map((s) => link(ctx.at("/portfolio/" + encodeURIComponent(s.slug)), s.title)));
    },
  },
  {
    test: /^\/portfolio\/([^/]+)\/?$/,
    render: async (client, m, ctx) => {
      if (!ctx.switches.portfolio) return { notFound: true };
      const s = await require("../../modules/sales/portfolio_public/portfolio_public.service").get(client, decodeURIComponent(m[1]));
      if (!s) return { notFound: true };
      return heading(1, s.title) + para(s.headline) + para(s.executive_summary);
    },
  },
  { test: /^\/partners\/?$/, render: plain("partners") },
  { test: /^\/quote\/?$/, render: plain("quote") },
  { test: /^\/track\/?$/, render: plain("track") },
  { test: /^\/verify\/?$/, render: plain("verify") },
];

async function documentPage(client, key) {
  let doc;
  try {
    doc = await require("../../modules/site/site_brand/site_brand.service").publicDocument(client, { key, lang: "en" });
  } catch (err) {
    if (err && (err.status === 404 || err.statusCode === 404)) return { notFound: true };
    throw err;
  }
  if (!doc) return { notFound: true };
  return "<article>" + heading(1, doc.title) + para(doc.summary) + markdown(doc.body || "") + "</article>";
}

/* ── the entry point ─────────────────────────────────────────────────────────*/

/**
 * The body for one page: `{ html, notFound }`.
 *
 *   · `html` is the markup for inside `#root`, or null when this page has
 *     nothing to print (a private token page, the portal) or anything failed.
 *   · `notFound` is true only when the page's record is KNOWN to be absent: an
 *     unknown or unpublished slug, a switched-off section. A failed read is
 *     not a 404; it is the shell, as it always was.
 *
 * @param {(fn: (client) => Promise) => Promise} withClient  the tenant's LIVE
 *   connection, or a promise of null when the host has no live tenant.
 */
async function render(withClient, rel, base) {
  if (rel === null) return { html: null, notFound: false };
  const page = PAGES.find((p) => p.test.test(rel));
  if (!page) return { html: null, notFound: false };
  const m = page.test.exec(rel);
  const at = (rest) => paths.joinBase(base, rest);

  const result = await withClient(async (client) => {
    const theme = await require("../../modules/site/site_settings/site_settings.service").getTheme(client).catch(() => null);
    const share = await shareCopy.load(client, { titles: !theme || theme.label_case !== "AS_WRITTEN" }).catch(() => shareCopy.empty());
    const branding = await require("../../modules/branding/branding.service").getBranding(client).catch(() => null);
    const switches = await require("../../modules/site/site_settings/site_switches").load(client).catch(() => ({}));
    const legal = await require("../../modules/site/site_brand/site_brand.service").publicLegal(client).catch(() => []);
    const { rows: socialRows } = await client.query("SELECT url FROM site_social_link ORDER BY platform")
      .catch(() => ({ rows: [] }));
    const ctx = {
      share,
      at,
      switches: switches || {},
      legal: legal || [],
      social: socialProfiles(socialRows.map((r) => r.url)),
      name: shareCopy.siteName(share, branding),
      label: (key) => {
        const t = share.text(key) || "";
        return share.titles ? titleCase(t, "en") : t;
      },
    };
    const out = await page.render(client, m, ctx);
    if (out && typeof out === "object" && out.notFound) return { html: null, notFound: true };
    const { header, footer } = chrome(ctx);
    return { html: header + "<main>" + out + "</main>" + footer, notFound: false };
  });
  return result || { html: null, notFound: false };
}

/**
 * The social links that are PROFILES: an http(s) page about the company.
 * A WhatsApp chat link, a phone number or an address is a way to reach the
 * company, not a page that says who it is, and `sameAs` claims identity.
 */
function socialProfiles(urls) {
  return (urls || [])
    .map((u) => String(u || "").trim())
    .filter((u) => /^https?:\/\//i.test(u))
    .filter((u) => {
      try {
        const h = new URL(u).hostname.toLowerCase().replace(/^www\./, "");
        return !(h === "wa.me" || h === "whatsapp.com" || h.endsWith(".whatsapp.com"));
      } catch {
        return false;
      }
    });
}

/**
 * Put `inner` inside the shell's `#root`. Wrapped in `data-prerender`, which
 * the shell's stylesheet hides once scripts run; React replaces it either way.
 */
function applyBody(html, inner) {
  if (!inner) return html;
  return html.replace(
    /<div id="root"><\/div>/,
    '<div id="root"><div data-prerender>' + inner + "</div></div>",
  );
}

module.exports = {
  isKnownPath,
  render,
  applyBody,
  socialProfiles,
  PAGE_PATTERNS,
  ABSOLUTE_PATTERNS,
  LEGACY_PATTERNS,
};
