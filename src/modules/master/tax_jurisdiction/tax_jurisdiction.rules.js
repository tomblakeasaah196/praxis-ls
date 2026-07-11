/**
 * Tax jurisdiction / tax-code (MOD-07) — pure rules.
 *   assertRate            percent codes need a 0–100 rate; bracket codes use `brackets`
 *   assertEffectiveWindow effective_to (if set) must be >= effective_from
 *   pickEffective         the tax_code row effective at a date for one code key
 */
"use strict";
const { AppError } = require("../../../utils/errors");

const RATE_KINDS = new Set(["VAT", "WHT", "INCOME"]);

function assertRate({ kind, ratePercent, brackets }) {
  if (RATE_KINDS.has(kind)) {
    const hasBrackets = brackets && (Array.isArray(brackets) ? brackets.length : Object.keys(brackets).length);
    if ((ratePercent === null || ratePercent === undefined) && !hasBrackets) {
      throw new AppError("NO_RATE", `${kind} tax code needs a rate_percent or a brackets table`, 422);
    }
    if (ratePercent !== null && ratePercent !== undefined) {
      const r = Number(ratePercent);
      if (!Number.isFinite(r) || r < 0 || r > 100) throw new AppError("BAD_RATE", "rate_percent must be 0–100", 422);
    }
  }
  return true;
}

function assertEffectiveWindow({ effectiveFrom, effectiveTo }) {
  if (effectiveTo && effectiveFrom && Date.parse(effectiveTo) < Date.parse(effectiveFrom)) {
    throw new AppError("BAD_WINDOW", "effective_to must be on or after effective_from", 422);
  }
  return true;
}

function pickEffective(rows, date) {
  const d = Date.parse(date);
  const eff = rows.filter((r) => {
    const from = r.effective_from ? Date.parse(r.effective_from) : -Infinity;
    const to = r.effective_to ? Date.parse(r.effective_to) : Infinity;
    return d >= from && d <= to;
  });
  if (eff.length === 0) throw new AppError("NO_EFFECTIVE_CODE", "no tax code effective at " + date, 422);
  eff.sort((a, b) => Date.parse(b.effective_from) - Date.parse(a.effective_from));
  return eff[0];
}

module.exports = { assertRate, assertEffectiveWindow, pickEffective };
