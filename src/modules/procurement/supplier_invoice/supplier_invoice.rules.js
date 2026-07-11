/**
 * Supplier invoice (MOD-61) — pure three-way-match + posting maths (KB §8.5).
 * Match reconciles PR↔PO↔GRN↔invoice: a GRN must exist and the invoiced amount
 * must agree with the PO within tolerance. Posting lines are built here so they
 * are unit-testable and always balance.
 */
"use strict";

const { AppError } = require("../../../utils/errors");
const round2 = (n) => Math.round(n * 100) / 100;
const cents = (v) => Math.round(Number(v || 0) * 100);

/** matchThreeWay({ poTotal, invoiceTotalHt, grnExists, tolerancePercent }). */
function matchThreeWay({ poTotal, invoiceTotalHt, grnExists, tolerancePercent = 0 }) {
  const reasons = [];
  if (!grnExists) reasons.push("no goods-received note for this PO");
  const po = cents(poTotal);
  const inv = cents(invoiceTotalHt);
  const variancePct = po > 0 ? round2((Math.abs(inv - po) / po) * 100) : (inv > 0 ? 100 : 0);
  if (variancePct > Number(tolerancePercent)) reasons.push(`amount variance ${variancePct}% exceeds tolerance ${tolerancePercent}%`);
  return { matched: reasons.length === 0, variance_percent: variancePct, po_total: round2(po / 100), invoice_total_ht: round2(inv / 100), reasons };
}

/**
 * buildPostingLines({ lines, vatTotal, whtTotal, supplierAccount, vatAccount, whtAccount })
 * → balanced legs: Dr expense (per line) + Dr input-VAT; Cr supplier (net of WHT) + Cr WHT.
 * lines = [{ expense_account, qty, unit_price }].
 */
function buildPostingLines({ lines, vatTotal = 0, whtTotal = 0, dossierId = null, supplierAccount = "4011", vatAccount = "4452", whtAccount = "4471" }) {
  if (!Array.isArray(lines) || lines.length === 0) throw new AppError("NO_LINES", "supplier invoice needs at least one line", 422);
  const legs = [];
  let htCents = 0;
  lines.forEach((ln, i) => {
    const acct = ln.expense_account;
    if (!acct) throw new AppError("NO_EXPENSE_ACCOUNT", `line ${i + 1}: expense_account (6xx) is required`, 422);
    const lineHt = Math.round(cents(ln.unit_price) * Number(ln.qty || 1));
    if (lineHt <= 0) throw new AppError("ZERO_LINE", `line ${i + 1}: amount must be > 0`, 422);
    htCents += lineHt;
    legs.push({ account_code: acct, debit: round2(lineHt / 100), credit: 0, dossier_id: dossierId, dictionary_item_id: ln.dictionary_item_id || null });
  });
  const vat = cents(vatTotal);
  const wht = cents(whtTotal);
  if (vat > 0) legs.push({ account_code: vatAccount, debit: round2(vat / 100), credit: 0, dossier_id: null });
  const supplierCredit = htCents + vat - wht;
  if (supplierCredit <= 0) throw new AppError("BAD_TOTALS", "supplier net payable must be > 0", 422);
  legs.push({ account_code: supplierAccount, debit: 0, credit: round2(supplierCredit / 100), dossier_id: null });
  if (wht > 0) legs.push({ account_code: whtAccount, debit: 0, credit: round2(wht / 100), dossier_id: null });
  return { lines: legs, amount_ht: round2(htCents / 100), amount_ttc: round2((htCents + vat) / 100) };
}

module.exports = { matchThreeWay, buildPostingLines };
