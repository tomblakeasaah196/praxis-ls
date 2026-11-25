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
 * Website › Pages), a service's search fields, a document's title and summary.
 * Where a tenant has written nothing, the fallback is a plain page name
 * ("About", "For Partners"), never a sentence about somebody's business.
 *
 * ── A WRITTEN META TITLE IS THE WHOLE TITLE ────────────────────────────────
 *
 * `headFor` appends " · <tenant name>" to a page title. An editor who writes a
 * search title has already written the name into it ("About Us | Smart
 * Logistics and Services, Douala and Mannheim"), so `fullTitle` marks a title
 * that is printed as written.
 */

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

/** A page whose head comes from its `site_page` meta, with a plain name and a
 *  photograph slot as the fallbacks. */
function pageRoute(test, key, name, { slot = null, fallback = null, trail = null } = {}) {
  return {
    test,
    load: async (client) => ({
      meta: await pageMeta(client, key),
      image: slot ? await slotImage(client, slot) : null,
      extra: fallback ? await fallback(client) : null,
    }),
    shape: ({ meta, image, extra }) => {
      const written = meta ? pick(meta.meta_title_en, meta.meta_title_fr) : null;
      return {
        title: written || (meta && pick(meta.title_en, meta.title_fr)) || (extra && extra.title) || name,
        fullTitle: Boolean(written),
        description: summarise(
          pick(meta && meta.meta_description_en, meta && meta.meta_description_fr, extra && extra.description),
        ) || null,
        image,
        trail: trail || null,
      };
    },
  };
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
  pageRoute(/^\/?()$/, "home", null, { slot: null }),
  pageRoute(/^\/about()\/?$/, "about", "About", { slot: "about-hero", fallback: aboutFallback }),
  pageRoute(/^\/services()\/?$/, "services", "Services"),
  pageRoute(/^\/partners()\/?$/, "partners", "For Partners", { slot: "partners-hero" }),
  pageRoute(/^\/trust()\/?$/, "trust", "Trust and Compliance", { slot: "trust-hero" }),
  {
    test: /^\/services\/([^/]+)\/?$/,
    load: (client, slug) =>
      require("../../modules/operations/service_type_web/service_type_web.repo")
        .publicDetail(client, decodeURIComponent(slug)),
    shape: (detail) => {
      if (!detail || !detail.row) return null;
      const r = detail.row;
      const written = pick(r.meta_title_en, r.meta_title_fr);
      const cover = r.cover_vault_id && detail.mediaByRole.get(r.cover_vault_id) === "COVER"
        ? "/api/tenant/public/services/media/" + r.cover_vault_id
        : null;
      return {
        title: written || pick(r.name_en, r.name_fr),
        fullTitle: Boolean(written),
        description: summarise(pick(r.meta_description_en, r.short_description_en, r.meta_description_fr, r.short_description_fr)) || null,
        image: cover,
        trail: [
          { name: "Services", path: "/services" },
          { name: pick(r.name_en, r.name_fr) || "Service", path: null },
        ],
      };
    },
  },
  {
    test: /^\/trust\/([^/]+)\/?$/,
    load: (client, key) =>
      require("../../modules/site/site_brand/site_brand.service")
        .publicDocument(client, { key: decodeURIComponent(key), lang: "en" }),
    shape: (doc) =>
      !doc
        ? null
        : {
          title: doc.title,
          description: summarise(doc.summary || doc.body) || null,
          trail: [
            { name: "Trust and Compliance", path: "/trust" },
            { name: doc.title, path: null },
          ],
        },
  },
  {
    test: /^\/legal\/privacy()\/?$/,
    load: (client) =>
      require("../../modules/site/site_brand/site_brand.service")
        .publicDocument(client, { key: "privacy-policy", lang: "en" }),
    shape: (doc) => (!doc ? null : { title: doc.title, description: summarise(doc.summary) || null }),
  },
  {
    test: /^\/legal\/impressum()\/?$/,
    load: async () => true,
    shape: () => ({ title: "Impressum" }),
  },
];

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
  if (!legal.length) return { places: [], email: null, phone: null, founded: null, sameAs: [] };
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
  const { rows: social } = await client.query("SELECT url FROM site_social_link ORDER BY platform")
    .catch(() => ({ rows: [] }));
  return {
    places,
    email: legal.map((e) => e.email).find(Boolean) || null,
    phone: legal.map((e) => e.phone).find(Boolean) || null,
    founded: about[0] && about[0].founded_year ? String(about[0].founded_year) : null,
    sameAs: social.map((s) => s.url).filter(Boolean),
  };
}

module.exports = { ROUTES, offices, summarise, pageMeta };
