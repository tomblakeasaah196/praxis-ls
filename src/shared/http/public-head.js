"use strict";

/**
 * What a crawler and a chat app see.
 *
 * `public-web/` assembles its pages in the browser, so anything that does not run
 * JavaScript — Slack, WhatsApp, LinkedIn, Bing — receives the shell:
 * `<title>Praxis</title>` and an empty `<div id="root">`. A forwarded proposal
 * link, which is the most-shared URL this product produces, arrives as a blank
 * grey card carrying the vendor's name rather than the tenant's.
 *
 * This module fixes the half that needs no rendering engine: the `<head>`. The
 * server already answers these paths with `index.html`; it now answers with an
 * `index.html` whose title, description, canonical and Open Graph tags describe
 * the actual page. The body is still empty, so this is not SSR and does not
 * pretend to be — but a preview card and a search result are built from the head,
 * and the head was what was missing.
 *
 * WHY A DATABASE READ IS SAFE HERE. Only for HTML navigations (assets never
 * reach this), only for the three paths in ROUTES, memoised per host+path, and
 * wrapped so that ANY failure serves the untouched shell. A page without preview
 * tags is a poor card; a page that 500s because the registry hiccuped is a broken
 * site. The fallback is always the file.
 */

const fs = require("fs");
const path = require("path");
const registry = require("../../services/tenant/registry.service");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const paths = require("./public-web-paths");
const crypto = require("crypto");
const brandHeads = require("./public-head-brand");
const shareCopy = require("./public-head-share");
const shareCard = require("../../services/share-card/share-card.service");

/**
 * Hosts that must answer `noindex` and a blanket robots Disallow.
 *
 * `doc/PUBLIC_WEB_PLAN.md` §3.7: a staging copy competing with production in
 * search results is worse than no staging at all. It is the same content under
 * a different name, so a crawler treats it as a duplicate and may rank the
 * rehearsal instead of the real thing — discovered by the tenant when a
 * customer books against a test database.
 *
 * Read once at module load: this is deployment configuration, and a process
 * that needs a different answer is a process that needs restarting anyway.
 */
const NOINDEX_HOSTS = new Set(
  String(config.SEO_NOINDEX_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase().split(":")[0])
    .filter(Boolean),
);

/**
 * A host whose FIRST label names a rehearsal is noindex without being listed:
 * staging.smartls.cm served `index, follow` on 25 Nov 2026 because nobody had
 * added it to SEO_NOINDEX_HOSTS, and would have become a crawlable duplicate of
 * smartlsgroup.com the moment that domain's robots.txt was fixed. A list
 * somebody must remember to extend is the failure; the name already says it.
 */
const REHEARSAL_LABELS = new Set(["staging", "dev", "test", "preview", "sandbox"]);

const isNoindexHost = (host) => {
  const h = String(host || "").toLowerCase().split(":")[0];
  return NOINDEX_HOSTS.has(h) || (h.includes(".") && REHEARSAL_LABELS.has(h.split(".")[0]));
};

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 500;
const cache = new Map();

function memo(key, produce) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value);
  return Promise.resolve(produce()).then((value) => {
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
    cache.set(key, { value, expires: Date.now() + TTL_MS });
    return value;
  });
}

/** Drop a host's memoised heads — called when its registry row changes. */
function invalidateHost(host) {
  for (const k of Array.from(cache.keys())) {
    if (k.startsWith(String(host) + " ")) cache.delete(k);
  }
}

