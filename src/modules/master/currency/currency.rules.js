/**
 * FX resolution (MOD-08) — pure. Given fx_rate_daily rows, resolve the rate to
 * apply for (base→quote) at a date. In order:
 *
 *   1. identity when base === quote;
 *   2. a FIXED PARITY (XAF/XOF ↔ EUR, @praxis/shared currencies.fixedParity) —
 *      a treaty rate, so no stored row is even consulted;
 *   3. a STANDING manual override — see below;
 *   4. else the newest feed/rebase row on/before the date (a rebase override
 *      wins on its own date, as before);
 *   5. else a released override, newest first — a pair that has only ever been
 *      priced by hand still resolves after "Follow the feed again".
 *
 * Returns null when no rate is known (caller falls back / errors).
 *
 * ── WHY A MANUAL OVERRIDE NOW STANDS ───────────────────────────────────────
 *
 * The old rule preferred an override only on the SAME date, so a treasurer's
 * rate set on Monday was beaten by Tuesday's 00:00 feed row — the override
 * lasted until midnight (meeting 6, register 3.1). An override is a decision,
 * not a quote: it now stands until a NEWER override replaces it or someone
 * releases it ("Follow the feed again", which stamps `released_on`). A release
 * is dated, so resolving a past date still finds the override that was in force
 * then. Rebase rows (source 'rebase') are machine-written anchors and keep the
 * old same-date rule; only a human's 'manual' rate stands.
 *
 * `currency.repo.latestRatesFromBase` orders its DISTINCT ON the same way — the
 * two must change together, and tests/unit/currency-override-stands.test.js
 * holds them to it.
 */
"use strict";

const { currencies } = require("@praxis/shared");

/** A human's override, not yet released as of `date`. */
function isStanding(r, date) {
  return r.is_override === true && r.source === "manual" && !(r.released_on && r.released_on <= date);
}

/** A human's override that someone released on or before `date`. */
function isReleased(r, date) {
  return r.is_override === true && r.source === "manual" && !!r.released_on && r.released_on <= date;
}

const newestFirst = (a, b) => {
  if (a.as_of_date !== b.as_of_date) return a.as_of_date < b.as_of_date ? 1 : -1;
  const fa = a.fetched_at ? String(new Date(a.fetched_at).toISOString()) : "";
  const fb = b.fetched_at ? String(new Date(b.fetched_at).toISOString()) : "";
  return fa === fb ? 0 : fa < fb ? 1 : -1;
};

/**
 * The fixed parity for a pair as a resolver row, or null. `rate` is computed
 * from the peg in the direction asked, at full precision.
 */
function fixedRate(base, quote, date) {
  const p = currencies.fixedParity(base, quote);
  if (!p) return null;
  return {
    base_code: p.base,
    quote_code: p.quote,
    rate: p.rate,
    as_of_date: date,
    source: "fixed-parity",
    is_override: false,
    is_fixed: true,
    authority: p.authority,
    anchor: p.anchor,
  };
}

function pickRate(rows, base, quote, date) {
  if (base === quote) return { rate: 1, source: "identity", as_of_date: date, is_override: false };
  const fixed = fixedRate(base, quote, date);
  if (fixed) return fixed;
  const onOrBefore = (rows || []).filter((r) => r.base_code === base && r.quote_code === quote && r.as_of_date <= date);

  const standing = onOrBefore.filter((r) => isStanding(r, date)).sort(newestFirst);
  if (standing.length) return { ...standing[0], standing: true };

  const working = onOrBefore
    .filter((r) => !isReleased(r, date))
    .sort((a, b) => {
      if (a.as_of_date !== b.as_of_date) return a.as_of_date < b.as_of_date ? 1 : -1; // newest first
      return (b.is_override ? 1 : 0) - (a.is_override ? 1 : 0); // a rebase anchor wins on its own date
    });
  if (working.length) return working[0];

  const released = onOrBefore.filter((r) => isReleased(r, date)).sort(newestFirst);
  return released[0] || null;
}

/** Convert an amount base→quote given a rate row; rounds to 2 decimals. */
function convert(amount, rateRow) {
  if (!rateRow) return null;
  return Math.round(Number(amount) * Number(rateRow.rate) * 100) / 100;
}

/**
 * Rebase the current cross-rate table from OLD base to NEW base — PURE.
 *
 * Rates are stored "1 base = rate × quote". To make NEW the anchor we need, for
 * every quote currency, the current NEW→quote rate, plus the NEW→OLD rate so the
 * old base stays priced. We derive them from the OLD→quote table:
 *
 *   old→new = R (the current OLD base → NEW rate; required — you cannot rebase
 *              onto a currency you have no rate for)
 *   new→quote = (old→quote) / R      — cancels the OLD base out of the cross
 *   new→old   = 1 / R                — the reciprocal keeps OLD priced under NEW
 *   new→new   = skipped              — a base is 1:1 with itself, never stored
 *
 * `rows` is the DISTINCT-ON-quote current table for OLD (repo.latestRatesFromBase):
 * `[{ quote_code, rate }]`. Returns `{ pairs: [{ quote, rate }], missing }` where
 * `pairs` are NEW→quote rows to write and `missing` is true when OLD→NEW is
 * unknown (the caller refuses the rebase — there is no meaningful anchor).
 *
 * Precision: division can produce long decimals; fx_rate_daily is numeric(18,8),
 * so we round to 8 dp here to match what the column would store, keeping the
 * pure math and the persisted value identical for tests.
 */
function round8(n) {
  return Math.round(Number(n) * 1e8) / 1e8;
}

function rebaseRates(rows, oldBase, newBase) {
  if (oldBase === newBase) return { pairs: [], missing: false };
  const byQuote = new Map();
  for (const r of rows || []) byQuote.set(r.quote_code, Number(r.rate));
  // A fixed parity is the law, not whatever row happens to be stored for the
  // pair — the cross table is computed from it so a rebase through EUR is exact.
  for (const quote of [...byQuote.keys(), newBase]) {
    const fixed = currencies.fixedParity(oldBase, quote);
    if (fixed) byQuote.set(quote, fixed.rate);
  }
  const oldToNew = byQuote.get(newBase);
  if (!(oldToNew > 0)) return { pairs: [], missing: true };

  const pairs = [];
  // NEW→OLD: the reciprocal of OLD→NEW keeps the old base priced under the new one.
  // A fixed pair is never written: the resolver answers it from the peg.
  if (!currencies.isFixedPair(newBase, oldBase)) pairs.push({ quote: oldBase, rate: round8(1 / oldToNew) });
  // NEW→every other quote: cancel OLD out of the cross-rate.
  for (const [quote, rate] of byQuote) {
    if (quote === newBase || quote === oldBase) continue; // self / handled above
    if (!(rate > 0)) continue;
    if (currencies.isFixedPair(newBase, quote)) continue;
    pairs.push({ quote, rate: round8(rate / oldToNew) });
  }
  return { pairs, missing: false };
}

module.exports = { pickRate, fixedRate, isStanding, isReleased, convert, rebaseRates, round8 };
