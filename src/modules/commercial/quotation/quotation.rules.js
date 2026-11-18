/**
 * Quotation (MOD-27) — pure lifecycle + totals.
 * DRAFT→SENT→ACCEPTED/REJECTED/EXPIRED ; ACCEPTED→CONVERTED (to a final invoice).
 * total_ht = Σ qty·unit_price; total_ttc adds VAT on taxed, non-débours lines at
 * the tenant standard rate (débours are pass-through, never taxed — KB §6/§23.5).
 */
"use strict";
const { AppError } = require("../../../utils/errors");

const NEXT = {
  DRAFT: ["SENT"],
  SENT: ["ACCEPTED", "REJECTED", "EXPIRED"],
  ACCEPTED: ["CONVERTED"],
  REJECTED: [], EXPIRED: [], CONVERTED: [],
};
function assertTransition(from, to) {
  if (!NEXT[from] || !NEXT[from].includes(to)) throw new AppError("BAD_STATE", `Cannot move quotation ${from} -> ${to}`, 422);
  return true;
}

const round2 = (n) => Math.round(n * 100) / 100;
const cents = (v) => Math.round(Number(v || 0) * 100);

/** computeTotals(lines, vatRatePercent) → { total_ht, vat_total, total_ttc }. */
function computeTotals(lines, vatRatePercent = 19.25) {
  let htC = 0;
  let taxableC = 0;
  (lines || []).forEach((l) => {
    const lineC = Math.round(cents(l.unit_price) * Number(l.qty || 1));
    htC += lineC;
    if (l.is_disbursement !== true && l.tax_code_id) taxableC += lineC;
  });
  const vatC = Math.round(taxableC * (Number(vatRatePercent) / 100));
  return { total_ht: round2(htC / 100), vat_total: round2(vatC / 100), total_ttc: round2((htC + vatC) / 100) };
}

/**
 * "Create quotation" is offered on a costing that has been validated or
 * approved (meeting 6, auditor default): SUBMITTED_FOR_APPROVAL has passed its
 * validator, APPROVED_LOCKED is approved, UNLOCK_REQUESTED is still approved
 * while the reopening is decided. A DRAFT, a sheet still with its validator and
 * a REJECTED one are not yet numbers anyone stands behind.
 */
const COSTING_QUOTABLE = new Set(require("@praxis/shared").quotation.COSTING_QUOTABLE);

/**
 * A document's family order (meeting 6, G2): an array of heading keys — a
 * CLIENT_HEADING code, or "custom:<text>" for a family made up on the
 * document. Trimmed, de-duplicated, bounded; anything else is dropped rather
 * than refused, because an order that names a family the document no longer
 * has is harmless (the printer skips it).
 */
function normaliseFamilyOrder(order) {
  if (!Array.isArray(order)) return [];
  const out = [];
  for (const k of order) {
    const key = typeof k === "string" ? k.trim().slice(0, 160) : "";
    if (key && !out.includes(key)) out.push(key);
    if (out.length >= 60) break;
  }
  return out;
}

/* ── one document (lean revamp, PR 4) ──────────────────────────────────────
 *
 * The vocabularies the quotation table cannot hold as a CHECK (14540, the
 * 13791 rule), from the one definition both sides read.
 */
const shared = require("@praxis/shared").quotation;
const { SECTION_KEYS, EXTRACT_SECTIONS, TEXT_SECTIONS, TEMPLATE_TEXT_SECTIONS, ALWAYS_ON, LANGUAGES, OUTPUTS } = shared;

function assertLanguage(v) {
  if (v !== undefined && v !== null && !LANGUAGES.includes(v)) {
    throw new AppError("VALIDATION_ERROR", "Language is EN, FR or BILINGUAL", 422, { language: [`one of ${LANGUAGES.join(", ")}`] });
  }
}
function assertOutput(v) {
  if (v !== undefined && v !== null && !OUTPUTS.includes(v)) {
    throw new AppError("VALIDATION_ERROR", "Output is FULL or EXTRACT", 422, { default_output: [`one of ${OUTPUTS.join(", ")}`] });
  }
}