const esc = (s) =>
  String(s === null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** One line of text, no markup, trimmed to what a card will actually show. */
function summarise(input, max = 200) {
  const flat = String(input || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

async function withTenant(host, fn) {
  const meta = await registry.resolveByHost(host);
  if (!meta || meta.status !== "LIVE") return null;
  // LIVE schema, always: these pages are the shop window, and a sandbox row has
  // no business being described to a crawler. Mirrors `req.tenantDbIn("live")`,
  // which every public route already pins itself to.
  return registry.withTenantConnection(meta, "live", fn);
}

/**
 * Each entry turns a path into `{ title, description, image }`, or null when the
 * record is not published — in which case the shell's own defaults stand rather
 * than a card describing a page the reader cannot open.
 *
 * The patterns are BASE-RELATIVE — `/portfolio/:slug`, not
 * `/public/portfolio/:slug` — and `headFor` strips the host's base before
 * matching. They were absolute once, which meant a tenant who renamed the prefix
 * to `/site`, or brought their own domain (where the site is served at the
 * root), silently lost every link preview: the regex stopped matching and every
 * page fell back to the shell's generic title. Nothing errored; the cards just
 * went blank.
 */
/**
 * JSON-LD, and why it is built here rather than in the browser.
 *
 * Structured data is read by crawlers that do not run JavaScript — the same
 * readers this whole module exists for. A `<script type="application/ld+json">`
 * appended by React is invisible to every one of them, which makes a
 * client-side implementation of §3.7 look complete and do nothing.
 *
 * ── ESCAPING IS NOT THE SAME PROBLEM AS THE META TAGS ─────────────────────
 *
 * `esc()` above produces HTML-attribute-safe text. Inside a `<script>` block
 * that is both wrong and unsafe: `&amp;` would be printed literally into the
 * JSON, and — the real hazard — a value containing `</script>` would close the
 * block early and everything after it would be parsed as markup. So the payload
 * is JSON.stringify'd and only the one sequence that can break out is escaped.
 * `<!--` gets the same treatment for the same reason.
 */
function ldScript(payload) {
  if (!payload) return null;
  const json = JSON.stringify(payload)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  return '<script type="application/ld+json">' + json + "</script>";
}

/** Drop null/undefined/empty members so a sparse record does not emit
 *  `"description": null`, which validators flag and which tells a crawler the
 *  field was answered rather than absent. */
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

const absolute = (origin, url) =>
  !url ? null : /^https?:\/\//i.test(url) ? url : origin + url;

/**
 * The tenant, sitewide. Every public page carries it.
 *
 * `Organization` rather than `LocalBusiness`: a freight forwarder operating
 * through several ports is not one storefront, and claiming an address we do
 * not hold would be worse than claiming none. Name and logo are what branding
 * actually knows.
 */
function organizationLd(branding, origin, org = null) {
  const name = (branding && branding.name) || null;
  if (!name) return null;
  // PR 4 (14660): the offices as Places with their addresses, the founding
  // year, a contact and the social profiles, all from the tenant's own records
  // (`public-head-brand.offices`). The registered office is the `address`;
  // every office, that one included, is a `location`.
  const places = (org && org.places) || [];
  return compact({
    "@context": "https://schema.org",
    "@type": "Organization",
    name,
    url: origin,
    logo: absolute(origin, branding && branding.logoUrl),
    foundingDate: org && org.founded,
    email: org && org.email,
    telephone: org && org.phone,
    address: places[0] ? places[0].address : null,
    location: places.length > 1 ? places : null,
    sameAs: org && org.sameAs,
  });
}

/**
 * Where this page sits, for anything nested.
 *
 * Emitted only for a DETAIL page, because that is the only place a breadcrumb
 * is true: the index is one level down from home and a two-item trail restating
 * the page's own title is noise a validator will happily accept and no reader
 * benefits from.
 */
function breadcrumbLd(origin, base, trail) {
  if (!trail || trail.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, i) => compact({
      "@type": "ListItem",
      position: i + 1,
      name: step.name,
      item: step.path === null ? undefined : origin + paths.joinBase(base, step.path),
    })),
  };
}

/**
 * A vacancy, as Google Jobs reads it.
 *
 * WS4b calls this "not optional — it is what puts a listing into Google Jobs,
 * and the cheapest reach a careers page can buy." The fields below are the ones
 * that decide whether the listing is ACCEPTED: `title`, `description`,
 * `datePosted` and `hiringOrganization` are required, and a posting with no
 * `jobLocation` and no `jobLocationType` is rejected outright.
 *
 * Three judgements worth stating, because each has a wrong version that
 * validates:
 *
 *   · **`description` must be the real text, not the card summary.** Google's
 *     own guidance is the full HTML description; a 200-character teaser is a
 *     posting that looks thin next to every competitor's.
 *   · **A hidden salary emits NO `baseSalary`.** `publicVacancy` omits the
 *     numbers when `salary_hidden` is set, and inferring a band from anything
 *     else would republish exactly what the recruiter chose to withhold — into
 *     the one place it cannot be retracted from.
 *   · **`validThrough` only when the vacancy has a closing date.** Google
 *     removes a posting the moment that date passes, so guessing one would
 *     silently delist a role that is still open.
 *
 * The remote case uses `jobLocationType: "TELECOMMUTE"`, which is the only
 * accepted way to say it; a `jobLocation` of "Remote" is a posting Google places
 * in a town called Remote.
 */
function jobPostingLd(v, origin, branding) {
  if (!v || !v.title) return null;
  const name = (branding && branding.name) || null;

  const remote = String(v.work_mode || "").toUpperCase() === "REMOTE";
  const address = compact({
    "@type": "PostalAddress",
    addressLocality: v.location_city,
    addressRegion: v.location_state,
    addressCountry: v.location_country,
  });
  // More than just the "@type" key means at least one real component.
  const hasAddress = Object.keys(address).length > 1;

  const salary =
    !v.salary_hidden && (v.salary_min || v.salary_max)
      ? compact({
          "@type": "MonetaryAmount",
          currency: v.salary_currency || null,
          value: compact({
            "@type": "QuantitativeValue",
            minValue: v.salary_min ? Number(v.salary_min) : null,
            maxValue: v.salary_max ? Number(v.salary_max) : null,
            unitText: "MONTH",
          }),
        })
      : null;

  return compact({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: v.title,
    // The full description, not the card's summary.
    description: v.description || null,
    datePosted: v.published_at || null,
    validThrough: v.closes_on || null,
    employmentType: v.employment_type || null,
    hiringOrganization: name
      ? compact({
          "@type": "Organization",
          name,
          sameAs: origin,
          logo: absolute(origin, branding && branding.logoUrl),
        })
      : null,
    jobLocationType: remote ? "TELECOMMUTE" : null,
    jobLocation: hasAddress
      ? compact({ "@type": "Place", address })
      : null,
    baseSalary: salary,
    skills: Array.isArray(v.skills_required) && v.skills_required.length
      ? v.skills_required.join(", ")
      : null,
    experienceRequirements:
      v.experience_years_min === null || v.experience_years_min === undefined
        ? null
        : compact({
            "@type": "OccupationalExperienceRequirements",
            monthsOfExperience: Number(v.experience_years_min) * 12,
          }),
  });
}

/**
 * An article, for a reader that never runs the app.
 *
 * `datePublished` is the field WS5 exists to add: their site has no date on a
 * card, no `article:published_time`, and `og:type` of `website` — so a knowledge
 * hub with five pieces looks the same age forever, and a crawler has nothing to
 * rank recency on.
 *
 * `author` is a `Person` and not a string, because the name comes from a staff
 * record rather than from a translation key. Absent when the article is
 * unattributed — an author who has left sets the FK null, and inventing "Staff"
 * would be a byline nobody wrote.
 */
function articleLd(a, origin, branding, canonical) {
  if (!a || !a.title) return null;
  const name = (branding && branding.name) || null;
  return compact({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: a.title,
    description: a.description || null,
    datePublished: a.published_at || null,
    image: absolute(origin, a.image),
    mainEntityOfPage: canonical,
    author: a.author
      ? compact({ "@type": "Person", name: a.author.name, jobTitle: a.author.title })
      : null,
    publisher: name
      ? compact({
          "@type": "Organization",
          name,
          logo: absolute(origin, branding && branding.logoUrl),
        })
      : null,
    keywords: Array.isArray(a.tags) && a.tags.length ? a.tags.join(", ") : null,
  });
}

const ROUTES = [
  // PR 4: the brand pages (home, About, services, For Partners, Trust and
  // Compliance, the documents, the legal pages). Kept in their own file so
  // this table stays readable; matched first, and none of their patterns
  // overlaps an entry below.
  ...brandHeads.ROUTES,
  {
    // The public quotation (lean revamp §3.4). `peek` records no open: a link
    // preview fetched by a chat app is not the client reading the offer.
    test: /^\/q\/([^/]+)\/?$/,
    load: (client, token) =>
      require("../../modules/commercial/quotation_public/quotation_public.service").peek(
        client,
        decodeURIComponent(token),
      ),
    shape: (doc) =>
      !doc
        ? null
        : {
            title: doc.title || doc.doc_number || null,
            description: summarise(doc.summary),
          },
  },
  {
    // Proposal links from before the revamp: the app redirects them to
    // `/q/<token>`, but a chat app unfurling the old URL runs no script, so
    // the head describes the quotation it became (14542 carried the tokens),
    // read the same way, recording nothing.
    test: /^\/proposals\/([^/]+)\/?$/,
    load: (client, token) =>
      require("../../modules/commercial/quotation_public/quotation_public.service").peek(
        client,
        decodeURIComponent(token),
      ),
    shape: (doc) =>
      !doc
        ? null
        : {
            title: doc.title || doc.doc_number || null,
            description: summarise(doc.summary),
          },
  },
  {
    test: /^\/careers\/([^/]+)\/?$/,
    load: (client, token) =>
      require("../../modules/hr/careers/careers.service").findByToken(
        client,
        decodeURIComponent(token),
      ),
    shape: (v) =>
      !v
        ? null
        : {
            title: v.title || null,
            description: summarise(v.summary || v.description),
            trail: [
              { name: "Careers", path: "/careers" },
              { name: v.title || "Vacancy", path: null },
            ],
            ld: (origin, branding) => jobPostingLd(v, origin, branding),
          },
  },
  {
    test: /^\/portfolio\/([^/]+)\/?$/,
    load: (client, slug) =>
      require("../../modules/sales/portfolio_public/portfolio_public.service").get(
        client,
        decodeURIComponent(slug),
      ),
    shape: (s) =>
      !s
        ? null
        : {
            title: s.title || null,
            description: summarise(s.summary || s.body),
            image: s.cover_url || null,
            trail: [
              { name: "Success stories", path: "/portfolio" },
              { name: s.title || "Story", path: null },
            ],
          },
  },
  // The Insights INDEX moved to `public-head-brand` with the share cards: it is
  // a built-in page like Contact, with a Link Previews title and sentence and a
  // hero photograph, and the newest headline is now its fallback sentence.
  {
    test: /^\/insights\/([^/]+)\/?$/,
    load: (client, slug) =>
      require("../../modules/content/insight/insight.service").getPublic(
        client,
        decodeURIComponent(slug),
      ),
    // `getPublic` THROWS a 404 for an unpublished or unknown slug rather than
    // returning null, and `headFor` catches it — so a draft falls back to the
    // shell's generic title instead of describing a page nobody can open.
    shape: (a) => {
      if (!a) return null;
      // ENGLISH first (14680), and the search fields first within each
      // language. This was French first, on the reasoning that the tenant is
      // Cameroonian; the first tenant to run a library is English only, and
      // the head is one document that cannot be bilingual. The writer's own
      // search title and description win over the headline and the excerpt,
      // which is what those fields exist for: they were stored and never read.
      const pick = (...vals) => vals.map((v) => String(v || "").trim()).find(Boolean) || null;
      const title = pick(a.meta_title_en, a.title_en, a.meta_title_fr, a.title_fr);
      const headline = pick(a.title_en, a.title_fr) || title;
      const description = summarise(
        pick(
          a.meta_description_en, a.excerpt_en,
          a.meta_description_fr, a.excerpt_fr,
          a.body_en, a.body_fr,
        ),
      );
      return {
        title,
        // The card prints the headline the reader sees on the page, not the
        // search title, which is written for a results page.
        headline,
        description,
        image: a.cover_id ? "/api/tenant/public/insights/media/" + a.cover_id : null,
        trail: [
          { name: "Insights", path: "/insights" },
          { name: headline || "Article", path: null },
        ],
        ld: (origin, branding, canonical) =>
          articleLd(
            {
              // The Article's headline is the headline, not the search title:
              // schema.org reads it as the piece's name.
              title: headline,
              description,
              published_at: a.published_at,
              image: a.cover_id ? "/api/tenant/public/insights/media/" + a.cover_id : null,
              author: a.author,
              tags: a.tags,
            },
            origin,
            branding,
            canonical,
          ),
        // The one page on this site where og:type is genuinely `article`.
        ogType: "article",
        publishedTime: a.published_at || null,
      };
    },
  },
];

/**
 * Everything a page's head and its share card are made from, for one host and
 * one base-relative path. One function for both, so the card's headline and
 * photograph can never describe a different page from the title beside it.
 *
 * The tenant reads that every page needs (brand, Link Previews wording, the
 * website theme) share ONE connection; the page's own record is a second.
 */
async function describe(host, rel) {
  const site = await withTenant(host, async (client) => {
    const theme = await require("../../modules/site/site_settings/site_settings.service").getTheme(client).catch(() => null);
    const titles = !theme || theme.label_case !== "AS_WRITTEN";
    return {
      theme,
      branding: await require("../../modules/branding/branding.service").getBranding(client).catch(() => null),
      share: await shareCopy.load(client, { titles }).catch(() => shareCopy.empty()),
    };
  }).catch(() => null);
  const branding = (site && site.branding) || null;
  const share = (site && site.share) || shareCopy.empty();
  const theme = (site && site.theme) || null;
  const name = shareCopy.siteName(share, branding);

  let page = null;
  for (const r of ROUTES) {
    const m = rel === null ? null : r.test.exec(rel);
    if (!m) continue;
    page = await withTenant(host, (client) => r.load(client, m[1]))
      .then((row) => r.shape(row, { share }))
      .catch(() => null);
    break;
  }

  // "Sea Freight | Smart Logistics and Services". A title written whole (a
  // page's search title) or one already carrying the name is printed as it is,
  // so the announcement does not read "... Opens in Mannheim | Smart Logistics
  // and Services" twice over.
  const own = page && page.title ? String(page.title) : null;
  const title = !own
    ? name
    : page.fullTitle || own.toLowerCase().includes(name.toLowerCase())
      ? own
      : own + " | " + name;
  const home = shareCopy.page(share, "home");
  return {
    branding,
    name,
    page,
    title,
    // A page with nothing of its own to say borrows the home page's sentence:
    // a card with no sentence is the half-empty card this exists to end.
    description: (page && page.description) || summarise(home.description) || null,
    headline: (page && (page.headline || page.title)) || home.title || name,
    // The homepage hero is every page's photograph of last resort, and the
    // logo is no longer one: it is drawn ON the card instead.
    photo: (page && page.image) || (branding && branding.siteHeroUrl) || null,
    logo: (branding && branding.logoUrl) || null,
    accent: (theme && theme.primary_hex) || (branding && branding.primary) || null,
    font: (theme && theme.font_display) || null,
  };
}

/** The card's address for a page. `v` changes whenever anything drawn on the
 *  card does, so a chat app's cache of the old card is never what it gets. */
function cardUrl(origin, host, rel, view) {
  const v = crypto
    .createHash("sha1")
    .update(JSON.stringify([view.headline, view.photo, view.logo, view.accent, view.font, host]))
    .digest("hex")
    .slice(0, 12);
  return origin + "/api/tenant/public/site/card.jpg?p=" + encodeURIComponent(rel || "/") + "&v=" + v;
}

/** `describe`, memoised like the heads, for the card route. */
function describeForCard(host, rel) {
  return memo(host + " card " + rel, () => describe(host, rel));
}

async function headFor(host, urlPath, origin, base) {
  // The path as the ROUTES table sees it: with this host's base removed, so
  // `/site/portfolio/x`, `/public/portfolio/x` and (on the tenant's own domain)
  // `/portfolio/x` all reach the same entry. null means the path is not under
  // the base at all, and nothing here describes it.
  const rel = paths.stripBase(urlPath, base);

  const view = await describe(host, rel);
  const { page, title, description, name } = view;
  // The brand as structured data names it: the site name, not the registered
  // name with its legal form, which is the Impressum's business.
  const branding = view.branding ? { ...view.branding, name } : null;
  const image = cardUrl(origin, host, rel, view);
  const alt = view.headline && view.headline !== name ? view.headline + ". " + name : name;
  const canonical = origin + urlPath;
  const noindex = isNoindexHost(host);

  const tags = [
    // The marketing prefix this host is configured for. The app reads it at boot
    // (lib/base-path.ts) and builds every link from it, so the prefix is a
    // per-tenant setting rather than a constant compiled into the bundle. It
    // rides in the head because the head is already being rewritten per request
    // for the tags below — one pass, no extra request, and no build-time
    // variable that could disagree with the database.
    '<meta name="praxis:public-base" content="' + esc(base || paths.DEFAULT_BASE) + '" />',
    "<title>" + esc(title) + "</title>",
    '<link rel="canonical" href="' + esc(canonical) + '" />',
    '<meta property="og:type" content="' + esc((page && page.ogType) || "website") + '" />',
    '<meta property="og:site_name" content="' + esc(name) + '" />',
    '<meta property="og:title" content="' + esc(title) + '" />',
    '<meta property="og:url" content="' + esc(canonical) + '" />',
    // Every page has a card now, so every page is a large-image card.
    '<meta name="twitter:card" content="summary_large_image" />',
  ];
  if (noindex) {
    // `noindex, nofollow` and not merely a robots.txt Disallow: a Disallow
    // stops a crawler READING the page but not INDEXING a URL it found linked
    // elsewhere, which is how a staging host ends up in results as a bare title
    // with no snippet. The meta tag is the one that removes it, and it is
    // emitted first so a truncating reader sees it.
    tags.unshift('<meta name="robots" content="noindex, nofollow" />');
  }
  if (page && page.publishedTime) {
    // The tag a reader's feed and a crawler both use to date the piece. Only
    // meaningful alongside og:type=article, which is why it rides with it.
    tags.push('<meta property="article:published_time" content="' + esc(page.publishedTime) + '" />');
  }
  if (description) {
    tags.push('<meta name="description" content="' + esc(description) + '" />');
    tags.push('<meta property="og:description" content="' + esc(description) + '" />');
  }
  // The share card. Absolute, because a card is fetched by a server elsewhere
  // that has no idea what this page's origin was. The size and type are stated
  // so an unfurler can lay the card out large before it has downloaded it;
  // without them WhatsApp and LinkedIn often settle for the small thumbnail.
  tags.push('<meta property="og:image" content="' + esc(image) + '" />');
  tags.push('<meta property="og:image:type" content="image/jpeg" />');
  tags.push('<meta property="og:image:width" content="' + shareCard.WIDTH + '" />');
  tags.push('<meta property="og:image:height" content="' + shareCard.HEIGHT + '" />');
  tags.push('<meta property="og:image:alt" content="' + esc(alt) + '" />');
  tags.push('<meta name="twitter:title" content="' + esc(title) + '" />');
  if (description) tags.push('<meta name="twitter:description" content="' + esc(description) + '" />');
  tags.push('<meta name="twitter:image" content="' + esc(image) + '" />');

  // Structured data (§3.7). Skipped entirely on a noindex host: emitting rich
  // results markup on a page we are asking not to be indexed is at best wasted
  // bytes and at worst a staging vacancy in Google Jobs.
  if (!noindex) {
    const org = await withTenant(host, (client) => brandHeads.offices(client)).catch(() => null);
    const graphs = [organizationLd(branding, origin, org)];
    if (page && typeof page.ld === "function") graphs.push(page.ld(origin, branding, canonical));
    if (page && page.trail) graphs.push(breadcrumbLd(origin, base, page.trail));
    for (const g of graphs) {
      const script = ldScript(g);
      if (script) tags.push(script);
    }
  }
  return tags.join("\n    ");
}

/**
 * Replace the shell's own title and description with the page's.
 *
 * Removed rather than duplicated: two titles is a card that picks one at random.
 */
function applyHead(html, tags) {
  return html
    .replace(/\s*<title>[\s\S]*?<\/title>/i, "")
    .replace(/\s*<meta\s+name="description"[^>]*>/i, "")
    .replace(/\s*<meta\s+property="og:type"[^>]*>/i, "")
    // The shell ships this one with the default in it; two would be read as one
    // at random by `querySelector`, and the stale one usually wins.
    .replace(/\s*<meta\s+name="praxis:public-base"[^>]*>/i, "")
    .replace("</head>", "  " + tags + "\n  </head>");
}

function robots(origin, servesPublic, base, host) {
  if (isNoindexHost(host)) {
    // The rehearsal. Nothing here should be crawled, and the meta tag in the
    // head is what actually removes an already-indexed URL — this is the
    // cheaper half that stops the crawl in the first place.
    return "User-agent: *\nDisallow: /\n";
  }
  if (!servesPublic) {
    // A workspace host has nothing a crawler should index, and saying so is
    // cheaper than letting one discover a login wall by crawling into it.
    return "User-agent: *\nDisallow: /\n";
  }
  return [
    "User-agent: *",
    "Allow: /",
    // Tokenised documents are shared deliberately, with one recipient. They stay
    // reachable by anyone holding the link — that is the point — but they should
    // not accumulate in a search index.
    //
    // Built from THIS host's base, not the literal "/public": a Disallow line
    // naming a path the host does not serve protects nothing, and the paths that
    // needed protecting stay open. That is the failure this file is otherwise
    // full of guards against.
    "Disallow: " + paths.joinBase(base, "/proposals/"),
    "Disallow: " + paths.joinBase(base, "/profile/"),
    "Disallow: " + paths.joinBase(base, "/q/"),
    "Disallow: /portal/",
    "",
    "Sitemap: " + origin + "/sitemap.xml",
    "",
  ].join("\n");
}

/**
 * The marketing routes that exist whatever a tenant has published.
 *
 * A NAMED CONSTANT because the failure mode is silence: a route added to
 * `public-web`'s router, its nav and its footer, and not here, is a page every
 * visitor can reach and a crawler finds last or by accident. §9.1's `/about`
 * shipped in exactly that state and was caught by the final pass rather than by
 * any gate — nothing anywhere compares the router's table to this list.
 *
 * Exported so `tests/unit/public-head.test.js` can assert against it without a
 * database; `sitemap()` itself needs a tenant connection for the rows below.
 */
const SITEMAP_ROUTES = [
  "",
  // The page a procurement officer reads before deciding whether to ask for a
  // price, and the one carrying the tenant's registered companies and their
  // accreditations — which is what somebody searching the company BY NAME
  // wants.
  "/about",
  "/track",
  // Conversion pages with their own routes now, not hashes on the home page —
  // a form somebody can be sent a link to is a form a crawler should know
  // exists.
  "/quote",
  "/contact",
  "/services",
  "/portfolio",
  "/careers",
  "/insights",
  // PR 4: who we are to an agent, how we are governed, and the legal pages.
  // Each published document is added below from the database.
  "/partners",
  "/trust",
  "/legal/impressum",
  "/legal/privacy",
];

async function sitemap(host, origin, base) {
  // `joinBase` and not `base + …`: on a host the site owns, the base is "/"
  // and naive concatenation emits "//track" — a URL a crawler treats as a
  // protocol-relative address, i.e. a different site.
  const at = (rest) => paths.joinBase(base, rest);
  let portfolioOn = false;
  const rows = await withTenant(host, async (client) => {
    const services = require("../../modules/operations/service_type_web_public/service_type_web_public.service");
    const portfolio = require("../../modules/sales/portfolio_public/portfolio_public.service");
    const careers = require("../../modules/hr/careers/careers.service");
    // A section the tenant switched off (website v2, 14600) answers the
    // not-found page, so it leaves the sitemap too: listing it would invite a
    // crawler to index a 404.
    const site = await require("../../modules/site/site_settings/site_switches").load(client);
    portfolioOn = site.portfolio === true;
    const out = [];
    // Each section is independent: a tenant with no case notes should still get a
    // sitemap of their services, not a 500.
    const sections = [
      [() => services.list(client), (r) => at("/services/" + encodeURIComponent(r.slug_en || r.slug_fr || ""))],
      [() => (portfolioOn ? portfolio.list(client) : []), (r) => at("/portfolio/" + encodeURIComponent(r.slug || ""))],
      [() => careers.list(client), (r) => at("/careers/" + encodeURIComponent(r.public_token || r.token || ""))],
      // Published articles only — listPublic filters, and an unpublished slug in
      // a sitemap is an invitation to crawl a 404.
      [
        async () => (await require("../../modules/content/insight/insight.service")
          .listPublic(client, { page: 1, perPage: 500 })).articles,
        // English slug first (14680), matching the head and the site's links.
        (r) => at("/insights/" + encodeURIComponent(r.slug_en || r.slug_fr || "")),
      ],
      // Published policies (PR 4). The privacy policy has its own address,
      // already listed above.
      [
        async () => (await require("../../modules/site/site_brand/site_brand.service")
          .publicDocuments(client, { lang: "en" })).filter((d) => d.kind === "POLICY"),
        (r) => at("/trust/" + encodeURIComponent(r.key || "")),
      ],
    ];
    for (const [read, make] of sections) {
      try {
        const list = await read();
        for (const r of Array.isArray(list) ? list : []) {
          const u = make(r);
          if (u && !u.endsWith("/")) out.push(u);
        }
      } catch (err) {
        logger.warn({ err, host }, "sitemap section failed - omitted");
      }
    }
    return out;
  }).catch(() => []);

  const fixed = SITEMAP_ROUTES.filter((r) => portfolioOn || r !== "/portfolio").map(at);
  const all = fixed.concat(rows || []);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ]
    .concat(all.map((u) => "  <url><loc>" + esc(origin + u) + "</loc></url>"))
    .concat(["</urlset>", ""])
    .join("\n");
}

