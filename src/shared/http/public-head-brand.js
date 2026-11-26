"use strict";

/**
 * The search heads of the brand pages (doc/smartls-website/ENGINEERING_GUIDE.md
 * PR 4, item 9): home, About, services and each service, For Partners, Trust
 * and Compliance, each published document, the Impressum and the privacy
 * policy. And the Organization data every page carries, with the offices.
 *
 * ── NOTHING HERE IS ONE TENANT'S WORDS ─────────────────────────────────────
 *
 * This file serves every tenant. Titles and descriptions come from the
 * tenant's own records: a page's meta title and description (Settings ›
 * Website › Pages), a service's search fields, a document's title and summary,
 * and each built-in page's Link Previews wording (Settings › Website › Wording,
 * read by `public-head-share`). Where a tenant has written nothing, the
 * fallback is the website's shipped wording for that page, the same default
 * every other line on the page falls back to.
 *
 * ── A WRITTEN META TITLE IS THE WHOLE TITLE ────────────────────────────────
 *
 * `headFor` appends " | <site name>" to a page title. An editor who writes a
 * search title has already written the name into it ("About Us | Smart
 * Logistics and Services, Douala and Mannheim"), so `fullTitle` marks a title
 * that is printed as written.
 */

const shareCopy = require("./public-head-share");

const pick = (...vals) => vals.map((v) => String(v || "").trim()).find(Boolean) || null;

