/** Expense rate card (MOD-10) — pure resolver. Given a set of effective-dated
 *  rows for one dictionary item, pick the rate effective at a date, optionally
 *  filtered by shipping_line + variant (most specific match wins). */
"use strict";
const { AppError } = require("../../../utils/errors");

function within(row, date) {
  const from = row.effective_from ? Date.parse(row.effective_from) : -Infinity;
  const to = row.effective_to ? Date.parse(row.effective_to) : Infinity;
  const d = Date.parse(date);
  return d >= from && d <= to;
}

/** pickRate(rows, { date, shippingLine, variant }) — most specific effective row. */
function pickRate(rows, { date, shippingLine = null, variant = null }) {
  const eff = rows.filter((r) => within(r, date));
  if (eff.length === 0) throw new AppError("NO_RATE", "no expense rate effective at " + date, 422);
  const score = (r) => (r.shipping_line && r.shipping_line === shippingLine ? 2 : (r.shipping_line ? -1 : 0)) + (r.variant && r.variant === variant ? 1 : (r.variant ? -1 : 0));
  const eligible = eff.filter((r) => (!r.shipping_line || r.shipping_line === shippingLine) && (!r.variant || r.variant === variant));
  if (eligible.length === 0) throw new AppError("NO_RATE_MATCH", "no expense rate matches the given shipping_line/variant", 422);
  eligible.sort((a, b) => score(b) - score(a) || Date.parse(b.effective_from) - Date.parse(a.effective_from));
  return eligible[0];
}

module.exports = { pickRate, within };
