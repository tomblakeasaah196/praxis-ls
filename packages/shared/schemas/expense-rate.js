"use strict";
/**
 * An expense rate and its VAT basis (meeting 6, register 3.4, owner decision F4).
 *
 * ── WHY THIS IS SHARED ─────────────────────────────────────────────────────
 *
 * The rate dialog (expense rates, and the dictionary's "Edit standard rate")
 * previews "72 700 TTC = 60 964 HT at 19,25 %" before the person saves, and the
 * API stores the HT it computes. Two copies of the division disagree by a
 * franc, and the visible failure is a saved rate that is not the one the
 * dialog showed. So the shapes AND the arithmetic live here.
 *
 * ── WHAT `rate` MEANS ──────────────────────────────────────────────────────
 *
 * `rate` is the figure the person typed. With `price_includes_vat` off (the
 * default) it is HT and stored as is. With it on it is TTC: the API stores
 * `rate_ttc` = that figure and `rate` = htFromTtc(figure, the line's VAT rate),
 * so every reader of `expense_rate.rate` (costing, simulations, the resolver)
 * keeps reading HT and a costing adds VAT exactly once.
 *
 * A débours is always HT — it carries no VAT of ours — so the API refuses the
 * flag on one and the dialog does not offer it.
 */

const { z } = require("zod");

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();

/** "The figure I typed includes VAT." Off unless said. */
const vatBasis = { price_includes_vat: z.boolean().optional() };

const create = z.object({
  dictionary_item_id: uuid,
  rate_provider_id: uuid.optional().nullable(),
  container_type_ref_id: uuid.optional().nullable(),
  rate: z.number().nonnegative(),
  currency: z.string().length(3).optional(),
  effective_from: day.optional(),
  effective_to: day.optional().nullable(),
  note: z.string().optional().nullable(),
  ...vatBasis,
});

const update = z.object({
  rate_provider_id: uuid.optional().nullable(),
  container_type_ref_id: uuid.optional().nullable(),
  rate: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  effective_from: day.optional(),
  effective_to: day.optional().nullable(),
  note: z.string().optional().nullable(),
  ...vatBasis,
});

/** AI-facing: expense_rate_id in the payload → list_expense_rates picker. */
const aiUpdate = update.omit({ note: true }).extend({ expense_rate_id: uuid });

/** The dictionary's "Edit standard rate" / a carrier's cell: a new series point. */
const supersede = z.object({
  rate: z.number().nonnegative(),
  currency: z.string().length(3).optional(),
  effective_from: day,
  effective_to: day.nullish(),
  // NULL = the item's plain default rate (no carrier/authority scope).
  rate_provider_id: uuid.nullish(),
  // NULL = no equipment dimension (an authority fee per BL, an air rate
  // priced by weight rather than by box).
  container_type_ref_id: uuid.nullish(),
  note: z.string().nullish(),
  ...vatBasis,
});

/** "Apply to all carriers": one rate, many series. */
const applyAll = z.object({
  rate: z.number().nonnegative(),
  currency: z.string().length(3).optional(),
  effective_from: day,
  container_type_ref_id: uuid.nullish(),
  rate_provider_ids: z.array(uuid).min(1).max(200),
  note: z.string().nullish(),
  ...vatBasis,
});

const resolveQuery = z.object({
  dictionary_item_id: uuid,
  date: day.optional(),
  rate_provider_id: uuid.optional(),
  container_type_ref_id: uuid.optional(),
});

/** The VAT rate a line's TTC price would be divided by, for the dialog's preview. */
const vatBasisQuery = z.object({
  dictionary_item_id: uuid,
  date: day.optional(),
});

// Bulk import. Uploads ride the same base64 data-URL convention as the vault
// and the financial-dictionary importer (one upload shape, no multipart
// middleware). Commit carries the STAGING rows; raw cell values are
// re-validated server-side.
const importUpload = z.object({
  file: z.string().min(1),
  filename: z.string().optional(),
});
const importCommit = z.object({
  rows: z
    .array(
      z.object({
        row: z.number().int().positive().optional(),
        data: z.record(z.string(), z.unknown()).optional(),
        raw: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .max(2000),
});

/**
 * HT from a VAT-inclusive price: TTC ÷ (1 + rate/100).
 *
 * NOT rounded — money keeps its precision until display; the column it lands
 * in (`expense_rate.rate`, numeric(18,2)) is the only rounding, and the API
 * does that, not this function. Null when either side is not a number.
 */
function htFromTtc(ttc, vatRatePercent) {
  const t = Number(ttc);
  const r = Number(vatRatePercent);
  if (!Number.isFinite(t) || !Number.isFinite(r) || r < 0) return null;
  return t / (1 + r / 100);
}

/**
 * Does a free-text note say the price includes VAT? Used to LIST existing rates
 * for review (F4 changes no existing rate). English and French, the spellings
 * seen in tenant data: "TTC", "T.T.C.", "VAT inclusive", "incl. VAT",
 * "inclusive of VAT", "TVA incluse", "TVA comprise", "toutes taxes comprises".
 */
const TTC_NOTE =
  /(\bT\.?\s?T\.?\s?C\b\.?|\bVAT[\s-]*incl(?:usive|uded|\.)?|\bincl(?:usive|uding|\.)?\s+(?:of\s+)?VAT\b|\bTVA\s+(?:incluse|comprise)|\btoutes\s+taxes\s+comprises\b)/i;
function noteSaysTtc(note) {
  return typeof note === "string" && TTC_NOTE.test(note);
}

exports.create = create;
exports.update = update;
exports.aiUpdate = aiUpdate;
exports.supersede = supersede;
exports.applyAll = applyAll;
exports.resolveQuery = resolveQuery;
exports.vatBasisQuery = vatBasisQuery;
exports.importUpload = importUpload;
exports.importCommit = importCommit;
exports.htFromTtc = htFromTtc;
exports.noteSaysTtc = noteSaysTtc;
