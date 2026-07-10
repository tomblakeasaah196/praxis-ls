/**
 * Tax Center computations (KB §15/§16/§17) — pure, no DB. Operates on a trial
 * balance (validated GL) so débours are already excluded from turnover/VAT
 * (they never touch class 7 or the VAT accounts, KB §6).
 */
"use strict";

const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => Number(v || 0);
const bal = (r) => num(r.debit) - num(r.credit); // debit-positive
const starts = (code, p) => String(code).startsWith(p);

/**
 * TVA (VAT) return, KB §16. Output VAT (443/4432, credit balance) − input VAT
 * (445, debit balance). Net > 0 = due (4441); net < 0 = credit carried (4449).
 */
function vatReturn(rows) {
  let output = 0;
  let input = 0;
  for (const r of rows) {
    if (starts(r.account_code, "443")) output += -bal(r); // collected VAT is a credit balance
    else if (starts(r.account_code, "445")) input += bal(r); // recoverable VAT is a debit balance
  }
  output = round2(output);
  input = round2(input);
  const net = round2(output - input);
  return { output_vat: output, input_vat: input, net, vat_due: Math.max(net, 0), vat_credit: round2(Math.max(-net, 0)) };
}

/** Turnover (chiffre d'affaires) = class 70 credit balances. Débours excluded by design. */
function turnoverFrom(rows) {
  let ca = 0;
  for (const r of rows) if (starts(r.account_code, "70")) ca += -bal(r);
  return round2(ca);
}

/**
 * Corporate income tax + minimum tax, KB §15. IS on taxable profit vs a minimum
 * tax on TURNOVER (paid even at a loss); the greater is due. Rates configurable
 * (defaults: IS 33%, minimum 2.2% réel).
 */
function corporateTax({ result, turnover, isRate = 0.33, minRate = 0.022 }) {
  const isOnProfit = round2(Math.max(num(result), 0) * isRate);
  const minimumTax = round2(num(turnover) * minRate);
  return {
    taxable_profit: round2(Math.max(num(result), 0)),
    turnover: round2(num(turnover)),
    is_on_profit: isOnProfit,
    minimum_tax: minimumTax,
    tax_due: Math.max(isOnProfit, minimumTax),
    basis: minimumTax > isOnProfit ? "MINIMUM_TAX" : "IS",
  };
}

module.exports = { vatReturn, turnoverFrom, corporateTax, bal };
