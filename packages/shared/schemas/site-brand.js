"use strict";
/**
 * The website's brand layer: photographic slots, the About page's sections and
 * the trust documents. One definition of "valid" for the API and the settings
 * screens (doc/smartls-website/ENGINEERING_GUIDE.md, PR 4).
 *
 * ── WHY TEXT IS `{ en, fr }` HERE AND `x_en / x_fr` IN site-settings.js ────
 *
 * The older settings forms map one column to one input. These sections are
 * jsonb (14660's `site_about.sections`), and a nested object keeps a heading
 * and its translation together, which is what `siteLanguages.bilingualGaps`
 * walks to decide whether the tenant's required language is present. Neither
 * half is required by the SHAPE: which half is required depends on the
 * languages a tenant offers, and that is a tenant switch, not a schema.
 *
 * ── NO MARKUP, NO URLS TO IMAGES ────────────────────────────────────────────
 *
 * The rule `site_content.schema.js` states for blocks holds here: every string
 * reaches a public page, so none of them may carry HTML, and an image is never
 * a URL. The document bodies are the one long form and they are a Markdown
 * subset rendered by a renderer that builds nodes, never HTML.
 */

const { z } = require("zod");

/* ── primitives ─────────────────────────────────────────────────────────────*/

const s = (max) => z.string().trim().max(max).nullable().optional();
/** A short bilingual line or paragraph. */
const txt = (max) =>
  z
    .object({ en: s(max), fr: s(max) })
    .strict()
    .nullable()
    .optional();

const LINE = 200;
const PARA = 1600;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/* ── photographic slots ─────────────────────────────────────────────────────*/

/**
 * Every photograph on the public site that belongs to no other row.
 *
 * `page` groups the slots on the settings screen; `label` is the English name
 * an editor sees (the client translates it through its dictionary); `aspect`
 * is printed beside the control before the file dialog opens, so an editor
 * learns the shape before choosing a picture, not after.
 *
 * All of them are ATMOSPHERE (13789): scene-setting pictures that stand beside
 * no named person and no company's mark, so a generated image is acceptable
 * here and refused everywhere else. A portrait is a leader's photo, never one
 * of these.
 *
 * Service families take a key per family, `family-<group key>`, because the
 * families are the tenant's own (Master Data), not a list this file can name.
 */
const SITE_IMAGE_SLOTS = {
  "home-step-1": { page: "home", label: "Working With Us: Step One", aspect: "4:3" },
  "home-step-2": { page: "home", label: "Working With Us: Step Two", aspect: "4:3" },
  "home-step-3": { page: "home", label: "Working With Us: Step Three", aspect: "4:3" },
  "about-hero": { page: "about", label: "About: Hero", aspect: "16:9" },
  "about-story": { page: "about", label: "About: Our Story", aspect: "4:5" },
  "about-principles": { page: "about", label: "About: How We Work", aspect: "4:3" },
  "about-office-1": { page: "about", label: "About: First Office", aspect: "3:2" },
  "about-office-2": { page: "about", label: "About: Second Office", aspect: "3:2" },
  "about-office-3": { page: "about", label: "About: Third Office", aspect: "3:2" },
  "about-sectors": { page: "about", label: "About: Who We Move For", aspect: "16:9" },
  "about-standards": { page: "about", label: "About: Our Standards", aspect: "4:3" },
  "about-closing": { page: "about", label: "About: Closing Band", aspect: "21:9" },
  "partners-hero": { page: "partners", label: "For Partners: Hero", aspect: "16:9" },
  "trust-hero": { page: "trust", label: "Trust and Compliance: Hero", aspect: "16:9" },
  // One hero per remaining page, so no page opens on a bare black plate
  // (owner's review of staging, 25 Nov 2026). Drawn by <PageHero> in
  // public-web/src/components/site/photo-band.tsx.
  "services-hero": { page: "pages", label: "Services: Hero", aspect: "16:9" },
  "insights-hero": { page: "pages", label: "Insights: Hero", aspect: "16:9" },
  "track-hero": { page: "pages", label: "Track: Hero", aspect: "16:9" },
  "contact-hero": { page: "pages", label: "Contact: Hero", aspect: "16:9" },
  "careers-hero": { page: "pages", label: "Careers: Hero", aspect: "16:9" },
  "quote-hero": { page: "pages", label: "Request a Quote: Hero", aspect: "16:9" },
  "impressum-hero": { page: "pages", label: "Impressum: Hero", aspect: "16:9" },
  "privacy-hero": { page: "pages", label: "Privacy Policy: Hero", aspect: "16:9" },
  "verify-hero": { page: "pages", label: "Verify a Document: Hero", aspect: "16:9" },
  "notfound-hero": { page: "pages", label: "Page Not Found: Hero", aspect: "16:9" },
  "portfolio-hero": { page: "pages", label: "Our Work: Hero", aspect: "16:9" },
};

const FAMILY_SLOT = /^family-[a-z0-9]+(-[a-z0-9]+)*$/;

/** True for a registry key or a `family-<key>` slot. */
function isImageSlot(key) {
  const k = String(key || "");
  return Object.prototype.hasOwnProperty.call(SITE_IMAGE_SLOTS, k) || (k.length <= 64 && FAMILY_SLOT.test(k));
}