/** A quotation is for a client or a prospect's company row; never for nobody. */
function assertParty({ client_id: clientId, lead_id: leadId }) {
  if (!clientId && !leadId) {
    throw new AppError("QUOTATION_PARTY_REQUIRED", "Say which client or prospect this quotation is for", 422, {
      client_id: ["a client or a prospect (lead_id) is required"],
    });
  }
}

/**
 * The languages a reader may switch between: a bilingual quotation offers
 * both, a single-language one only its own. A sheet is always ONE language
 * (template.service resolveDocLanguage, the owner's rule): "both" means both
 * are on offer, never a slash on every label.
 */
function languagesOf(row) {
  const own = String((row && row.language) || "").toUpperCase();
  if (own === "EN" || own === "FR") return [own];
  return ["EN", "FR"];
}

/** The one language a render comes out in: the one asked for when it is on offer, else the first. */
function pickLanguage(row, requested) {
  const offered = languagesOf(row);
  const asked = String(requested || "").toUpperCase().slice(0, 2);
  return offered.includes(asked) ? asked : offered[0];
}

/**
 * Which sections print, in the library's order: the Full Proposal prints what
 * is switched on; the Commercial Extract prints the letterhead cover, Pricing,
 * Terms and Next Steps. Pricing always. The switch never touches a number:
 * the lines and totals are read once, whatever this returns.
 */
function printedKeys(output, rows = []) {
  const byKey = new Map((rows || []).map((r) => [r.section_key, r]));
  const allowed = output === "EXTRACT" ? EXTRACT_SECTIONS : SECTION_KEYS;
  return SECTION_KEYS.filter((k) => {
    if (!allowed.includes(k)) return false;
    if (ALWAYS_ON.includes(k)) return true;
    const r = byKey.get(k);
    // A quotation from before sections existed (or one migrated from a
    // proposal) carries only the sections that had words: the automatic ones
    // print, the written ones only when present.
    if (!r) return k === "cover" || k === "next_steps" || k === "terms";
    return r.enabled !== false;
  });
}

/**
 * The public link is open: sent, not revoked, not past its own expiry, and the
 * offer itself still valid (valid_until is the last day it can be accepted).
 * Answered quotations (accepted, declined) stay READABLE on the link; only the
 * answering needs `answerable`.
 */
const isoDay = (d) => (d ? (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10) : null);
function linkState(row, now = new Date()) {
  if (!row || !row.share_token_hash) return "CLOSED";
  if (row.share_revoked_at) return "REVOKED";
  if (row.share_expires_at && new Date(row.share_expires_at) <= now) return "EXPIRED";
  if (!["SENT", "ACCEPTED", "REJECTED", "CONVERTED", "EXPIRED"].includes(row.status)) return "CLOSED";
  return "OPEN";
}
function answerable(row, now = new Date()) {
  if (!row || row.status !== "SENT") return false;
  const until = isoDay(row.valid_until);
  return !(until && until < now.toISOString().slice(0, 10));
}

/** When the link stops opening: the end of the offer's last valid day, or 30 days with no date. */
function shareExpiry(validUntil, now = new Date()) {
  const day = isoDay(validUntil);
  if (day) return new Date(`${day}T23:59:59.999Z`);
  return new Date(now.getTime() + 30 * 86_400_000);
}

/** Three working days from a date (Saturday and Sunday skipped), at 09:00 UTC. */
function workingDaysFrom(from, days = 3) {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left -= 1;
  }
  d.setUTCHours(9, 0, 0, 0);
  return d;
}

module.exports = {
  NEXT, assertTransition, computeTotals, COSTING_QUOTABLE, normaliseFamilyOrder,
  SECTION_KEYS, EXTRACT_SECTIONS, TEXT_SECTIONS, TEMPLATE_TEXT_SECTIONS, ALWAYS_ON, LANGUAGES, OUTPUTS,
  assertLanguage, assertOutput, assertParty, languagesOf, pickLanguage, printedKeys, linkState, answerable,
  shareExpiry, workingDaysFrom, isoDay,
};
