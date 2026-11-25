import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  THEME_KEY,
  applyMode,
  getMode,
  initThemeMode,
  setMode,
  setTenantDefaultMode,
  toggleMode,
} from "./theme-mode";
import { THEME_CACHE_KEY, __resetSiteSwitches, setSiteSwitches } from "./site-switches";
import {
  getPortalTheme,
  resolvePortalTheme,
} from "@/features/portal/lib/theme";

const html = () =>
  readFileSync(join(process.cwd(), "index.html"), "utf8");

const script = () => {
  const source = html();
  const open = source.indexOf("<script>", source.indexOf("PRE-PAINT THEME"));
  return source.slice(open, source.indexOf("</script>", open));
};

/**
 * Light by default (website v2). The decision has TWO implementations: this
 * module and the inline pre-paint script in `index.html`, which cannot import
 * it because it runs before any module does. The script is what every
 * visitor's first frame gets, so it is asserted here as text.
 */
describe("the marketing site's mode", () => {
  beforeEach(() => {
    localStorage.clear();
    setTenantDefaultMode(null);
    __resetSiteSwitches();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("style");
  });

  afterEach(() => {
    localStorage.clear();
    __resetSiteSwitches();
  });

  it("is light for a tenant that has chosen nothing", () => {
    expect(getMode()).toBe("light");
    expect(initThemeMode()).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("follows the tenant's default, from the read or its cache", () => {
    localStorage.setItem(THEME_CACHE_KEY, JSON.stringify({ defaultMode: "dark" }));
    expect(getMode()).toBe("dark");
    setTenantDefaultMode("light");
    expect(getMode()).toBe("light");
  });

  it("ignores a stored visitor choice while the tenant offers no switch", () => {
    // A choice made on another visit, or on another tenant's site (the key is
    // shared), must not decide anything on a site with no control.
    localStorage.setItem(THEME_KEY, "dark");
    expect(getMode()).toBe("light");
    setMode("dark");
    expect(getMode()).toBe("light");
    expect(toggleMode()).toBe("light");
  });

  it("honours and stores the visitor's choice once the switch is on", () => {
    setSiteSwitches({ languages: ["en"], visitor_theme_switch: true });
    expect(toggleMode()).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(getMode()).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("writes colour-scheme alongside the class and the attribute", () => {
    applyMode("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("has a pre-paint script in index.html that agrees with this module", () => {
    const live = script().replace(/^\s*\/\/.*$/gm, "");
    expect(live).toContain('var mode = "light"');
    expect(live).toContain(`localStorage.getItem("${THEME_CACHE_KEY}")`);
    expect(live).toContain("cached.defaultMode");
    // The visitor's choice is read only behind the tenant's switch.
    const sw = live.indexOf("visitor_theme_switch === true");
    expect(sw).toBeGreaterThan(-1);
    expect(live.indexOf(`localStorage.getItem("${THEME_KEY}")`)).toBeGreaterThan(sw);
    expect(live).toContain('setAttribute("data-theme", mode)');
    expect(live).toContain("colorScheme");
  });

  it("paints a /portal URL in the portal's own mode, light unless chosen", () => {
    // The pre-paint branch and `features/portal/lib/theme.ts` make the same
    // decision; this pins the script's half of it.
    const source = html();
    const open = source.indexOf("<script>", source.indexOf("PRE-PAINT THEME"));
    const script = source.slice(open, source.indexOf("</script>", open));
    expect(script).toContain('mode = t === "dark" || (t === "system" && sys) ? "dark" : "light"');
    expect(getPortalTheme()).toBe("light");
    expect(resolvePortalTheme("light")).toBe("light");
    expect(resolvePortalTheme("dark")).toBe("dark");
  });

  it("carries one theme-color, which the module rewrites from the tokens", () => {
    const tags = html().match(/<meta name="theme-color"[^>]*>/g) ?? [];
    expect(tags).toHaveLength(1);
    expect(tags[0]).not.toContain("prefers-color-scheme");
  });
});
