/**
 * The verification code rule is written twice. This is what stops the two
 * copies from disagreeing.
 *
 * ── WHY THERE ARE TWO ──────────────────────────────────────────────────────
 *
 * `packages/shared/rules/verify-code.js` is the rule. The API mints and
 * resolves codes with it (`src/services/signatures/tokens.js`) and the ERP's
 * copy of the portal imports it directly, because `client` depends on
 * `@praxis/shared`.
 *
 * `public-web` does not, and may not: D-1, enforced by a `no-restricted-imports`
 * rule in `public-web/eslint.config.js`, because that app installs only its own
 * dependencies in CI. Its message names the remedy this file is — re-declare
 * the value there, and put the cross-package assertion in `tests/unit/` at the
 * repo root, which is the one place that can read both trees.
 *
 * ── WHY DRIFT HERE IS WORSE THAN IT LOOKS ──────────────────────────────────
 *
 * The SERVER normalises a typed code before the lookup. If the browser folded a
 * spelling differently, it would send a code that cannot match — and a customs
 * officer holding a genuine document would read "no verification matches that
 * code". Nothing throws, nothing logs, and both halves pass their own suites.
 * The only place the disagreement is visible is here.
 *
 * ── WHY IT READS THE TS FILE AS TEXT ───────────────────────────────────────
 *
 * Jest at the repo root has no TypeScript transform and `public-web` is ESM, so
 * the copy cannot simply be required. What actually drifts is not the control
 * flow — it is the three constants somebody edits on one side: a character
 * added to the alphabet, a length changed, a substitution dropped. Those are
 * literals, and comparing literals needs no transpiler.
 *
 * The extractors deliberately throw rather than skip when a shape is not found.
 * A parity test that silently passes because it could not locate the alphabet
 * any more is worse than no test: it reports agreement it never checked.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const SHARED = path.join(ROOT, "packages/shared/rules/verify-code.js");
const PUBLIC_WEB = path.join(ROOT, "public-web/src/lib/verify-code.ts");

const read = (p) => fs.readFileSync(p, "utf8");

/** The one capture of `re` in `src`, or a failure naming the file. */
function capture(src, re, what, file) {
  const m = src.match(re);
  if (!m) throw new Error(`could not find ${what} in ${path.relative(ROOT, file)} — the parity test cannot check what it cannot locate`);
  return m[1];
}

const alphabetOf = (src, file) =>
  capture(src, /ALPHABET\s*=\s*"([^"]+)"/, "ALPHABET", file);

const lengthOf = (src, file) =>
  Number(capture(src, /CODE_LENGTH\s*=\s*(\d+)/, "CODE_LENGTH", file));

/**
 * The substitution table, order-insensitively.
 *
 * Both files write it as an object literal passed to `Object.assign`, but one
 * is on a single line and the other is formatted across five, so the pairs are
 * collected rather than the block compared. Sorted, so a reordering is not
 * reported as a difference: `{I:"1",L:"1"}` and `{L:"1",I:"1"}` are the same
 * rule.
 */
function substitutionsOf(src, file) {
  const block = capture(src, /NORMALISE[^=]*=\s*Object\.assign\(\s*Object\.create\(null\)\s*,\s*\{([\s\S]*?)\}\s*\)/, "the NORMALISE table", file);
  const pairs = [...block.matchAll(/([A-Z])\s*:\s*"([^"]*)"/g)].map(([, k, v]) => `${k}=${v}`);
  if (!pairs.length) throw new Error(`NORMALISE in ${path.relative(ROOT, file)} has no pairs`);
  return pairs.sort();
}

