"use strict";
/**
 * The AI-suggested OHADA posting of a dictionary line (meeting 6, F3/F7/F8).
 *
 * ── WHY THIS IS SHARED ─────────────────────────────────────────────────────
 *
 * The API parses the model's answer with `answer`, and the dictionary wizard
 * sends `request` and receives a suggestion it renders and pre-fills from. A
 * shape the screen believes and the API refuses is a suggestion nobody can
 * use, so there is one definition.
 *
 * ── WHAT THE MODEL IS ASKED, AND WHAT IT IS NOT ────────────────────────────
 *
 * Only the GENERIC SYSCOHADA treatment of a KIND of line: the line's label,
 * its category and (when the person has chosen one) its direction are the
 * whole question. No amounts, no client or supplier, no file, no tenant
 * account label is ever sent — which is what lets one answer serve every
 * tenant from the platform cache.
 *
 * ── AN ANSWER THAT DOES NOT PARSE IS A FAILURE ────────────────────────────
 *
 * `answer` is strict. A reply that does not satisfy it is never half-applied:
 * the engine falls back to the labelled local suggestion instead.
 */

const { z } = require("zod");

const DIRECTIONS = ["REVENUE", "EXPENSE", "DISBURSEMENT", "ASSET"];
const CATEGORIES = ["disbursement", "service", "overhead", "asset", "other"];
const CONTEXTS = ["sale", "purchase", "disbursement"];
/**
 * How VAT treats the line, in our words (the tax code itself is the tenant's
 * and is mapped locally):
 *   STANDARD   the normal rate (19.25 % in Cameroon) applies
 *   EXEMPT     exempt or outside the scope of VAT
 *   DISBURSEMENT  a débours: re-billed at cost, no VAT of ours
 */
const VAT_TREATMENTS = ["STANDARD", "EXEMPT", "DISBURSEMENT"];
const CONFIDENCES = ["high", "medium", "low"];
/** Where a suggestion came from — the audit trail and the screen both say it. */
const SOURCES = ["cache", "near_cache", "search", "local"];

/** A SYSCOHADA account number: two to eight digits, class 1 to 9. */
const account = z.string().regex(/^[1-9]\d{1,7}$/, "a SYSCOHADA account number");

const posting = z.object({
  context: z.enum(CONTEXTS),
  debit: account,
  credit: account,
});

/** The model's answer, exactly as it must arrive (and the cached part of it). */
const answer = z
  .object({
    direction: z.enum(DIRECTIONS),
    is_disbursement: z.boolean(),
    vat_treatment: z.enum(VAT_TREATMENTS),
    postings: z.array(posting).min(1).max(3),
    confidence: z.enum(CONFIDENCES),
    /** False when the sources the model read disagree — lowers confidence. */
    sources_agree: z.boolean().optional(),
    /** Short, generic — never cached (Google's terms), shown with the answer. */
    rationale: z.string().max(1200).optional(),
  })
  .strict()
  .refine((a) => a.direction !== "DISBURSEMENT" || a.is_disbursement, {
    message: "a DISBURSEMENT line is a débours",
  })
  .refine((a) => !a.is_disbursement || a.vat_treatment === "DISBURSEMENT", {
    message: "a débours carries no VAT of ours",
  });

/** What the wizard sends. Generic by construction — see the header. */
const request = z.object({
  label_fr: z.string().trim().min(2).max(160),
  label_en: z.string().trim().max(160).nullish(),
  category: z.enum(CATEGORIES),
  direction: z.enum(DIRECTIONS).nullish(),
  /** "Search again": skip the cache and ask afresh. */
  fresh: z.boolean().optional(),
});

/** What the wizard sends back on save, for the audit trail (F3). */
const provenance = z
  .object({
    source: z.enum(SOURCES),
    model: z.string().max(120).nullish(),
    cache_entry_id: z.string().uuid().nullish(),
    confidence: z.enum(CONFIDENCES),
    direction: z.enum(DIRECTIONS),
    suggested_rules: z
      .array(
        z.object({
          applies_context: z.enum(CONTEXTS),
          debit_account: z.string().nullish(),
          credit_account: z.string().nullish(),
        }),
      )
      .max(3),
    /** A low-confidence posting carries "Check this one" until confirmed. */
    checked: z.boolean().optional(),
  })
  .strict();

exports.DIRECTIONS = DIRECTIONS;
exports.CATEGORIES = CATEGORIES;
exports.CONTEXTS = CONTEXTS;
exports.VAT_TREATMENTS = VAT_TREATMENTS;
exports.CONFIDENCES = CONFIDENCES;
exports.SOURCES = SOURCES;
exports.answer = answer;
exports.request = request;
exports.provenance = provenance;

/** One step down the ladder: high → medium → low (low stays low). */
exports.lowerConfidence = (c) => (c === "high" ? "medium" : "low");
