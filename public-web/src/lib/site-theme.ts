/**
 * The website's own theme — `GET /public/site/theme`.
 *
 * ── WHY THE PALETTE ARRIVES READY-MADE ─────────────────────────────────────
 *
 * The server derives it. This app receives roughly seventy CSS custom
 * properties per theme and sets them; it does no colour maths at all, and that
 * is the point:
 *
 *   · The derivation is real work — OKLCH conversion, a contrast walk per
 *     token, gamut mapping. Doing it here means doing it on a mid-range Android
 *     on a metered connection, on the critical path to first paint, for a
 *     result that is identical for every visitor of a given tenant.
 *   · This app has ~11 kB of gzipped first-paint headroom. Importing
 *     `@praxis/shared` to get the engine pulls Zod and the ISO country tables
 *     through a CommonJS interop boundary to compute something a server can
 *     compute once and cache.
 *   · The settings preview reads THIS endpoint too, so what a tenant is shown
 *     before they save and what a visitor sees afterwards cannot drift.
 *
 * ── WHY THIS IS SEPARATE FROM `applyBrand` ─────────────────────────────────
 *
 * `GET /branding` is the ERP's appearance row: the logo, the name, and the
 * colours the tenant's own staff see all day. This is the WEBSITE's row, and
 * they are deliberately not the same record — a tenant may want a restrained
 * workspace and a confident front door.
 *
 * So both run, in order: `applyBrand` first (logo, name, and its colours as a
 * floor), then this, which wins on colour for the surface it owns. A tenant who
 * has never opened Settings › Website gets the seeded default, which is the
 * brand orange — the same thing they had before this existed.
 *
 * ── FAILURE IS SILENT, AS IT IS FOR BRANDING ───────────────────────────────
 *
 * A marketing page that shows an error because a theme call timed out is worse
 * than the same page in default dress. The catch is deliberate.
 */
import { publicGet } from "./api";
import { getMode } from "./theme-mode";

export type SiteThemePayload = {
  input: { primary: string; secondary: string | null; tertiary: string | null };
  fonts: { display: string; body: string; mono: string };
  radius: string;
  defaultMode: "light" | "dark";
  light: Record<string, string>;
  dark: Record<string, string>;
};

const CACHE_KEY = "praxis.site-theme.v1";

/** The tokens this module owns, so a theme switch can clear the previous set
 *  rather than leaving a light `--card` behind under a dark `--background`. */
let applied: string[] = [];

/**
 * Is this actually a theme?
 *
 * The `.catch()` below covers a fetch that REJECTS. It does not cover a fetch
 * that succeeds and returns something else — an old server, a proxy's error
 * page rendered as JSON, a half-written cache entry. That gap was not
 * hypothetical: `applySiteTheme` did `Object.entries(payload.light)` on the
 * first thing it was handed, and eleven tests surfaced
 * "Cannot convert undefined or null to object" as an unhandled rejection.
 *
 * On a marketing page that is a white screen. So the shape is checked before
 * anything is painted, and anything unrecognisable is treated exactly like a
 * failed fetch: the tenant's branding stands and nobody sees an error.
 */
function isThemePayload(v: unknown): v is SiteThemePayload {
  if (!v || typeof v !== "object") return false;
  const t = v as Partial<SiteThemePayload>;
  return (
    Boolean(t.light) &&
    typeof t.light === "object" &&
    Boolean(t.dark) &&
    typeof t.dark === "object"
  );
}

export const getSiteTheme = (): Promise<SiteThemePayload | null> =>
  publicGet<SiteThemePayload>("/public/site/theme")
    .then((v) => (isThemePayload(v) ? v : null))
    .catch(() => null);

/** The last payload, so a returning visitor is themed before they are online.
 *  Same mechanism `readCachedBranding` uses, and for the same reason. */
export function readCachedSiteTheme(): SiteThemePayload | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    // A cache written by an older version of this app is exactly the malformed
    // payload isThemePayload exists for.
    return isThemePayload(parsed) ? parsed : null;
  } catch {
    // A private window, cleared site data, or a browser refusing storage. The
    // network fetch still runs; there is simply nothing to paint from first.
    return null;
  }
}

export function writeCachedSiteTheme(payload: SiteThemePayload): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Storage quota or a blocked API. Caching is an optimisation, never a
    // requirement — swallowing this is correct.
  }
}

/**
 * Paint one theme's tokens onto `:root`.
 *
 * Which half is chosen follows the visitor's own light/dark preference, not the
 * tenant's: `defaultMode` decides what an unresolved FIRST visit looks like and
 * `theme-mode.ts` owns every visit after that. A tenant setting "dark" must not
 * override somebody who has explicitly asked for light.
 */
export function applySiteTheme(payload: SiteThemePayload): void {
  // Belt and braces: every caller already screens through isThemePayload, and
  // this is the function that white-screens the page if one ever stops.
  if (!isThemePayload(payload)) return;
  const root = document.documentElement;
  for (const name of applied) root.style.removeProperty(name);

  const tokens = getMode() === "dark" ? payload.dark : payload.light;
  const next: string[] = [];
  for (const [name, value] of Object.entries(tokens)) {
    root.style.setProperty(name, value);
    next.push(name);
  }
  if (payload.radius) {
    root.style.setProperty("--radius", payload.radius);
    next.push("--radius");
  }
  applied = next;
}

/** Undo everything this module set — used when a theme payload is replaced by
 *  one that has fewer tokens, so no stale value survives underneath. */
export function resetSiteTheme(): void {
  const root = document.documentElement;
  for (const name of applied) root.style.removeProperty(name);
  applied = [];
}