function summarise(input, max = 200) {
  const flat = String(input || "")
    .replace(/[#*_`>[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

/** A published `site_page` by key, or null. Never throws: a page nobody has
 *  written is the normal case, and the head falls back to the page's name. */
async function pageMeta(client, key) {
  const { rows } = await client.query(
    `SELECT meta_title_en, meta_title_fr, meta_description_en, meta_description_fr,
            title_en, title_fr
       FROM site_page
      WHERE key = $1 AND is_published = true
      LIMIT 1`,
    [key],
  ).catch(() => ({ rows: [] }));
  return rows[0] || null;
}

/** The photograph in a slot, as the public media URL, or null. */
async function slotImage(client, slotKey) {
  const { rows } = await client.query(
    `SELECT i.vault_id
       FROM site_image i
       JOIN document_vault v ON v.doc_id = i.vault_id
      WHERE i.slot_key = $1 AND v.status = 'VERIFIED'
        AND v.public_media_scope = 'SITE' AND v.public_media_role = 'ATMOSPHERE'`,
    [slotKey],
  ).catch(() => ({ rows: [] }));
  return rows[0] ? "/api/tenant/public/site/media/" + rows[0].vault_id : null;
}

/**
 * A built-in page. Its head is, in order of preference:
 *
 *   · title: the `site_page` meta title when one is written (printed whole),
 *     else the page's Link Previews title from Wording, else its plain name;
 *   · description: the `site_page` meta description, else the Link Previews
 *     sentence the tenant WROTE, else the page's own words (`fallback`, the
 *     About summary), else the shipped Link Previews sentence;
 *   · headline (the words on the card): the Link Previews title, short by
 *     design, whatever a long search title says;
 *   · image (the card's photograph): the page's hero slot.
 */
function pageRoute(test, key, stem, name, { slot = null, fallback = null, trail = null } = {}) {
  return {
    test,
    load: async (client) => ({
      meta: await pageMeta(client, key),
      image: slot ? await slotImage(client, slot) : null,
      extra: fallback ? await fallback(client) : null,
    }),
    shape: (loaded, ctx = {}) => {
      if (!loaded) return null;
      const { meta, image, extra } = loaded;
      const words = shareCopy.page(ctx.share, stem);
      const written = meta ? pick(meta.meta_title_en, meta.meta_title_fr) : null;
      const title = written || words.title || (meta && pick(meta.title_en, meta.title_fr)) || (extra && extra.title) || name;
      return {
        title,
        fullTitle: Boolean(written),
        headline: words.title || title,
        description: summarise(
          pick(
            meta && meta.meta_description_en,
            meta && meta.meta_description_fr,
            words.writtenDescription,
            extra && extra.description,
            words.description,
          ),
        ) || null,
        image,
        trail: trail || null,
      };
    },
  };
}

/** The newest article's headline, for the Insights index when nothing better
 *  is written. */
async function latestHeadline(client) {
  const view = await require("../../modules/content/insight/insight.service")
    .listPublic(client, { kind: "article", page: 1, perPage: 1 })
    .catch(() => null);
  const latest = view && view.articles && view.articles[0];
  const headline = latest ? pick(latest.title_en, latest.title_fr) : null;
  return { title: null, description: headline ? "Latest: " + headline : null };
}

/** The About page's own words, when no page meta has been written. */
async function aboutFallback(client) {
  const { rows } = await client.query(
    `SELECT headline_en, headline_fr, summary_en, summary_fr FROM site_about LIMIT 1`,
  ).catch(() => ({ rows: [] }));
  const a = rows[0] || {};
  return { title: null, description: pick(a.summary_en, a.summary_fr) };
}

const ROUTES = [
  // Home. Its photograph is the homepage hero, which lives in branding
  // (`site_hero_url`) rather than in a slot; `headFor` supplies it.
  pageRoute(/^\/?()$/, "home", "home", null, { slot: null }),
  pageRoute(/^\/about()\/?$/, "about", "about", "About", { slot: "about-hero", fallback: aboutFallback }),
  pageRoute(/^\/services()\/?$/, "services", "services", "Services", { slot: "services-hero" }),
  pageRoute(/^\/partners()\/?$/, "partners", "partners", "For Partners", { slot: "partners-hero" }),
  pageRoute(/^\/trust()\/?$/, "trust", "trust", "Trust and Compliance", { slot: "trust-hero" }),
  // The pages that had no head of their own until the share cards (25 Nov
  // 2026): each shared link to them read as the home page, titled with the
  // bare tenant name and carrying the logo as its picture.
  pageRoute(/^\/insights()\/?$/, "insights", "insights", "Insights", {
    slot: "insights-hero",
    fallback: latestHeadline,
    trail: [{ name: "Insights", path: null }],
  }),
  pageRoute(/^\/track()\/?$/, "track", "track", "Track a Shipment", { slot: "track-hero" }),
  pageRoute(/^\/quote()\/?$/, "quote", "quote", "Request a Quote", { slot: "quote-hero" }),
  pageRoute(/^\/contact()\/?$/, "contact", "contact", "Contact Us", { slot: "contact-hero" }),
  pageRoute(/^\/careers()\/?$/, "careers", "careers", "Careers", { slot: "careers-hero" }),
  pageRoute(/^\/portfolio()\/?$/, "portfolio", "portfolio", "Our Work", { slot: "portfolio-hero" }),
  pageRoute(/^\/verify()\/?$/, "verify", "verify", "Verify a Document", { slot: "verify-hero" }),
  {
    test: /^\/services\/([^/]+)\/?$/,
    load: (client, slug) =>
      require("../../modules/operations/service_type_web/service_type_web.repo")
        .publicDetail(client, decodeURIComponent(slug)),
    shape: (detail) => {
      if (!detail || !detail.row) return null;
      const r = detail.row;
      const written = pick(r.meta_title_en, r.meta_title_fr);
      // The name the WEBSITE prints ("Sea Freight"), which a profile may set
      // over the operations name ("Sea Freight Import"), as the public route does.
      const name = pick(r.web_name_en, r.name_en, r.web_name_fr, r.name_fr);
      const cover = r.cover_vault_id && detail.mediaByRole.get(r.cover_vault_id) === "COVER"
        ? "/api/tenant/public/services/media/" + r.cover_vault_id
        : null;
      return {
        title: written || name,
        fullTitle: Boolean(written),
        // The card says the service's name, not its search title: "Sea
        // Freight", which is what the reader is deciding whether to open.
        headline: name || written,
        description: summarise(pick(r.meta_description_en, r.short_description_en, r.meta_description_fr, r.short_description_fr)) || null,
        image: cover,
        trail: [
          { name: "Services", path: "/services" },
          { name: name || "Service", path: null },
        ],
        ld: (origin, branding, canonical) => serviceLd({
          name: name || written,
          description: summarise(pick(r.short_description_en, r.meta_description_en, r.short_description_fr, r.meta_description_fr)) || null,
          image: cover,
        }, origin, branding, canonical),
      };
    },
  },
  {
    test: /^\/trust\/([^/]+)\/?$/,
    load: async (client, key) => ({
      doc: await require("../../modules/site/site_brand/site_brand.service")
        .publicDocument(client, { key: decodeURIComponent(key), lang: "en" }),
      image: await slotImage(client, "trust-hero"),
    }),
    shape: ({ doc, image }) =>
      !doc
        ? null
        : {
          title: doc.title,
          description: summarise(doc.summary || doc.body) || null,
          image,
          trail: [
            { name: "Trust and Compliance", path: "/trust" },
            { name: doc.title, path: null },
          ],
        },
  },
  {
    test: /^\/legal\/privacy()\/?$/,
    load: async (client) => ({
      doc: await require("../../modules/site/site_brand/site_brand.service")
        .publicDocument(client, { key: "privacy-policy", lang: "en" }),
      image: await slotImage(client, "privacy-hero"),
    }),
    shape: ({ doc, image }) => (!doc ? null : { title: doc.title, description: summarise(doc.summary) || null, image }),
  },
  {
    test: /^\/legal\/impressum()\/?$/,
    load: async (client) => ({ image: await slotImage(client, "impressum-hero") }),
    shape: ({ image }) => ({ title: "Impressum", image }),
  },
];

/**
 * A service page as schema.org reads it: the service, and who provides it.
 * The provider is the brand by its site name, pointing at the home page, so a
 * reader joins it to the Organization every page carries.
 */
function serviceLd(svc, origin, branding, canonical) {
  if (!svc || !svc.name) return null;
  const provider = branding && branding.name
    ? { "@type": "Organization", name: branding.name, url: origin }
    : null;
  const out = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: svc.name,
    url: canonical,
  };
  if (svc.description) out.description = svc.description;
  if (svc.image) out.image = /^https?:\/\//i.test(svc.image) ? svc.image : origin + svc.image;
  if (provider) out.provider = provider;
  return out;
}

/* ── the offices, for the Organization data ─────────────────────────────────*/

/**
 * Every published company's registered office as a schema.org Place, and the
 * About page's office labels when the tenant has written them.
 *
 * Places, not sub-organisations: the brand is one organisation to a reader,
 * and how it is incorporated is the Impressum's business, not the search
 * result's.
 */
async function offices(client) {
  const brand = require("../../modules/site/site_brand/site_brand.service");
  const legal = await brand.publicLegal(client);
  // The social PROFILES, read whatever else is published: a tenant with no
  // company published yet still has a LinkedIn page that says who it is.
  // `socialProfiles` drops a WhatsApp chat link, which is a way to reach the
  // company and not a page about it, so it has no place in `sameAs`.
  const { rows: social } = await client.query("SELECT url FROM site_social_link ORDER BY platform")
    .catch(() => ({ rows: [] }));
  const sameAs = require("./public-body").socialProfiles(social.map((s) => s.url));
  if (!legal.length) return { places: [], email: null, phone: null, founded: null, sameAs, legalNames: [] };
  const { rows: about } = await client.query("SELECT founded_year, sections FROM site_about LIMIT 1")
    .catch(() => ({ rows: [] }));
  const sections = (about[0] && about[0].sections) || {};
  const items = (sections.offices && Array.isArray(sections.offices.items)) ? sections.offices.items : [];
  const labelOf = (id) => {
    const o = items.find((i) => i && i.entity_id === id);
    return o ? pick(o.heading && o.heading.en, o.label && o.label.en, o.heading && o.heading.fr) : null;
  };
  // Structured rows for PostalAddress; the display lines are the fallback.
  const { rows: addr } = await client.query(
    `SELECT entity_id, line1, line2, city, postal_code, country_code, is_primary, type, is_active
       FROM entity_address WHERE entity_id = ANY($1::uuid[])`,
    [legal.map((e) => e.id)],
  ).catch(() => ({ rows: [] }));
  const letterhead = require("../../modules/master/entity-letterhead.service");
  const ordered = items.length
    ? [...legal].sort((a, b) => {
      const ia = items.findIndex((i) => i.entity_id === a.id);
      const ib = items.findIndex((i) => i.entity_id === b.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    })
    : legal;
  const places = ordered.map((e) => {
    const row = letterhead.registeredAddressRow(addr.filter((a) => a.entity_id === e.id && a.is_active !== false));
    const address = row
      ? {
        "@type": "PostalAddress",
        streetAddress: [row.line1, row.line2].filter(Boolean).join(", ") || undefined,
        postalCode: row.postal_code || undefined,
        addressLocality: row.city || undefined,
        addressCountry: row.country_code || e.country_code,
      }
      : { "@type": "PostalAddress", streetAddress: e.address_lines.join(", ") || undefined, addressCountry: e.country_code };
    return {
      "@type": "Place",
      name: labelOf(e.id) || (row && row.city) || e.country,
      address,
      telephone: e.phone || undefined,
    };
  });
  return {
    places,
    email: legal.map((e) => e.email).find(Boolean) || null,
    phone: legal.map((e) => e.phone).find(Boolean) || null,
    founded: about[0] && about[0].founded_year ? String(about[0].founded_year) : null,
    sameAs,
    // The registered names of the published companies, for `legalName`.
    legalNames: [...new Set(legal.map((e) => String(e.legal_name || "").trim()).filter(Boolean))],
  };
}

module.exports = { ROUTES, offices, summarise, pageMeta, serviceLd };
