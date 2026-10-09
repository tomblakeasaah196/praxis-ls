/**
 * The printed verification code: what a human may type, and what counts as
 * typable at all.
 *
 * ── A DELIBERATE COPY, AND WHAT HOLDS IT IN PLACE ──────────────────────────
 *
 * The rule itself lives in `packages/shared/rules/verify-code.js`, which the
 * API mints and resolves codes with (`src/services/signatures/tokens.js`). This
 * file is a second copy of it, not an import, because D-1 says this app does not
 * depend on `@praxis/shared` (the eslint rule in `public-web/eslint.config.js`
 * states it and names this remedy: re-declare the value here, and put the
 * cross-package assertion in `tests/unit/` at the repo root).
 *
 * That assertion is `tests/unit/verify-code-parity.test.js`. It reads both
 * files and fails when the alphabet, the length or the substitutions stop
 * matching, so the copy cannot drift silently. Change one, run it, change both.
 *
 * ── WHY DRIFT WOULD BE INVISIBLE WITHOUT IT ────────────────────────────────
 *
 * The SERVER normalises a typed code before it looks it up. A browser that
 * folded a spelling differently would send a code that cannot match, and the
 * visitor would read "no verification matches that code" about a document they
 * are holding in their hand. Nothing throws, nothing logs, and both halves pass
 * their own tests.
 *
 * ── WHY THE PAGE VALIDATES AT ALL ──────────────────────────────────────────
 *
 * The portal's rate limiter is 60 lookups per IP per 15 minutes, and
 * `document_verification.routes.js` is explicit that it is "the SOLE defence"
 * against enumerating a plaintext code: load-bearing, not decoration. Every
 * mistyped code that reaches the server spends one of those 60 on nothing, and
 * an office behind one NAT address shares that ceiling. Checking the shape here
 * is not an optimisation; it leaves the budget for lookups that could succeed.
 */

/**
 * Crockford base32: no I, L, O or U.
 *
 * The first three because they are indistinguishable from 1/1/0 in the 5pt type
 * this prints at; U because excluding it makes accidental profanity in a random
 * code far less likely, on a document that goes to a customer.
 */
export const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 32^12 = 2^60. The length is fixed; a code is never partially matched. */
export const CODE_LENGTH = 12;

/**
 * Crockford's canonical read-side substitutions.
 *
 * A person reading a code down a phone line says "oh" for 0 and "ell" for 1,
 * and the person typing it writes what they heard. Folding those spellings is
 * the difference between a code that works when dictated and one that only
 * works when copied.
 *
 * `Object.create(null)` for the same reason the server's copy uses it: the
 * input is filtered to [0-9A-Z] before it reaches here, so a prototype member
 * cannot be looked up today, but that safety lives in a regex one function away
 * and this costs nothing to make local.
 */
const NORMALISE: Record<string, string> = Object.assign(Object.create(null), {
  I: "1",
  L: "1",
  O: "0",
  U: "V",
});

/**
 * Accept what a human actually types: lower case, Crockford's confusables, and
 * any separator they felt like using.
 *
 * A code read down a phone line must not fail because somebody typed a space,
 * and a code copied out of a PDF must not fail because the copy brought the
 * printed hyphens with it.
 */
export function normaliseCode(input: string): string {
  const raw = String(input || "")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
  let out = "";
  for (const ch of raw) out += NORMALISE[ch] || ch;
  return out;
}

/**
 * Is this a code at all?
 *
 * Exactly twelve characters, every one of them in the alphabet. Nothing else is
 * a verification code, and in particular:
 *
 *   · NOT an invoice number, a shipment reference or a file reference. Those
 *     identify a DOCUMENT; this identifies a SIGNATURE on a document somebody is
 *     holding. The distinction is the whole security model.
 *   · NOT a `doc_id` or any other internal identifier. Internal ids appear in
 *     staff URLs and in logs, and accepting one here would turn every one of
 *     them into a key that opens a public record.
 *   · NOT a hash or a hash prefix. The module this replaced matched
 *     `stored.startsWith(hash)` against a four-character floor, which meant a
 *     caller supplied the identifier of the document they wanted checked and
 *     got a "verified" verdict that proved nothing about their paper. There is
 *     no prefix path any more and this function is where that stays true.
 */
export function isValidCode(input: string): boolean {
  const c = normaliseCode(input);
  if (c.length !== CODE_LENGTH) return false;
  for (const ch of c) if (!ALPHABET.includes(ch)) return false;
  return true;
}

/**
 * `A4B7K92MXQ1P` → `A4B7-K92M-XQ1P`.
 *
 * Grouping is display-only and never stored or sent: the server normalises the
 * separators straight back out. Four-character groups are what the document
 * prints beneath the QR, so the field and the paper look alike while somebody
 * copies between them, which is the only moment this formatting has to earn.
 */
export function formatCode(input: string): string {
  return normaliseCode(input).replace(/(.{4})(?=.)/g, "$1-");
}

/**
 * What the input should show while somebody is still typing.
 *
 * Capped at `CODE_LENGTH` BEFORE grouping, so pasting a whole URL or a
 * paragraph cannot produce a field full of hyphens: the excess is dropped, not
 * formatted. Returns "" for empty input rather than a stray separator.
 */
export function formatPartial(input: string): string {
  return formatCode(normaliseCode(input).slice(0, CODE_LENGTH));
}
