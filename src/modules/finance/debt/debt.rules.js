/** Project financing / debt (MOD-53, KB §11) — pure posting maths.
 *  Drawdown: Dr treasury (cash in) / Cr 162 (loan liability).
 *  Repayment: Dr 162 (principal) + Dr 671 (interest charge) / Cr treasury. */
"use strict";
const { AppError } = require("../../../utils/errors");
const round2 = (n) => Math.round(n * 100) / 100;

function buildDrawdownLines({ principal, treasuryCoa = "521", loanCoa = "162" }) {
  const p = Number(principal);
  if (!Number.isFinite(p) || p <= 0) throw new AppError("BAD_PRINCIPAL", "principal must be > 0", 422);
  return [
    { account_code: treasuryCoa, debit: round2(p), credit: 0 },
    { account_code: loanCoa, debit: 0, credit: round2(p) },
  ];
}

function buildRepaymentLines({ principalPart = 0, interestPart = 0, treasuryCoa = "521", loanCoa = "162", interestCoa = "671" }) {
  const pp = Number(principalPart) || 0;
  const ip = Number(interestPart) || 0;
  if (pp < 0 || ip < 0) throw new AppError("BAD_AMOUNT", "repayment parts must be >= 0", 422);
  const total = round2(pp + ip);
  if (total <= 0) throw new AppError("ZERO_REPAYMENT", "a repayment must be > 0", 422);
  const lines = [];
  if (pp > 0) lines.push({ account_code: loanCoa, debit: round2(pp), credit: 0 });
  if (ip > 0) lines.push({ account_code: interestCoa, debit: round2(ip), credit: 0 });
  lines.push({ account_code: treasuryCoa, debit: 0, credit: total });
  return lines;
}

module.exports = { buildDrawdownLines, buildRepaymentLines };
