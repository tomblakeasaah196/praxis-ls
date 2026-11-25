"use strict";
/**
 * Which language a tenant's public website REQUIRES, and what a public read may
 * fall back to. One rule, used by every module that stores bilingual website
 * copy: site content, copy overrides, service web profiles, entity stories,
 * and (from the website v2 PRs onward) articles and trust documents.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * The product was built French-first: every bilingual field required French
 * and English fell back to it. A tenant whose site is English only (the first
 * tenant's decision, 24 Nov 2026) could not write an English line without also
 * writing a French one nobody would read, and a public read with no English
 * printed the French. Both are wrong for that tenant, and each module had its
 * own copy of "French is required", so fixing it once meant fixing it five
 * times. Now there is one answer.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 *
 *   · `languages` is what the tenant OFFERS. English is always offered;
 *     French is opt-in (Settings › Website › Options). Default: English only.
 *   · English only → English is required and French is optional. Public reads
 *     never fall back to French, because a visitor to an English-only site
 *     must never be shown a French sentence.
 *   · English and French → French is required, exactly as before, so a
 *     bilingual tenant's existing content stays valid with no edit.
 *
 * Pure functions, no requires: the API, the settings screens and tests all load
 * this file, and the public website reads the same answer from the switches
 * payload rather than bundling it.
 */

const SITE_LANGUAGES = Object.freeze(["en", "fr"]);
const DEFAULT_LANGUAGES = Object.freeze(["en"]);

/** A clean, ordered list from whatever was stored or posted. English is always
 *  in it: a site with no language is not a configuration anyone can mean. */
function normaliseLanguages(value) {
  const list = Array.isArray(value) ? value.map((v) => String(v || "").trim().toLowerCase()) : [];
  return SITE_LANGUAGES.filter((l) => l === "en" || list.includes(l));
}

/** Accepts a languages array or a switches object carrying one. */
const languagesOf = (input) =>
  normaliseLanguages(Array.isArray(input) ? input : input && input.languages);

const offersFrench = (input) => languagesOf(input).includes("fr");

/** The language every required bilingual field must carry. */
const requiredLanguage = (input) => (offersFrench(input) ? "fr" : "en");

/** The other one. */
const optionalLanguage = (input) => (requiredLanguage(input) === "fr" ? "en" : "fr");

const filled = (v) =>
  Array.isArray(v) ? v.some((x) => String(x || "").trim() !== "") : String(v ?? "").trim() !== "";

/**
 * Is this object a bilingual value: `{ fr, en }` and nothing else?
 * Used by the walker below, so a block's `{ label: { fr, en } }` is checked
 * wherever it sits without each block schema naming its fields.
 */
function isBilingual(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  const keys = Object.keys(node);
  return keys.length > 0 && keys.every((k) => k === "fr" || k === "en");
}

/**
 * Every place in a nested value where a bilingual object lacks the required
 * language. Returns paths like `items.2.title`, which is what a 422's field
 * errors carry. An absent or null bilingual (an optional subtitle left out) is
 * fine; a present one must carry the required language.
 */
function bilingualGaps(tree, input, path = []) {
  const lang = requiredLanguage(input);
  const out = [];
  const walk = (node, at) => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, at.concat(String(i))));
      return;
    }
    if (!node || typeof node !== "object") return;
    if (isBilingual(node)) {
      if (!filled(node[lang])) out.push(at.join("."));
      return;
    }
    for (const [k, child] of Object.entries(node)) walk(child, at.concat(k));
  };
  walk(tree, path);
  return out;
}

/**
 * Flat column pairs (`summary_fr` / `summary_en`): every base name where the
 * row says something in either language but not in the required one. A pair
 * that is empty in both is fine unless it is listed in `mustHave`.
 */
function pairGaps(row, bases, input, { mustHave = [] } = {}) {
  const lang = requiredLanguage(input);
  const other = lang === "fr" ? "en" : "fr";
  const out = [];
  for (const base of bases) {
    const req = row ? row[`${base}_${lang}`] : undefined;
    const opt = row ? row[`${base}_${other}`] : undefined;
    if (filled(req)) continue;
    if (filled(opt) || mustHave.includes(base)) out.push(`${base}_${lang}`);
  }
  return out;
}

/** The sentence a 422 carries for a missing required language. */
function gapMessage(input) {
  return requiredLanguage(input) === "en"
    ? "Write this in English. Your website is English only, so English is the version visitors read."
    : "Write this in French. It is the version your website falls back to.";
}

/**
 * Remove French from a public payload when the tenant does not offer it.
 *
 * A deep copy is returned; the input is untouched. Two shapes are handled,
 * because the public reads use both:
 *
 *   · `{ fr, en }` objects: `fr` becomes null.
 *   · `<field>_fr` keys with a sibling `<field>_en`: the French value becomes
 *     null (an empty array for a list).
 *
 * Slugs are left alone. They are addresses, not copy, and a service whose only
 * slug is French must still have a working link.
 */
function withoutUnofferedLanguage(payload, input) {
  if (offersFrench(input)) return payload;
  const strip = (node) => {
    if (Array.isArray(node)) return node.map(strip);
    if (!node || typeof node !== "object" || node instanceof Date) return node;
    const out = {};
    const bilingual = isBilingual(node);
    for (const [k, v] of Object.entries(node)) {
      if (bilingual && k === "fr") {
        out[k] = null;
      } else if (
        k.endsWith("_fr") &&
        !k.startsWith("slug") &&
        Object.prototype.hasOwnProperty.call(node, `${k.slice(0, -3)}_en`)
      ) {
        out[k] = Array.isArray(v) ? [] : null;
      } else {
        out[k] = strip(v);
      }
    }
    return out;
  };
  return strip(payload);
}

module.exports = {
  SITE_LANGUAGES,
  DEFAULT_LANGUAGES,
  normaliseLanguages,
  offersFrench,
  requiredLanguage,
  optionalLanguage,
  isBilingual,
  bilingualGaps,
  pairGaps,
  gapMessage,
  withoutUnofferedLanguage,
};
