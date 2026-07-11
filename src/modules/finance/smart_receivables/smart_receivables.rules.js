/**
 * Smart Receivables (MOD-52) — pure, DB-free rules.
 *   ageingBuckets  classify outstanding invoices into 0 / 1-30 / 31-60 / 61-90 / 90+
 *   planAllocation apply a receipt to open invoices oldest-first (FIFO)
 *   dunningFor     pick the reminder level for an overdue invoice from tenant policy
 * Money is summed in centimes to avoid float drift.
 */
"use strict";

const { AppError } = require("../../../utils/errors");

const round2 = (n) => Math.round(n * 100) / 100;
const cents = (v) => Math.round(Number(v || 0) * 100);
const MS_DAY = 24 * 60 * 60 * 1000;

function daysOverdue(dueOn, asOf) {
  const a = Date.parse(dueOn);
  const b = Date.parse(asOf);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / MS_DAY);
}

/**
 * ageingBuckets(items, asOf) where item = { outstanding, due_on }.
 * Buckets are keyed by age of the *overdue* portion; not-yet-due sits in `current`.
 */
function ageingBuckets(items, asOf) {
  const b = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  let total = 0;
  for (const it of items) {
    const out = cents(it.outstanding);
    if (out <= 0) continue;
    total += out;
    const od = daysOverdue(it.due_on, asOf);
    if (od <= 0) b.current += out;
    else if (od <= 30) b.d1_30 += out;
    else if (od <= 60) b.d31_60 += out;
    else if (od <= 90) b.d61_90 += out;
    else b.d90_plus += out;
  }
  const toMajor = (o) => round2(o / 100);
  return {
    as_of: asOf,
    current: toMajor(b.current), d1_30: toMajor(b.d1_30), d31_60: toMajor(b.d31_60),
    d61_90: toMajor(b.d61_90), d90_plus: toMajor(b.d90_plus), total: toMajor(total),
  };
}

/**
 * planAllocation(amount, invoices) — FIFO (invoices already ordered oldest-first).
 * Each invoice = { invoice_id, outstanding }. Returns { allocations, applied_total, unapplied }.
 */
function planAllocation(amount, invoices) {
  let remaining = cents(amount);
  if (remaining <= 0) throw new AppError("BAD_AMOUNT", "receipt amount must be > 0", 422);
  const allocations = [];
  for (const inv of invoices) {
    if (remaining <= 0) break;
    const out = cents(inv.outstanding);
    if (out <= 0) continue;
    const take = Math.min(out, remaining);
    allocations.push({ invoice_id: inv.invoice_id, amount: round2(take / 100) });
    remaining -= take;
  }
  const applied = cents(amount) - remaining;
  return { allocations, applied_total: round2(applied / 100), unapplied: round2(remaining / 100) };
}

/**
 * dunningFor(daysOverdue, policy) — policy is an ordered list of
 * { min_days, level, template }. Returns the highest-threshold match, or null.
 */
function dunningFor(overdueDays, policy = []) {
  let chosen = null;
  for (const step of policy) {
    if (overdueDays >= Number(step.min_days) && (!chosen || Number(step.min_days) > Number(chosen.min_days))) {
      chosen = step;
    }
  }
  return chosen ? { level: chosen.level, template: chosen.template || null, min_days: Number(chosen.min_days) } : null;
}

module.exports = { ageingBuckets, planAllocation, dunningFor, daysOverdue };
