/**
 * How ⌘K decides that what was typed names a page (tenant review, meeting 6,
 * PR 4 — G5).
 *
 *   · FOLDED — case and accents ignored, with the same table as the API and
 *     Postgres (`search.fold` in @praxis/shared, migration 14382), so
 *     "societe" finds "Société" here exactly as it does in a record.
 *   · EVERY WORD COUNTS — "supplier inv" finds Supplier invoices; each typed
 *     word must match some word of the candidate, as a prefix, as a substring
 *     (three letters or more), or with ONE letter wrong (four letters or more:
 *     "quotaion", "facutre"). Shorter words must be exact prefixes — a
 *     one-letter typo in a two-letter word is a different word.
 *   · REAL WORDS — the shared synonym list (`search.SYNONYMS`): a candidate
 *     whose title is in a group is found by ANY word of that group, so
 *     "devis" and "cotation" find Quotations without each page listing them.
 */
import { search } from "@praxis/shared";

export const fold = (s: string | null | undefined): string => search.fold(s);

const words = (s: string): string[] =>
  fold(s)
    .split(/[^a-z0-9']+/)
    .filter(Boolean);

/** One edit — an insertion, a deletion, a substitution or a swap — or none. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i += 1;
  if (la === lb) {
    // substitution, or two neighbours swapped
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/** How well one typed word matches one candidate word: 0 = not at all. */
function wordScore(typed: string, word: string): number {
  if (word === typed) return 4;
  if (word.startsWith(typed)) return 3;
  if (typed.length >= 3 && word.includes(typed)) return 2;
  if (typed.length >= 4) {
    // A typo in the whole word, or in the part typed so far.
    if (withinOneEdit(typed, word)) return 1.5;
    if (word.length > typed.length && withinOneEdit(typed, word.slice(0, typed.length))) return 1;
  }
  return 0;
}

/** The synonym groups a text belongs to — by any phrase of a group it contains. */
export function conceptsIn(text: string): Set<string> {
  const out = new Set<string>();
  const f = ` ${words(text).join(" ")} `;
  for (const g of search.SYNONYMS) {
    for (const w of g.words) {
      if (f.includes(` ${fold(w)} `)) {
        out.add(g.key);
        break;
      }
    }
  }
  return out;
}

/** The synonym groups the typed text points at — whole words, or one typo off. */
export function conceptsTyped(query: string): Set<string> {
  const q = words(query);
  const out = new Set<string>();
  if (!q.length) return out;
  const phrase = q.join(" ");
  for (const g of search.SYNONYMS) {
    for (const w of g.words) {
      const fw = fold(w);
      const multi = fw.includes(" ");
      const hit = multi
        ? phrase.includes(fw) || (fw.startsWith(phrase) && phrase.length >= 4)
        : q.some((t) => t === fw || (t.length >= 4 && (withinOneEdit(t, fw) || (fw.startsWith(t) && fw.length - t.length <= 3))));
      if (hit) {
        out.add(g.key);
        break;
      }
    }
  }
  return out;
}

export type Searchable = {
  /** Every text the candidate answers to: EN and FR titles, synonyms, area. */
  texts: string[];
  /** Its synonym groups, computed once (conceptsIn over its titles). */
  concepts: Set<string>;
};

/**
 * A score for a candidate, or 0. Titles weigh more than the area they sit in;
 * a synonym-group hit counts as a strong match on its own.
 */
export function score(query: string, c: Searchable, typedConcepts?: Set<string>): number {
  const q = words(query);
  if (!q.length) return 0;
  const conceptHit = [...(typedConcepts ?? conceptsTyped(query))].some((k) => c.concepts.has(k));
  let best = 0;
  for (const [i, text] of c.texts.entries()) {
    const ws = words(text);
    if (!ws.length) continue;
    let total = 0;
    let all = true;
    for (const t of q) {
      let w = 0;
      for (const cw of ws) w = Math.max(w, wordScore(t, cw));
      if (!w) {
        all = false;
        break;
      }
      total += w;
    }
    if (all) {
      // The first texts are the titles; later ones (synonyms, area) weigh less.
      const weight = i < 2 ? 1 : 0.7;
      best = Math.max(best, (total / q.length) * weight + (fold(text) === q.join(" ") ? 2 : 0));
    }
  }
  if (conceptHit) best = Math.max(best, 3.2);
  return best;
}
