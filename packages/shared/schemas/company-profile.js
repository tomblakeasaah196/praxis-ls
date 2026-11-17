"use strict";
/**
 * Company Profile (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.6, §4.7, owner
 * decision D9) — the payloads the editor and the API must agree on.
 *
 * FACTS ONCE, WORDS PER LANGUAGE. Each of the nine fixed sections is stored as
 * `structure` (ids, order, switches, links) plus `text_en` and `text_fr`, two
 * flat maps of words keyed by the ids in the structure. A certification is one
 * item with one `held` switch whatever language it prints in, so English and
 * French cannot disagree about whether it is held.
 *
 *   SECTION_KEYS       the sections, in the fixed order they print in
 *   section(key)       the PATCH body for one section of the draft
 *   TEXT_KEYS          what may be written in a section's text maps
 *   share              "Share" on the editor: a lead or a recipient, the
 *                      language the link opens in, the last day it works
 *   publish            "Publish": an optional change note
 *   logo               a client logo for the library (base64 data URL)
 *   cover              the cover photograph (base64 data URL)
 *
 * The API also strips anything a section does not name (an orphaned word for
 * a removed item), so the stored row is exactly what this file describes.
 */
const { z } = require("zod");
const { uuid, isoDate } = require("./common");

const SECTION_KEYS = Object.freeze([
  "cover", "who_we_are", "services", "capacity", "certifications",
  "case_stories", "clients", "why_us", "contact",
]);

/** The Capacity & Network figures, each derived from the tenant's own records. */
const CAPACITY_FIGURES = Object.freeze(["fleet_size", "fleet_mix", "warehouse", "offices", "gateways", "regions"]);
const WHO_FIELDS = Object.freeze(["positioning", "history", "mission"]);
const CONTACT_FIELDS = Object.freeze(["address", "phone", "email", "website"]);
const CERTIFICATION_KINDS = Object.freeze(["CERTIFICATION", "MEMBERSHIP"]);
const LANGUAGES = Object.freeze(["EN", "FR"]);

const LIMITS = Object.freeze({
  tagline: 160,
  paragraph: 1500,
  service_sentence: 240,
  network: 400,
  certification_name: 120,
  promise_title: 60,
  promise_body: 240,
  promises: 6,
  stories: 6,
  certifications: 30,
  services: 60,
  logos: 60,
  change_note: 500,
  share_days: 365,
});

/** An item id the editor mints (`c1`, `w3`). */
const itemId = z.string().trim().min(1).max(40).regex(/^[a-z][a-z0-9_]*$/, "Not a valid item id.");
const on = z.boolean();

const STRUCTURE = {
  // `image_key` is NOT accepted here: the cover photograph is set by its own
  // upload, so a request body can never point the PDF at another stored file.
  cover: z.object({ on }).strict(),
  who_we_are: z.object({
    on,
    show: z.object(Object.fromEntries(WHO_FIELDS.map((f) => [f, z.boolean()]))).partial().strict(),
  }).strict(),
  services: z.object({
    on,
    items: z.array(z.object({ id: uuid, on }).strict()).max(LIMITS.services),
  }).strict(),
  capacity: z.object({
    on,
    figures: z.object(Object.fromEntries(CAPACITY_FIGURES.map((f) => [f, z.boolean()]))).partial().strict(),
  }).strict(),
  certifications: z.object({
    on,
    items: z.array(z.object({
      id: itemId,
      kind: z.enum(CERTIFICATION_KINDS),
      held: z.boolean(),
      document_id: uuid.nullable(),
    }).strict()).max(LIMITS.certifications, `At most ${LIMITS.certifications} items.`),
  }).strict(),
  case_stories: z.object({
    on,
    story_ids: z.array(uuid).max(LIMITS.stories, `At most ${LIMITS.stories} stories.`),
  }).strict(),
  clients: z.object({
    on,
    logo_ids: z.array(uuid).max(LIMITS.logos),
  }).strict(),
  why_us: z.object({
    on,
    items: z.array(z.object({ id: itemId, on }).strict()).max(LIMITS.promises, `At most ${LIMITS.promises} promises.`),
  }).strict(),
  contact: z.object({
    on,
    show: z.object(Object.fromEntries(CONTACT_FIELDS.map((f) => [f, z.boolean()]))).partial().strict(),
  }).strict(),
};

