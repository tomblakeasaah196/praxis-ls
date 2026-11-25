"use strict";

const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const { KINDS } = require("./insight.kinds");

/**
 * A slug is lowercase ASCII with single hyphens, or absent.
 *
 * The same rule 12745 states for service profiles, and for the same reason: the
 * column is `text` rather than `citext` because case-insensitivity is a property
 * of this regex, not of the storage. Accented characters are refused rather than
 * transliterated here — a French title becomes `la-douane-en-2026` because
 * somebody wrote that slug, not because a machine guessed at it.
 */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slug = z.string().trim().min(1).max(140).regex(SLUG, "lowercase letters, numbers and single hyphens")
  .optional().nullable();

const text = (max) => z.string().trim().max(max).optional().nullable();

/**
 * A tag is a short free-text label, normalised to lowercase on the way in.
 *
 * Normalising here rather than at read time is what stops "Strategy" and
 * "strategy" appearing as two filters in a bar that is derived from the tags in
 * use. The set is de-duplicated for the same reason.
 */
const tags = z
  .array(z.string().trim().min(1).max(40))
  .max(12)
  .transform((list) => [...new Set(list.map((t) => t.toLowerCase()))])
  .optional();

/**
 * The article's date (14680). A bare `YYYY-MM-DD` (what `<DateField>` and an
 * import's front matter send) or a full ISO instant.
 *
 * A bare day is stored at 12:00 UTC, not midnight. Midnight UTC is the previous
 * evening anywhere west of Greenwich, so a piece dated 1 March would print as
 * 28 February to a reader in New York. Noon is the same calendar day from
 * UTC-11 to UTC+11, which covers every reader this site has.
 *
 * Bounded below at 1990 so a typo of a year cannot date a piece to the Middle
 * Ages; there is no upper bound, because a future date is how scheduling works.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayToInstant = (day) => `${day}T12:00:00.000Z`;
/** A calendar day that exists: 2021-02-31 matches the pattern and is not one. */
const realDay = (day) => {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const publishDate = z
  .union([
    z.string().trim().regex(DAY, "a day as YYYY-MM-DD").refine(realDay, "a day that exists").transform(dayToInstant),
    z.string().trim().datetime({ offset: true }),
  ])
  .refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v).getUTCFullYear() >= 1990, {
    message: "a real date from 1990 onward",
  })
  .optional()
  .nullable();

/** At least one headline, in either language (14680). Enforced here and in
 *  `insight.service.update`, not by a CHECK: the table predates 13791, and a
 *  constraint added to it breaks a fresh tenant's sandbox (see 14680). */
const hasTitle = (v) => Boolean(String(v.title_en || "").trim() || String(v.title_fr || "").trim());
const TITLE_MESSAGE = { message: "Give the article a headline in English or French", path: ["title_en"] };

const base = {
  slug_fr: slug,
  slug_en: slug,
  title_en: text(200),
  excerpt_fr: text(500),
  excerpt_en: text(500),
  // Long, because this is the article. 200 kB is far more than anyone writes
  // and far less than an accident.
  body_fr: text(200000),
  body_en: text(200000),
  meta_title_fr: text(200),
  meta_title_en: text(200),
  meta_description_fr: text(320),
  meta_description_en: text(320),
  cover_vault_id: z.string().guid().optional().nullable(),
  tags,
  author_user_id: z.string().guid().optional().nullable(),
  /* 14680. The byline as it was printed: a name and the role held on the
     article's date. Both optional; the linked staff record (above) is the
     fallback when no name is written. */
  byline_name: text(120),
  byline_role: text(160),
  /* 14680. The article's date, which an editor may now set: past allowed, a
     future date schedules. A bare day is stored at noon UTC, see PUBLISH_DATE. */
  published_at: publishDate,
  sort_order: z.coerce.number().int().min(0).max(100000).optional(),
  /* 13784. An enum rather than free text, and the list comes from
     `insight.kinds` rather than being retyped here — `ck_insight_kind` is the
     real authority and a second copy of two strings is a second place to
     forget. `pinned_until` is deliberately NOT here: pinning has its own
     endpoint, so an ordinary field edit cannot put a piece on the tenant's
     front page. */
  kind: z.enum(KINDS).optional(),
};