/** What the upload may weigh and how wide it must be, for every slot alike. */
const SITE_IMAGE_LIMITS = { maxBytes: 10 * 1024 * 1024, minWidth: 1200 };

const imageSlotKey = z
  .string()
  .trim()
  .refine(isImageSlot, "Not a photograph slot on this website.");

/** The words a screen reader says for the picture, and the upload itself. */
const imageAlt = z
  .object({
    alt_en: s(LINE),
    alt_fr: s(LINE),
  })
  .strict();

const imageUpload = z
  .object({
    provenance: z.enum(["owned", "licensed", "generated"]),
    data_url: z.string().min(1).max(16_000_000),
    original_name: z.string().trim().max(200).optional(),
    alt_en: s(LINE),
    alt_fr: s(LINE),
  })
  .strict();

/* ── the About page's sections (14660 site_about.sections) ──────────────────*/

const labelled = z.object({ label: txt(60), value: txt(120) }).strict();
const titled = z.object({ title: txt(120), text: txt(PARA) }).strict();

/**
 * The editorial sections of the About page.
 *
 * The headline and lead stay in `site_about.headline_*` / `summary_*`, the
 * founding year and headquarters in their own columns, and the principles in
 * `site_about.principles`: they predate 14660 and other screens read them. The
 * search snippet is the `about` page's meta title and description (Settings ›
 * Website › Pages), the one place every page's snippet is written.
 * Everything the rebuilt page adds lives here. Every section is optional, and
 * a section with nothing in it is not drawn: the page is shorter, never broken.
 */
const aboutSections = z
  .object({
    hero_eyebrow: txt(60),
    credentials: z.array(labelled).max(6).optional(),
    story: z
      .object({ title: txt(120), paragraphs: z.array(txt(PARA)).max(8).optional() })
      .strict()
      .optional(),
    principles_title: txt(120),
    message: z
      .object({
        leader_id: z.string().guid().nullable().optional(),
        title: txt(120),
        paragraphs: z.array(txt(PARA)).max(10).optional(),
      })
      .strict()
      .optional(),
    offices: z
      .object({
        title: txt(120),
        items: z
          .array(
            z
              .object({
                entity_id: z.string().guid(),
                // "Douala, Cameroon": the heading. The address, phone and
                // email are read from the company, never typed here.
                heading: txt(80),
                label: txt(60),
                services: txt(400),
              })
              .strict(),
          )
          .max(3)
          .optional(),
      })
      .strict()
      .optional(),
    sectors: z
      .object({
        title: txt(120),
        items: z.array(titled).max(8).optional(),
        clients_caption: txt(160),
      })
      .strict()
      .optional(),
    standards: z
      .object({ title: txt(120), text: txt(PARA) })
      .strict()
      .optional(),
    closing: z
      .object({ title: txt(120), text: txt(400) })
      .strict()
      .optional(),
  })
  .strict();

/* ── trust documents (14660 site_document) ──────────────────────────────────*/

const DOCUMENT_KINDS = ["POLICY", "LEGAL"];
const DOCUMENT_LANGS = ["en", "fr", "de"];

const docShape = {
  doc_key: z
    .string()
    .trim()
    .toLowerCase()
    .max(60)
    .regex(SLUG, "Lowercase letters, digits and single hyphens, as it appears in the address."),
  kind: z.enum(DOCUMENT_KINDS).optional(),
  sort_order: z.coerce.number().int().min(0).max(9999).optional(),
  title_en: s(160),
  title_fr: s(160),
  title_de: s(160),
  summary_en: s(600),
  summary_fr: s(600),
  summary_de: s(600),
  body_en: s(60_000),
  body_fr: s(60_000),
  body_de: s(60_000),
  version_label: s(40),
  effective_on: z
    .string()
    .trim()
    .regex(ISO_DAY, "Use a full date.")
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  approved_by: s(120),
};

const documentCreate = z.object(docShape).strict();
const documentUpdate = z.object(docShape).partial().strict();
const documentPublish = z.object({ published: z.boolean() }).strict();

/**
 * Whether a draft can be published, in words an editor can act on.
 *
 * A document is published in every language it has a title in, and each of
 * those needs a body: a title over nothing is a page that says nothing, and
 * the PDF would be a letterhead. `required` is the tenant's required language
 * ("en" or "fr"); without it the document cannot go out at all.
 */
function publishGaps(doc, required = "en") {
  const gaps = [];
  const filled = (v) => String(v || "").trim() !== "";
  if (!filled(doc[`title_${required}`])) gaps.push(`title_${required}`);
  for (const lang of DOCUMENT_LANGS) {
    if (filled(doc[`title_${lang}`]) && !filled(doc[`body_${lang}`])) gaps.push(`body_${lang}`);
  }
  return gaps;
}

module.exports = {
  SITE_IMAGE_SLOTS,
  SITE_IMAGE_LIMITS,
  isImageSlot,
  imageSlotKey,
  imageAlt,
  imageUpload,
  aboutSections,
  DOCUMENT_KINDS,
  DOCUMENT_LANGS,
  documentCreate,
  documentUpdate,
  documentPublish,
  publishGaps,
};
