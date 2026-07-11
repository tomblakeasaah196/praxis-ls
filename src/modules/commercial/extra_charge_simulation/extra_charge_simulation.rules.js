/**
 * Extra-charge / demurrage-detention simulator (MOD-28) — pure, NO GL.
 * Shipping lines bill per chargeable day beyond the free period, usually with a
 * rising tiered tariff (e.g. days 1-5 cheaper than 6-10, etc). This computes the
 * per-day breakdown from a tariff the tenant configures in settings.
 */
"use strict";

const { AppError } = require("../../../utils/errors");

const round2 = (n) => Math.round(n * 100) / 100;
const MS_DAY = 24 * 60 * 60 * 1000;

/** Whole days between two ISO dates (to - from), min 0. */
function daysBetween(fromIso, toIso) {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (Number.isNaN(a) || Number.isNaN(b)) throw new AppError("INVALID_DATE", "out_of_port_on / as_of must be YYYY-MM-DD", 422);
  return Math.max(0, Math.floor((b - a) / MS_DAY));
}

/**
 * computeDemurrage({ freeDays, occupiedDays, tiers }) where tiers is an ordered
 * list of { from_day, to_day|null, rate } (day numbers are 1-based, counted
 * AFTER the free period). Returns { chargeable_days, breakdown[], total_amount }.
 */
function computeDemurrage({ freeDays = 0, occupiedDays, tiers = [] }) {
  const free = Math.max(0, Math.floor(Number(freeDays) || 0));
  const occ = Math.floor(Number(occupiedDays));
  if (!Number.isFinite(occ) || occ < 0) throw new AppError("INVALID_DAYS", "occupiedDays must be >= 0", 422);
  if (!Array.isArray(tiers) || tiers.length === 0) throw new AppError("NO_TARIFF", "a demurrage tariff (tiers) is required", 422);

  const chargeable = Math.max(0, occ - free);
  const breakdown = [];
  let total = 0;
  for (let d = 1; d <= chargeable; d += 1) {
    const tier = tiers.find((t) => d >= Number(t.from_day) && (t.to_day === null || t.to_day === undefined || d <= Number(t.to_day)));
    if (!tier) throw new AppError("TARIFF_GAP", "no tariff tier covers chargeable day " + d, 422);
    const rate = round2(Number(tier.rate));
    total += rate;
    breakdown.push({ day: d, rate, tier_from: Number(tier.from_day), tier_to: tier.to_day === null || tier.to_day === undefined ? null : Number(tier.to_day) });
  }
  return { free_days: free, occupied_days: occ, chargeable_days: chargeable, breakdown, total_amount: round2(total) };
}

module.exports = { daysBetween, computeDemurrage };
