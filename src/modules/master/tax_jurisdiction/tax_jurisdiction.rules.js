/**
 * Tax jurisdiction / tax-code (MOD-07) — pure rules.
 *   assertRate            percent codes need a 0–100 rate; bracket codes use `brackets`
 *   assertEffectiveWindow effective_to (if set) must be >= effective_from
 *   assertPostingAccounts BOTH sides of the entry are named (meeting 7)
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

/**
 * A tax code says BOTH accounts it posts to, or it is not configuration — it is a
 * half-written rate card.
 *
 * ── WHY THIS IS A RULE AND NOT A PREFERENCE ────────────────────────────────
 *
 * Meeting 7 (1 Oct 2026), 01:25:15, live in front of the tenant: "I think
 * there's a problem here, it doesn't write the accounts it posts to, that means
 * accounts to be debited and credited … debit accounts none … So I'll ensure that
 * every account is actually mapped to their account." Nine of the twenty-one
 * seeded codes had one side NULL (repaired by seed 9161).
 *
 * Nothing caught it because `determination.compute` reads ONE side per context —
 * the credit on a sale, the debit on a purchase — and takes the counterpart from
 * the document. So the invoice path posted correctly while the rate card was
 * half-written, and every OTHER reader (this screen, the payroll posting, the
 * declaration pack, a person checking the mapping before go-live) read "none".
 * A gap that one code path happens not to need is still a gap the next one does.
 *
 * ── AND BOTH MUST BE POSTABLE LEAVES ───────────────────────────────────────
 *
 * Three seeded codes pointed at a non-postable HEADING (`62`, `447`, `521`),
 * which is worse than NULL because it looks mapped. The screen's own picker only
 * offers postable accounts, so those values were not even reachable from the UI
 * that maintains them. `postable` is the set of codes the caller resolved from
 * chart_of_accounts; pass null to skip the check (a caller with no account list
 * in hand still gets the presence check).
 */
function assertPostingAccounts({ postsDebitAccount, postsCreditAccount }, postable = null) {
  const missing = {};
  if (!postsDebitAccount) missing.posts_debit_account = ["required"];
  if (!postsCreditAccount) missing.posts_credit_account = ["required"];
  if (Object.keys(missing).length) {
    throw new AppError(
      "TAX_CODE_UNMAPPED",
      "A tax code must name the account it debits AND the account it credits — a line mapped on one side only posts nowhere.",
      422,
      missing,
    );
  }
  if (!postable) return true;
  const set = postable instanceof Set ? postable : new Set(postable);
  const bad = {};
  if (!set.has(String(postsDebitAccount))) bad.posts_debit_account = ["not a postable account"];
  if (!set.has(String(postsCreditAccount))) bad.posts_credit_account = ["not a postable account"];
  if (Object.keys(bad).length) {
    throw new AppError(
      "ACCOUNT_NOT_POSTABLE",
      "Both accounts must be postable leaves of the chart of accounts — a heading such as 44 or 52 is not a posting target.",
      422,
      bad,
    );
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

module.exports = { assertRate, assertEffectiveWindow, assertPostingAccounts, pickEffective };