/**
 * Which text keys a section may hold, and how long each may be. `ids` are the
 * structure's item ids; a key the section does not name is dropped on save.
 */
const TEXT_KEYS = {
  cover: () => ({ tagline: LIMITS.tagline }),
  who_we_are: () => Object.fromEntries(WHO_FIELDS.map((f) => [f, LIMITS.paragraph])),
  services: (s) => Object.fromEntries((s.items || []).map((i) => [i.id, LIMITS.service_sentence])),
  capacity: () => ({ network: LIMITS.network }),
  certifications: (s) => Object.fromEntries((s.items || []).map((i) => [i.id, LIMITS.certification_name])),
  case_stories: () => ({}),
  clients: () => ({}),
  why_us: (s) => Object.fromEntries((s.items || []).flatMap((i) => [
    [`${i.id}.title`, LIMITS.promise_title],
    [`${i.id}.body`, LIMITS.promise_body],
  ])),
  contact: () => ({}),
};

const textMap = z.record(z.string().max(80), z.string().max(LIMITS.paragraph, `At most ${LIMITS.paragraph} characters.`))
  .refine((o) => Object.keys(o).length <= 200, "Too many entries.");

/** The PATCH body for one section of the draft. Any part may be left out. */
function section(key) {
  const structure = STRUCTURE[key];
  if (!structure) return null;
  return z.object({
    structure: structure.optional(),
    text_en: textMap.optional(),
    text_fr: textMap.optional(),
  }).strict();
}

/**
 * Keep only the words a section names, trimmed and within their limit. Returns
 * `{ text, errors }`: an over-long value is an error, an unknown key is dropped.
 */
function cleanText(key, structure, text) {
  const allowed = TEXT_KEYS[key] ? TEXT_KEYS[key](structure || {}) : {};
  const out = {};
  const errors = {};
  for (const [k, v] of Object.entries(text || {})) {
    if (!(k in allowed) || typeof v !== "string") continue;
    const value = v.trim();
    if (!value) continue;
    if (value.length > allowed[k]) {
      errors[k] = [`At most ${allowed[k]} characters.`];
      continue;
    }
    out[k] = value;
  }
  return { text: out, errors };
}

/** Share: a lead, or a named recipient, or both. */
const share = z.object({
  lead_id: uuid.nullable().optional(),
  recipient_name: z.string().trim().max(160).nullable().optional(),
  recipient_email: z.string().trim().max(254).email("Enter a valid email.").nullable().optional()
    .or(z.literal("").transform(() => null)),
  language: z.enum(LANGUAGES).default("EN"),
  // The last day the link works, day-first on the screen and ISO on the wire.
  expires_on: isoDate,
  // true: the link keeps showing today's published version; false: it follows
  // whatever is published when it is opened.
  pin_version: z.boolean().default(false),
}).strict().refine(
  (v) => Boolean(v.lead_id || (v.recipient_name && v.recipient_name.trim()) || v.recipient_email),
  { message: "Pick a lead or name a recipient.", path: ["recipient_name"] },
);

const publish = z.object({
  change_note: z.string().trim().max(LIMITS.change_note).nullable().optional(),
}).strict();

const dataUrl = z.string().min(1, "Choose an image.").max(12 * 1024 * 1024, "The image is too large.");

const logo = z.object({
  name: z.string().trim().min(1, "Name the client.").max(160),
  data_url: dataUrl,
}).strict();

const cover = z.object({ data_url: dataUrl }).strict();

module.exports = {
  SECTION_KEYS,
  CAPACITY_FIGURES,
  WHO_FIELDS,
  CONTACT_FIELDS,
  CERTIFICATION_KINDS,
  LANGUAGES,
  LIMITS,
  TEXT_KEYS,
  section,
  cleanText,
  share,
  publish,
  logo,
  cover,
};
