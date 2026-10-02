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

module.exports = { NEXT, assertTransition, computeTotals, COSTING_QUOTABLE, normaliseFamilyOrder };