/**
 * The cover upload.
 *
 * A data URL, capped well above the vault's own 10 MB so an oversized file is
 * refused by the vault with a message about the file rather than here with a
 * message about the string. `original_name` is carried for the vault's records
 * and is never used to build a path — the storage key is the document id.
 */
const cover = z.object({
  data_url: z.string().min(1).max(14_000_000),
  original_name: z.string().trim().max(200).optional(),
}).strict();

/** The gallery order / removal write: the ids the article should carry, in
 *  display order. The service ignores any id that was not already the
 *  article's, so this cannot bind a foreign document to a public page. */
const gallery = z.object({
  ids: z.array(z.string().guid()).max(12),
}).strict();

const schemas = {
  cover,
  gallery,
  // A headline is the one thing an article cannot exist without, in EITHER
  // language (14680). French was required until the first English-only tenant
  // had to type a French headline to start writing.
  create: z.object({ ...base, title_fr: text(200) }).strict().refine(hasTitle, TITLE_MESSAGE),
  // On an update both may be absent (an untouched headline); the service checks
  // the row that RESULTS still has one.
  update: z.object({ ...base, title_fr: text(200) }).strict(),
  /**
   * One Markdown file with front matter (Settings › Website › Articles ›
   * Import). The TEXT, not the bytes: the file is read in the browser, so this
   * endpoint never sees a binary and never needs the vault. One file per
   * request, so each gets its own progress and its own answer.
   */
  importFile: z.object({
    name: z.string().trim().min(1).max(200),
    text: z.string().min(1).max(200000),
  }).strict(),
  publish: z.object({ published: z.boolean() }).strict(),
  listQuery: z.object({
    tag: z.string().trim().max(40).optional(),
    kind: z.enum(KINDS).optional(),
    /* 14680. The year archive: articles dated in that calendar year. */
    year: z.coerce.number().int().min(1990).max(2100).optional(),
    page: z.coerce.number().int().min(1).max(1000).optional(),
    per_page: z.coerce.number().int().min(1).max(50).optional(),
  }).strict(),
  /**
   * The pin. `pinned_until` is an ISO date-time or null, and null is how a pin
   * is cleared — which is why the field is REQUIRED and nullable rather than
   * optional: an empty body on this endpoint is a caller who has not decided,
   * and silently reading that as "unpin" is how something falls off a homepage
   * because a form serialised badly.
   */
  pin: z.object({
    pinned_until: z.string().datetime({ offset: true }).nullable(),
  }).strict(),
};

const mw = (key, source = "body") => (req, _res, next) => {
  const parsed = schemas[key].safeParse(req[source]);
  if (!parsed.success) {
    return next(new AppError(
      "VALIDATION_ERROR",
      "Please check the article",
      422,
      parsed.error.flatten().fieldErrors,
    ));
  }
  if (source === "body") req.body = parsed.data;
  else req.validatedQuery = parsed.data;
  return next();
};

/** DELETE takes no body. A payload on it is a caller who thinks it does. */
const noBody = z.object({}).strict();
const validateNoBody = (req, _res, next) => {
  if (!noBody.safeParse(req.body ?? {}).success) {
    return next(new AppError("VALIDATION_ERROR", "Body is not accepted on this endpoint", 422));
  }
  return next();
};

module.exports = {
  schemas,
  SLUG,
  publishDate,
  dayToInstant,
  validateNoBody,
  create: mw("create"),
  update: mw("update"),
  publish: mw("publish"),
  cover: mw("cover"),
  gallery: mw("gallery"),
  pin: mw("pin"),
  importFile: mw("importFile"),
  listQuery: mw("listQuery", "query"),
};
