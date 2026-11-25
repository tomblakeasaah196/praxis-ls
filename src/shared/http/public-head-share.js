"use strict";

/**
 * The words a shared link carries: the site's name and each page's title and
 * sentence, from the tenant's own Wording (Settings › Website › Wording ›
 * Link Previews), over the defaults the website ships.
 *
 * ── WHY THESE ARE WORDING KEYS AND NOT PAGE RECORDS ────────────────────────
 *
 * A built-in page (Contact, Track, Request a Quote...) has no record a tenant
 * edits: its words are dictionary strings. The `site_page` meta fields exist,
 * but writing one means CREATING a page, and a published page joins the
 * navigation, so a tenant who only wanted a better WhatsApp card for Contact
 * would grow a second Contact in the menu. The Wording screen is where a
 * tenant already rewrites every other word on these pages, the same strings
 * reach the browser tab through `public-web` (`useShareMeta`), and the
 * catalogue gate guarantees each key exists in both places.
 *
 * ── THE SITE NAME DEFAULTS TO THE BRAND, NOT TO A WORD OF OURS ─────────────
 *
 * `site.share.siteName` ships as `{{name}}`: the tenant's brand name from
 * Settings › Appearance. A tenant whose registered name carries its legal form
 * ("… Ltd") writes the name people say instead, and every card, title and
 * browser tab follows.
 */

const { SITE_COPY_ENTRIES } = require("../../../packages/shared/data/site-copy.generated");
const { titleCase } = require("../../../packages/shared/text/title-case");

const DEFAULTS = new Map(SITE_COPY_ENTRIES.map(([key, , , en, fr]) => [key, { en, fr }]));

const read = (tree, dotted) =>
  String(dotted)
    .split(".")
    .reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), tree);

const clean = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * A reader over one tenant's overrides.
 *
 * `override` is what the tenant wrote, `fallback` what the site ships, and
 * `text` the first of the two. The split exists because some pages have a
 * better answer than the shipped default and a worse one than the tenant's
 * own words: About prefers the tenant's written summary to our generic line,
 * but not to a share sentence they wrote on purpose.
 */
function reader(enTree, { titles = true } = {}) {
  return {
    // The website's label case (Settings › Website › Theme): Title Case unless
    // the tenant chose "As written". A page title is a LABEL on the site, so the
    // card and the head follow the same rule the browser applies.
    titles,
    override: (key) => clean(read(enTree, key)),
    fallback: (key) => clean((DEFAULTS.get(key) || {}).en),
    text(key) {
      return this.override(key) || this.fallback(key);
    },
  };
}

/** No overrides at all: the shipped wording. What a failed read falls back to. */
const empty = () => reader(Object.create(null));

/** The tenant's overrides, English tree (an English-only or French-only site
 *  both fill it; see `getPublicCopy`). */
async function load(client, { titles = true } = {}) {
  const copy = await require("../../modules/site/site_content/site_content.service").getPublicCopy(client);
  return reader((copy && copy.en) || Object.create(null), { titles });
}

/** The name every title, card and tab carries. Never empty while the tenant
 *  has a brand name; "Praxis" only for a host with no tenant behind it. */
function siteName(share, branding) {
  const brand = (branding && branding.name) || "";
  const written = (share || empty()).text("site.share.siteName") || "{{name}}";
  const name = written.replace(/\{\{\s*name\s*\}\}/g, brand).replace(/\s+/g, " ").trim();
  return name || brand || "Praxis";
}

/** A page's title and sentence. */
function page(share, stem) {
  const s = share || empty();
  const title = s.text(`site.share.${stem}Title`);
  return {
    title: title && s.titles ? titleCase(title, "en") : title,
    description: s.text(`site.share.${stem}Description`),
    writtenDescription: s.override(`site.share.${stem}Description`),
  };
}

module.exports = { load, empty, siteName, page, reader };
