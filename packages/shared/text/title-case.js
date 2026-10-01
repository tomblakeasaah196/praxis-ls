"use strict";
/**
 * Title Case — ONE function for every label the product title-cases.
 *
 * Written for the financial dictionary (meeting 5, 01:44:14 — "Shipping Line
 * Charges", not "shipping line charges") and lifted here unchanged when the
 * owner made Title Case the standard for every LABEL on the public website and
 * the client portal, in English AND French (tenant review of 29 Sep 2026,
 * owner decision D5). Two callers today:
 *
 *   - src/modules/master/financial_dictionary — a catalogue label is stored
 *     title-cased (and seed 90995 applies the identical rule in SQL to the
 *     rows already stored; tests/integration/dictionary-standard-rate.test.js
 *     runs both on the same cases — change one and change the other);
 *   - public-web — an i18next post-processor applies it at RENDER to every key
 *     classified LABEL (scripts/gen/site-copy-case.js), so no string is retyped
 *     and a tenant's own override is cased the same way.
 *
 * public-web imports THIS FILE by deep path, never the package index: the
 * index pulls Zod and the ISO tables, and the site's first paint has no room
 * for them (see the note in packages/shared/index.js). So this module requires
 * nothing.
 *
 * WHAT IT DOES
 *   - Every word starts with a capital …
 *   - … except the language's SMALL WORDS (articles, conjunctions, short
 *     prepositions), which are written lower case: "Frais de Dossier",
 *     "Frais d'Agence et de Documentation", "Commission on Disbursements",
 *     "THC per Box", "Demander un Devis". A small word typed with a capital
 *     ("De") is lowered.
 *   - A small word that OPENS the label, or opens a phrase after "—", "(",
 *     "[", ":" or a quote, is capitalised like any other: "Transport — Pour
 *     Compte Client", "L'Entrepôt".
 *   - An elided article keeps its apostrophe and the word after it is the one
 *     capitalised: "d'agence" → "d'Agence" (and "D'Agence" at the start).
 *   - Only a word's FIRST letter is ever raised. The rest is left as typed, so
 *     "THC", "PDF", "(BL)" and "IT Equipment" survive; a naive capitalise-and-
 *     lowercase would print "Thc". A word written entirely in capitals is never
 *     lowered either, so an acronym that happens to spell a small word ("DE",
 *     "ET") or a lone letter ("Type A") is left alone.
 *
 * `lang` is the label's own language: "fr" or "en" (anything else reads as
 * English).
 */
const SMALL_WORDS = {
  fr: new Set([
    "à", "au", "aux", "avec", "chez", "d", "dans", "de", "des", "du", "en",
    "entre", "et", "l", "la", "le", "les", "ou", "par", "pour", "sans", "sous",
    "sur", "un", "une", "vers",
  ]),
  en: new Set([
    "a", "an", "and", "as", "at", "by", "for", "from", "in", "nor", "of", "on",
    "or", "per", "the", "to", "via", "vs", "with",
  ]),
};
// A separator run between words. Hyphen and slash separate words inside a
// phrase ("Last-Mile", "Import / Export"); the others below also START one.
const WORD_SEPARATORS = /([\s()[\]/"«»:—–-]+)/u;
const PHRASE_OPENERS = /[([:"«—–]/u;
const isAllCaps = (w) => w === w.toUpperCase() && w !== w.toLowerCase();
const raiseFirst = (w) => w.replace(/^(\P{L}*)(\p{Ll})/u, (_m, lead, ch) => lead + ch.toUpperCase());

function titleCase(label, lang = "en") {
  if (label === null || label === undefined) return label;
  const small = SMALL_WORDS[lang] || SMALL_WORDS.en;
  const parts = String(label).split(WORD_SEPARATORS);
  let phraseStart = true;
  return parts.map((part, i) => {
    if (i % 2 === 1) { // a separator run
      if (PHRASE_OPENERS.test(part)) phraseStart = true;
      return part;
    }
    if (!part) return part;
    const opening = phraseStart;
    phraseStart = false;
    // Elision: "d'agence", "l'entrepôt" — the article is a small word, the
    // word after the apostrophe is the one that takes the capital.
    const elided = /^(\p{L})(['’])(.+)$/u.exec(part);
    if (elided && small.has(elided[1].toLowerCase())) {
      const article = opening ? elided[1].toUpperCase() : elided[1].toLowerCase();
      return article + elided[2] + raiseFirst(elided[3]);
    }
    if (!opening && small.has(part.toLowerCase()) && !isAllCaps(part)) return part.toLowerCase();
    return raiseFirst(part);
  }).join("");
}

// Named `exports.x =` assignments so a bundler's CommonJS lexer sees them —
// the reason is in packages/shared/index.js.
exports.titleCase = titleCase;
exports.SMALL_WORDS = SMALL_WORDS;
