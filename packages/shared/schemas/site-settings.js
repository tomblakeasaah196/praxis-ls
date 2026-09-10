"use strict";
/**
 * The website settings payloads — one definition of "valid" for the API and
 * the settings screens.
 *
 * ── WHY THESE ARE SHARED AND THE BLOCK SCHEMAS ARE NOT ─────────────────────
 *
 * `site_content.schema.js` keeps its fifteen block shapes server-side, because
 * a block's content depends on its `type` and the editor switches on it. These
 * are different: every one of them is a FORM, with fixed fields, rendered by a
 * settings screen that must refuse exactly what the API refuses. A tenant who
 * pastes a bad colour should be told by the field, not by a 422 after Save.
 *
 * ── THE TWO RULES WORTH READING BEFORE EDITING ─────────────────────────────
 *
 * 1. HEX IS SIX DIGITS WITH A HASH. The palette engine falls back to the brand
 *    orange on anything it cannot parse — correct at runtime, wrong at the
 *    door: a tenant who types `FF5A00` would see the default and never learn
 *    why. Rejected here, and again by a CHECK in 13780.
 *
 * 2. A PARTNER CANNOT GO LIVE WITHOUT ITS PERMISSION NOTE. Enforced three
 *    times on purpose — here, in the validator's refine, and by
 *    `ck_site_partner_active_needs_permission` in 13782. These are other
 *    companies' trademarks; GIZ and CMA CGM both operate written-permission
 *    regimes. Three layers because the cost of the check is nil and the cost
 *    of publishing an uncleared mark is a letter from someone's counsel.
 */

const { z } = require("zod");
const { SOCIAL_IDS, isValidSocialUrl } = require("../design/social");

/* ── primitives ─────────────────────────────────────────────────────────────*/

const HEX = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex colour, including the #.");
const optionalHex = HEX.nullable().optional().or(z.literal("").transform(() => null));

/** Bilingual prose. FR is the fallback everywhere in this product, so an EN-only
 *  field is accepted but never relied on by a renderer. */
const text = (max) => z.string().trim().max(max).nullable().optional();
const TITLE = 200;
const LINE = 400;
const PROSE = 4000;

const httpsUrl = z
  .string()
  .trim()
  .url("Must be a full URL.")
  .refine((u) => /^https?:\/\//i.test(u), "Must start with http:// or https://")
  .nullable()
  .optional();

/* ── theme ──────────────────────────────────────────────────────────────────*/

/**
 * The palette engine's INPUT. Never its output — see 13780's header for why
 * derived tokens are not stored.
 *
 * Font ids are validated as non-empty strings here rather than against the
 * library: `client/src/lib/fonts.ts` is TypeScript in the frontend app and
 * cannot be required from a CommonJS package the API loads at boot. The API's
 * own validator checks membership against the parsed library, and the settings
 * picker can only emit ids from it. Duplicating the seventeen names here would
 * be a fourth copy that drifts the day a face is added.
 */
const theme = z.object({
  primary_hex: HEX,
  secondary_hex: optionalHex,
  tertiary_hex: optionalHex,
  font_display: z.string().trim().min(1).max(64),
  font_body: z.string().trim().min(1).max(64),
  font_mono: z.string().trim().min(1).max(64),
  radius_px: z.coerce.number().int().min(0).max(32),
  default_mode: z.enum(["light", "dark"]),
});

/* ── social ─────────────────────────────────────────────────────────────────*/

/**
 * One footer link.
 *
 * The URL is checked against the PLATFORM's own host, not merely parsed. See
 * the note in design/social.js: a platform glyph pointing anywhere at all is a
 * phishing primitive wearing the tenant's branding.
 */
const socialLink = z
  .object({
    platform: z.enum(SOCIAL_IDS),
    url: z.string().trim().min(1),
  })
  .superRefine((val, ctx) => {
    if (!isValidSocialUrl(val.platform, val.url)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: `Must be an https link on the ${val.platform} domain.`,
      });
    }
  });

/* ── partners and credentials ───────────────────────────────────────────────*/

const partner = z
  .object({
    name: z.string().trim().min(1).max(TITLE),
    /** Three different claims. See 13782 — a grid that mixes them makes none. */
    kind: z.enum(["carrier", "client", "network"]),
    url: httpsUrl,
    permission_note: text(LINE),
    sort_order: z.coerce.number().int().min(0).max(9999).optional(),
    is_active: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.is_active && !String(val.permission_note || "").trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["permission_note"],
        message:
          "Record who cleared this mark, and when, before showing it. These are other companies' trademarks.",
      });
    }
  });

