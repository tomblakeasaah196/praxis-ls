/**
 * The tenant's website switches (14600, website v2): the languages the site
 * offers and the optional sections it shows.
 *
 * ── WHY THEY RIDE THE THEME ───────────────────────────────────────────────
 *
 * Everything here is needed before the first paint: the header cannot draw its
 * top rail, its language control or its nav, and the page cannot choose light
 * or dark, until it knows them. `GET /public/site/theme` is already the one
 * read on that path, already cached for five minutes at the edge and in
 * `localStorage` for the next visit, so the switches travel inside it rather
 * than costing every visitor a second round trip.
 *
 * ── THE DEFAULT IS THE PRODUCT'S DEFAULT ──────────────────────────────────
 *
 * Before the first answer (a first visit, a private window) the switches read
 * as every tenant ships: English only, every optional section off. A tenant who
 * turned a section on sees it a beat later on a first visit and immediately on
 * every visit after; the reverse (a section drawn and then removed under the
 * reader) is the worse of the two flickers.
 *
 * No app imports, on purpose (React only): `lib/i18n.ts` reads this at module
 * load, before anything else in the app has run, and a dependency on the fetch
 * layer here would be a cycle through it.
 */
import * as React from "react";

export type SiteLanguage = "en" | "fr";

export type SiteSwitches = {
  languages: SiteLanguage[];
  top_rail: boolean;
  portfolio: boolean;
  corridors: boolean;
  case_notes: boolean;
  careers_in_header: boolean;
  visitor_theme_switch: boolean;
};

export const DEFAULT_SWITCHES: SiteSwitches = Object.freeze({
  languages: ["en"],
  top_rail: false,
  portfolio: false,
  corridors: false,
  case_notes: false,
  careers_in_header: false,
  visitor_theme_switch: false,
}) as SiteSwitches;

/** The theme cache `lib/site-theme.ts` writes. Read directly rather than
 *  imported, for the reason in the header. `site-switches.test.ts` pins the two
 *  spellings together. */
export const THEME_CACHE_KEY = "praxis.site-theme.v1";

const KEYS = [
  "top_rail",
  "portfolio",
  "corridors",
  "case_notes",
  "careers_in_header",
  "visitor_theme_switch",
] as const;

/** Whatever arrived, as a complete and safe set. Unknown is OFF. */
export function normaliseSwitches(v: unknown): SiteSwitches {
  const src = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const langs = Array.isArray(src.languages) ? src.languages : [];
  const out: SiteSwitches = {
    languages: langs.includes("fr") ? ["en", "fr"] : ["en"],
  } as SiteSwitches;
  for (const k of KEYS) out[k] = src[k] === true;
  return out;
}

function fromCache(): SiteSwitches {
  try {
    const raw = localStorage.getItem(THEME_CACHE_KEY);
    if (!raw) return DEFAULT_SWITCHES;
    const parsed = JSON.parse(raw) as { switches?: unknown };
    return parsed && parsed.switches ? normaliseSwitches(parsed.switches) : DEFAULT_SWITCHES;
  } catch {
    /* storage unavailable or a corrupt cache: the product's defaults stand */
    return DEFAULT_SWITCHES;
  }
}

let current: SiteSwitches = typeof window === "undefined" ? DEFAULT_SWITCHES : fromCache();
const listeners = new Set<() => void>();

export const getSiteSwitches = (): SiteSwitches => current;

/** Replace the switches (the theme read landed). Listeners run only when
 *  something actually changed, so a repeat visit with the same answer costs
 *  no re-render. */
export function setSiteSwitches(next: unknown): void {
  const value = normaliseSwitches(next);
  if (JSON.stringify(value) === JSON.stringify(current)) return;
  current = value;
  for (const fn of listeners) fn();
}

export function subscribeSiteSwitches(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useSiteSwitches(): SiteSwitches {
  return React.useSyncExternalStore(subscribeSiteSwitches, getSiteSwitches, getSiteSwitches);
}

/** More than one language offered: the only case a language control exists. */
export const isMultilingual = (s: SiteSwitches = current): boolean =>
  s.languages.length > 1;

export const offersLanguage = (lang: string, s: SiteSwitches = current): boolean =>
  (s.languages as string[]).includes(lang);

/** Test hook: back to the product's defaults. */
export function __resetSiteSwitches(): void {
  current = DEFAULT_SWITCHES;
  for (const fn of listeners) fn();
}
