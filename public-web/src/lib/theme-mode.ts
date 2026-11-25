/**
 * Light/dark mode for the marketing site.
 *
 * ── LIGHT BY DEFAULT, AND WHO MAY CHANGE IT (website v2) ──────────────────
 *
 * The site was locked dark for a season (`FORCE_DARK`). The first tenant's
 * review (24 Nov 2026) asked for the opposite: light pages with dark
 * photographic bands, and a switch a visitor can press. So the order is:
 *
 *   1. The VISITOR'S choice, but only when the tenant has turned the visitor
 *      switch on (Settings › Website › Options, `visitor_theme_switch`). With
 *      the switch off there is no control, so a stored choice from another
 *      visit or another tenant must not decide anything either.
 *   2. The TENANT'S default (`site_theme.default_mode`, Settings › Website ›
 *      Theme), from the theme read and its cache.
 *   3. Light.
 *
 * The dark bands (hero, portal band, footer) are dark in BOTH modes; they are
 * the photographic plates the page is built around, not a theme. What the mode
 * changes is the ground between them.
 *
 * Two states, not three. The staff app offers light / dark / system because its
 * users live in it all day; a visitor here for two minutes does not want a
 * third thing to understand.
 *
 * Two writes, one read:
 *   · `.dark` on <html> drives this app's own token block (mirroring `client`).
 *   · `data-theme` drives `@praxis/brand/tokens.css`, whose `--brand-*` values
 *     otherwise follow the OS.
 *
 * The inline pre-paint script in `index.html` makes the same decision before
 * any module runs; `theme-mode.test.ts` pins the two together.
 */
import { THEME_CACHE_KEY, getSiteSwitches } from "./site-switches";

export type ThemeMode = "light" | "dark";

/** The visitor's own choice, honoured only while the tenant offers the switch. */
export const THEME_KEY = "praxis.public.theme";

const root = () => document.documentElement;

const asMode = (v: unknown): ThemeMode | null => (v === "light" || v === "dark" ? v : null);

/** The tenant's default, once the theme read has answered this visit. */
let tenantDefault: ThemeMode | null = null;

function cachedTenantDefault(): ThemeMode | null {
  try {
    const raw = localStorage.getItem(THEME_CACHE_KEY);
    if (!raw) return null;
    return asMode((JSON.parse(raw) as { defaultMode?: unknown }).defaultMode);
  } catch {
    /* storage unavailable or a corrupt cache: light stands */
    return null;
  }
}

/** Called by the branding provider when the theme read lands. */
export function setTenantDefaultMode(mode: unknown): void {
  tenantDefault = asMode(mode);
}

export function visitorChoice(): ThemeMode | null {
  if (!getSiteSwitches().visitor_theme_switch) return null;
  try {
    return asMode(localStorage.getItem(THEME_KEY));
  } catch {
    /* storage unavailable (private mode, embedded webview) */
    return null;
  }
}

export function getMode(): ThemeMode {
  return visitorChoice() || tenantDefault || cachedTenantDefault() || "light";
}

/** Paint a mode. Idempotent with the inline script in `index.html`. */
export function applyMode(mode: ThemeMode): void {
  const el = root();
  el.classList.toggle("dark", mode === "dark");
  el.dataset.theme = mode;
  // `color-scheme` is what native UI reads (scrollbars, `<select>` popups, the
  // canvas before the stylesheet lands). The pre-paint script writes it inline,
  // so it is rewritten here rather than declared in `index.css`.
  el.style.colorScheme = mode;
  // The phone's browser chrome takes the page's ground in either mode, read
  // from the tokens rather than typed here so a tenant palette carries into it.
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta && typeof getComputedStyle === "function") {
    const ground = getComputedStyle(el).getPropertyValue("--background").trim();
    if (ground) meta.content = ground;
  }
}

/** The visitor pressed the switch. A no-op while the tenant has not offered
 *  one: there is no control, and nothing may write a choice nobody made. */
export function setMode(mode: ThemeMode): void {
  if (!getSiteSwitches().visitor_theme_switch) return;
  applyMode(mode);
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* the choice lives for this page view only */
  }
}

/** Apply the resolved mode. Called at boot and again when the theme read
 *  lands, so a tenant default or a switch that changed since the last visit
 *  takes effect without a reload. */
export function initThemeMode(): ThemeMode {
  const mode = getMode();
  applyMode(mode);
  return mode;
}

export function toggleMode(): ThemeMode {
  if (!getSiteSwitches().visitor_theme_switch) return getMode();
  const next: ThemeMode = getMode() === "dark" ? "light" : "dark";
  setMode(next);
  return next;
}