const credential = z
  .object({
    name: z.string().trim().min(1).max(TITLE),
    issuer: text(TITLE),
    identifier: text(TITLE),
    issued_on: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    expires_on: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    url: httpsUrl,
    sort_order: z.coerce.number().int().min(0).max(9999).optional(),
    is_active: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.issued_on && val.expires_on && val.expires_on < val.issued_on) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expires_on"],
        message: "A credential cannot expire before it was issued.",
      });
    }
  });

/* ── about ──────────────────────────────────────────────────────────────────*/

const bilingualItem = z.object({
  label_fr: text(TITLE),
  label_en: text(TITLE),
  text_fr: text(PROSE),
  text_en: text(PROSE),
});

/**
 * ESG is THREE FIXED PILLARS, not an open bag.
 *
 * The renderer builds a three-panel scroll-scrubbed interactive from it
 * (PR 4 §8.4), and it can only do that if it knows there are exactly three and
 * what they are called. An open `Record<string, …>` would mean the renderer
 * guessing at whatever an editor typed, and a fourth pillar silently breaking
 * the layout.
 */
const esgPillar = z.object({
  text_fr: text(PROSE),
  text_en: text(PROSE),
  points: z
    .array(z.object({ fr: text(LINE), en: text(LINE) }))
    .max(12)
    .optional(),
});

const about = z.object({
  headline_fr: text(TITLE),
  headline_en: text(TITLE),
  summary_fr: text(PROSE),
  summary_en: text(PROSE),
  mission_fr: text(PROSE),
  mission_en: text(PROSE),
  vision_fr: text(PROSE),
  vision_en: text(PROSE),
  principles: z.array(bilingualItem).max(12).optional(),
  esg: z
    .object({
      environment: esgPillar.optional(),
      social: esgPillar.optional(),
      governance: esgPillar.optional(),
    })
    .optional(),
  timeline: z
    .array(
      z.object({
        year: z.coerce.number().int().min(1800).max(2200),
        label_fr: text(TITLE),
        label_en: text(TITLE),
        text_fr: text(PROSE),
        text_en: text(PROSE),
      }),
    )
    .max(40)
    .optional(),
  founded_year: z.coerce.number().int().min(1800).max(2200).nullable().optional(),
  headquarters: text(TITLE),
});

/* ── leadership ─────────────────────────────────────────────────────────────*/

/**
 * `entity_id` absent or null means GROUP leadership. That nullable field is the
 * entire two-tier mechanism — see 13786.
 */
const leader = z.object({
  entity_id: z.string().uuid().nullable().optional(),
  full_name: z.string().trim().min(1).max(TITLE),
  role_fr: text(TITLE),
  role_en: text(TITLE),
  bio_fr: text(PROSE),
  bio_en: text(PROSE),
  linkedin_url: z
    .string()
    .trim()
    .regex(
      /^https:\/\/([a-z0-9-]+\.)?linkedin\.com\//i,
      "Must be an https link on linkedin.com.",
    )
    .nullable()
    .optional(),
  sort_order: z.coerce.number().int().min(0).max(9999).optional(),
  is_active: z.boolean().optional(),
});

/* ── an entity's public story ───────────────────────────────────────────────*/

/**
 * What a corporate entity says about itself publicly.
 *
 * Statutory identifiers are absent by construction: there is no field here for
 * RCCM or NIU, so no amount of editing can put one on the marketing site. See
 * 13787's header for why that is a decision rather than an omission.
 */
const entityPublicStory = z.object({
  public_enabled: z.boolean().optional(),
  public_summary_fr: text(PROSE),
  public_summary_en: text(PROSE),
  public_coverage: z
    .array(
      z.object({
        country_code: z.string().trim().length(2).toUpperCase(),
        label_fr: text(TITLE),
        label_en: text(TITLE),
      }),
    )
    .max(60)
    .optional(),
  public_focus: z
    .array(
      z.object({
        label_fr: text(TITLE),
        label_en: text(TITLE),
        /** Lets an entity card carry the same harmonised transport colour the
         *  services grid uses, instead of inventing a second colour language. */
        mode: z.enum(["sea", "air", "road", "rail"]).nullable().optional(),
      }),
    )
    .max(24)
    .optional(),
});

/**
 * The whole social set as one form body: `{ linkedin: "https://…", x: "" }`.
 *
 * Shared rather than declared in the API's validator, because `check:schemas`
 * is right to object: a validator that imports this package and then writes its
 * own `z.object(...)` beside it is a shape with two definitions, and the second
 * one drifts. The settings screen posts exactly this object.
 */
const socialSet = z.object(
  Object.fromEntries(SOCIAL_IDS.map((id) => [id, z.string().trim().max(500).optional()])),
);

exports.socialSet = socialSet;
exports.theme = theme;
exports.socialLink = socialLink;
exports.partner = partner;
exports.credential = credential;
exports.about = about;
exports.leader = leader;
exports.entityPublicStory = entityPublicStory;
exports.HEX = HEX;
