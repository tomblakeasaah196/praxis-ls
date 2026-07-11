/**
 * Pure, DB-free posting rules — the friendly pre-checks that mirror the KB §23
 * invariants the database also enforces via triggers. We check here first so the
 * caller gets a clear 422 (which line, why) instead of a raw Postgres error, and
 * so the rules are unit-testable without a database.
 *
 * The database remains the source of truth: even if this passed by mistake, the
 * triggers in migrations/tenant/0220_ledger.sql would still reject a bad write.
 */
"use strict";

const { AppError } = require("../../../utils/errors");

// Work in integer minor units (centimes) to avoid float drift when summing money.
function toMinor(v, label) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    throw new AppError("INVALID_AMOUNT", `${label} must be a non-negative number`, 422);
  }
  const minor = Math.round(v * 100);
  if (Math.abs(v * 100 - minor) > 1e-6) {
    throw new AppError("INVALID_AMOUNT", `${label} may have at most 2 decimals`, 422);
  }
  return minor;
}

/**
 * Validate a set of proposed journal lines. Returns { debitMinor, creditMinor }
 * on success; throws AppError(422) otherwise.
 *   #1 balanced · #2 exactly one side > 0 per line · ≥2 lines · postable code shape.
 * (Account existence / postable-leaf / débours-class / dossier-required are DB
 * concerns — enforced by triggers, not guessable here without the COA.)
 */
function assertBalanced(lines) {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new AppError("ENTRY_TOO_FEW_LINES", "A journal entry needs at least two lines", 422);
  }
  let debitMinor = 0;
  let creditMinor = 0;
  lines.forEach((ln, i) => {
    const at = `line ${i + 1}`;
    if (!ln || typeof ln.account_code !== "string" || !ln.account_code.trim()) {
      throw new AppError("LINE_NO_ACCOUNT", `${at}: account_code is required`, 422);
    }
    const d = toMinor(ln.debit || 0, `${at} debit`);
    const c = toMinor(ln.credit || 0, `${at} credit`);
    // #23.2 exactly one of debit/credit > 0.
    if ((d > 0) === (c > 0)) {
      throw new AppError("LINE_ONE_SIDE", `${at}: exactly one of debit/credit must be > 0`, 422);
    }
    debitMinor += d;
    creditMinor += c;
  });
  // #23.1 balanced.
  if (debitMinor !== creditMinor) {
    throw new AppError(
      "ENTRY_UNBALANCED",
      `Entry not balanced: debit ${debitMinor / 100} <> credit ${creditMinor / 100}`,
      422,
    );
  }
  return { debitMinor, creditMinor };
}


/**
 * #23.6 no compensation — an account may not be both debited and credited within
 * one entry (post the net line instead). Structural line-level netting is already
 * blocked by the one-side CHECK; this catches same-account offsetting across lines.
 */
function assertNoCompensation(lines) {
  const deb = new Set();
  const cred = new Set();
  for (const ln of lines) {
    const acc = String(ln.account_code).trim();
    if (Number(ln.debit) > 0) deb.add(acc);
    if (Number(ln.credit) > 0) cred.add(acc);
  }
  for (const acc of deb) {
    if (cred.has(acc)) {
      throw new AppError("COMPENSATION", "account " + acc + " is both debited and credited in one entry — post the net (KB §2.6/#23.6)", 422);
    }
  }
}

module.exports = { assertBalanced, assertNoCompensation, toMinor };
