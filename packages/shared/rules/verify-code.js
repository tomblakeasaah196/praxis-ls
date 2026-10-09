"use strict";
/**
 * The printed verification code — ONE definition of what a human may type.
 *
 * `document_signature.verify_code` is twelve Crockford base32 characters. It is
 * printed inside the QR on every signed document and again as text beneath it,
 * and it is the only thing the public verification portal accepts.
 *
 * ── WHY THIS IS SHARED AND NOT THREE COPIES ────────────────────────────────
 *
 * Three surfaces have to agree on the alphabet, the length and the read-side
 * substitutions, because the server normalises before it looks the code up:
 *
 *   · `src/services/signatures/tokens.js` — mints and resolves it;
 *   · `public-web` — the portal a stranger types it into;
 *   · `client` — the ERP's copy of that portal, for tenants with no public
 *     website on file.
 *
 * A surface that folded a spelling differently from the server would send a
 * code that cannot match, and the visitor would read "no verification matches
 * that code" about a document they are holding in their hand. That failure is
 * invisible to every test that does not run both halves, which is exactly the
 * shape CLAUDE.md's rule about re-declaring a validator on one side exists to
 * stop.
 *
 * ── IT REQUIRES NOTHING, AND MUST NOT ──────────────────────────────────────
 *
 * public-web reaches this by deep path (`config/shared-deep.ts`), never through
 * the package index, because the index pulls Zod and the ISO tables and that
 * app's first paint has about 11 kB of gzipped headroom. Adding a `require` to
 * this file spends that headroom on every visitor to the marketing site.
 *
 * Named `exports.x =` assignments so a bundler's CommonJS lexer sees them —
 * the reason is in packages/shared/index.js.
 */

/**
 * Crockford base32: no I, L, O or U.
 *
 * The first three because they are indistinguishable from 1/1/0 in the 5pt type
 * this prints at; U because excluding it makes accidental profanity in a random
 * code far less likely, on a document that goes to a customer.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * 32^12 = 2^60.
 *
 * Safe ONLY with the portal's rate limiter, which is why the length is fixed
 * and a code is never partially matched: `document_verification.routes.js` is
 * explicit that the limiter is the sole defence against enumerating a code
 * stored in plaintext.
 */
const CODE_LENGTH = 12;

/**
 * Crockford's canonical read-side substitutions.
 *
 * A person reading a code down a phone line says "oh" for 0 and "ell" for 1,
 * and the person typing it writes what they heard. Folding those spellings is
 * the difference between a code that works when dictated and one that only
 * works when copied.
 *
 * Null-prototype: the input is already filtered to [0-9A-Z] before it reaches
 * here, so a prototype member cannot be looked up today, but that safety lives
 * in a regex one function away and this costs nothing to make local.
 */
const NORMALISE = Object.assign(Object.create(null), { I: "1", L: "1", O: "0", U: "V" });

/**
 * Accept what a human actually types: lower case, Crockford's confusables, and
 * any separator they felt like using.
 *
 * A code read down a phone line must not fail because somebody typed a space,
 * and a code copied out of a PDF must not fail because the copy brought the
 * printed hyphens with it.
 */
function normaliseCode(input) {
  const raw = String(input || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  let out = "";
  for (const ch of raw) out += NORMALISE[ch] || ch;
  return out;
}

/**
 * Is this a code at all? Checked before a database round-trip, so junk costs
 * nothing, and checked in the browser too, so junk never spends a lookup out of
 * the limiter's budget.
 *
 * Exactly twelve characters, every one in the alphabet. Nothing else is a
 * verification code, and in particular:
 *
 *   · NOT an invoice number, a shipment reference or a file reference. Those
 *     identify a DOCUMENT; this identifies a SIGNATURE on a document somebody
 *     is holding. The distinction is the whole security model.
 *   · NOT a `doc_id` or any other internal identifier. Internal ids appear in
 *     staff URLs and in logs, and accepting one here would turn every one of
 *     them into a key that opens a public record.
 *   · NOT a hash or a hash prefix. The module this replaced matched
 *     `stored.startsWith(hash)` against a four-character floor, which meant a
 *     caller supplied the identifier of the document they wanted checked and
 *     got a "verified" verdict that proved nothing about their paper. There is
 *     no prefix path any more, and this function is where that stays true.
 */
function isValidCode(input) {
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
function formatCode(input) {
  return normaliseCode(input).replace(/(.{4})(?=.)/g, "$1-");
}

/**
 * What an input should show while somebody is still typing.
 *
 * Capped at `CODE_LENGTH` BEFORE grouping, so pasting a whole URL or a
 * paragraph cannot produce a field full of hyphens: the excess is dropped, not
 * formatted.
 */
function formatPartial(input) {
  return formatCode(normaliseCode(input).slice(0, CODE_LENGTH));
}

exports.ALPHABET = ALPHABET;
exports.CODE_LENGTH = CODE_LENGTH;
exports.normaliseCode = normaliseCode;
exports.isValidCode = isValidCode;
exports.formatCode = formatCode;
exports.formatPartial = formatPartial;