/**
 * `res.sendFile`'s replacement for HTML navigations.
 *
 * Everything here is best-effort: on any failure `next()` runs and the plain file
 * is sent, which is exactly the behaviour that existed before this module.
 */
function makeHtmlSender(publicWebDir) {
  const indexPath = path.join(publicWebDir, "index.html");
  let cachedHtml = null;
  const readIndex = () => {
    if (cachedHtml === null) cachedHtml = fs.readFileSync(indexPath, "utf8");
    return cachedHtml;
  };

  return async function sendHtml(req, res, next) {
    try {
      const host = String(req.headers.host || "").toLowerCase().split(":")[0];
      const origin = req.protocol + "://" + req.headers.host;
      const base = req.publicBase || "/public";
      const tags = await memo(host + " " + base + " " + req.path, () =>
        headFor(host, req.path, origin, base),
      );
      res.type("html").send(applyHead(readIndex(), tags));
    } catch (err) {
      logger.warn({ err, path: req.path }, "head injection failed - serving the shell");
      return next();
    }
  };
}

module.exports = {
  SITEMAP_ROUTES,
  ROUTES,
  makeHtmlSender,
  // The share card route reads the same description of a page as its head.
  describe,
  describeForCard,
  cardUrl,
  headFor,
  robots,
  sitemap,
  invalidateHost,
  applyHead,
  summarise,
  // Exported for the tests, which assert the structured data directly rather
  // than by parsing it back out of a `<head>` string.
  isNoindexHost,
  organizationLd,
  jobPostingLd,
  articleLd,
  breadcrumbLd,
  ldScript,
};