describe("verification code rule: packages/shared and public-web agree", () => {
  const shared = read(SHARED);
  const web = read(PUBLIC_WEB);

  it("uses the same Crockford alphabet", () => {
    expect(alphabetOf(web, PUBLIC_WEB)).toBe(alphabetOf(shared, SHARED));
  });

  it("uses the same code length", () => {
    expect(lengthOf(web, PUBLIC_WEB)).toBe(lengthOf(shared, SHARED));
  });

  it("folds the same confusable characters", () => {
    expect(substitutionsOf(web, PUBLIC_WEB)).toEqual(substitutionsOf(shared, SHARED));
  });

  /**
   * The alphabet is not arbitrary: I, L, O and U are excluded, and every
   * character the substitution table folds AWAY must be one of them. Folding a
   * character that is still in the alphabet would make two distinct codes
   * resolve to one, which halves the space quietly.
   */
  it("never folds a character that is still in the alphabet", () => {
    const alphabet = alphabetOf(shared, SHARED);
    for (const pair of substitutionsOf(shared, SHARED)) {
      const [from, to] = pair.split("=");
      expect(alphabet).not.toContain(from);
      expect(alphabet).toContain(to);
    }
  });
});

/**
 * The server's own behaviour, pinned to the values above.
 *
 * `tokens.js` is what a scanned QR and a typed code both resolve through, so
 * these cases are the contract the portal's input field is written against.
 */
describe("verification code rule: the server's behaviour", () => {
  const tokens = require("../../src/services/signatures/tokens");

  it("accepts the printed spelling, with and without separators", () => {
    expect(tokens.isValidCode("A4B7-K92M-XQ1P")).toBe(true);
    expect(tokens.isValidCode("A4B7K92MXQ1P")).toBe(true);
    expect(tokens.isValidCode("a4b7 k92m xq1p")).toBe(true);
    expect(tokens.normaliseCode("a4b7-k92m-xq1p")).toBe("A4B7K92MXQ1P");
  });

  it("folds the confusables a dictated code arrives with", () => {
    // I and L both read as 1, O as 0, U as V — so a code read down a phone
    // line resolves whichever letter the listener wrote down.
    expect(tokens.normaliseCode("ILOU00000000")).toBe("110V00000000");
  });

  it("rejects anything that is not twelve code characters", () => {
    expect(tokens.isValidCode("INV-2026-0042")).toBe(false); // an invoice number: thirteen
    expect(tokens.isValidCode("A4B7K92MXQ1")).toBe(false); // eleven
    expect(tokens.isValidCode("A4B7K92MXQ1PZ")).toBe(false); // thirteen
    expect(tokens.isValidCode("")).toBe(false);
    expect(tokens.isValidCode(null)).toBe(false);
    expect(tokens.isValidCode(undefined)).toBe(false);
  });

  /**
   * A twelve-character alphanumeric string IS a well-formed code, whatever it
   * was before.
   *
   * This looks like a hole and is not one. Crockford folding maps every letter
   * outside the alphabet (I, L, O, U) back into it, so after normalisation any
   * `[0-9A-Z]{12}` is a legal spelling — there is no subset of twelve-character
   * strings the shape check could exclude without also excluding real codes.
   *
   * The shape check is NOT the security boundary and must never be mistaken for
   * one. It exists so a typo costs nothing: a malformed code never leaves the
   * browser and never spends one of the 60 lookups per IP per 15 minutes that
   * `document_verification.routes.js` calls the sole defence against
   * enumerating a plaintext code. What makes a wrong guess useless is the
   * LOOKUP — 2^60 codes, one exact match on a unique index, the same 404 for
   * malformed and never-existed so the endpoint is not an oracle, and that
   * limiter over the top.
   *
   * Pinned as a test so nobody later "fixes" the shape check into a filter and
   * believes they have tightened something.
   */
  it("treats any twelve code characters as well-formed, which the lookup then answers", () => {
    expect(tokens.isValidCode("9F86D081884C")).toBe(true); // a hash prefix, by shape
    expect(tokens.isValidCode("000000000000")).toBe(true);
    // Folded, not rejected: these are the confusables, not foreign characters.
    expect(tokens.isValidCode("ILOUILOUILOU")).toBe(true);
  });

  it("mints codes its own validator accepts", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(tokens.isValidCode(tokens.mintVerifyCode())).toBe(true);
    }
  });
});
