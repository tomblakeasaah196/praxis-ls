import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  applySiteTheme,
  resetSiteTheme,
  readCachedSiteTheme,
  writeCachedSiteTheme,
  type SiteThemePayload,
} from "@/lib/site-theme";

/**
 * The website theme, and the failure that would white-screen a marketing page.
 *
 * ── THE DEFECT THIS PINS ───────────────────────────────────────────────────
 *
 * `getSiteTheme()` catches a REJECTED fetch, and the module's header said
 * "failure is silent". That covered the wrong half. A fetch that SUCCEEDS and
 * returns something else — an older server, a proxy's error page serialised as
 * JSON, a cache entry written by a previous version of this app — sailed
 * straight through the catch into `Object.entries(payload.light)`.
 *
 * It surfaced as eleven unhandled rejections across the suite:
 * "Cannot convert undefined or null to object". On a real visitor's page that
 * is a thrown error during boot, which for a client-rendered app is a blank
 * screen — the single worst outcome for the surface a tenant is judged by, and
 * caused by the theme being *cosmetic*.
 *
 * So the shape is checked at every entry point, and anything unrecognisable is
 * treated exactly like a failed fetch: the tenant's branding stands.
 */

const full = (): SiteThemePayload => ({
  input: { primary: "#ff5a00", secondary: null, tertiary: null },
  fonts: { display: "archivo", body: "inter", mono: "jetbrains-mono" },
  radius: "10px",
  defaultMode: "light",
  light: { "--background": "#ffffff", "--foreground": "#191a1b" },
  dark: { "--background": "#0b0d11", "--foreground": "#edeeee" },
});

beforeEach(() => {
  localStorage.clear();
  resetSiteTheme();
  document.documentElement.removeAttribute("style");
});
afterEach(() => vi.unstubAllGlobals());

describe("applySiteTheme", () => {
  it("paints the tokens for the visitor's current mode", () => {
    applySiteTheme(full());
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--background")).toBe("#ffffff");
    expect(root.style.getPropertyValue("--radius")).toBe("10px");
  });

  it("clears the previous set, so no stale token survives a swap", () => {
    // A light --card left under a dark --background is the visual bug this
    // bookkeeping exists to prevent.
    applySiteTheme({ ...full(), light: { "--only-in-first": "#111" } });
    expect(document.documentElement.style.getPropertyValue("--only-in-first")).toBe("#111");
    applySiteTheme(full());
    expect(document.documentElement.style.getPropertyValue("--only-in-first")).toBe("");
  });

  it("does nothing at all when handed a malformed payload", () => {
    // Each of these reached applySiteTheme in the failing version and threw.
    const bad = [
      null,
      undefined,
      {},
      { light: null, dark: null },
      { light: "not-an-object", dark: {} },
      { input: { primary: "#fff" } },
    ];
    for (const payload of bad) {
      expect(() =>
        applySiteTheme(payload as unknown as SiteThemePayload),
      ).not.toThrow();
    }
    expect(document.documentElement.getAttribute("style")).toBeFalsy();
  });
});

describe("the cache", () => {
  it("round-trips a payload", () => {
    writeCachedSiteTheme(full());
    expect(readCachedSiteTheme()?.light["--background"]).toBe("#ffffff");
  });

  it("rejects a cache entry written by an older version", () => {
    // Same class of bug as above, arriving from localStorage instead of the
    // network — and the one a returning visitor would hit first, because the
    // cache is painted before the fetch resolves.
    localStorage.setItem("praxis.site-theme.v1", JSON.stringify({ primary: "#ff5a00" }));
    expect(readCachedSiteTheme()).toBeNull();
  });

  it("survives storage being unavailable", () => {
    // A private window, cleared site data, or a browser refusing storage.
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    });
    expect(readCachedSiteTheme()).toBeNull();
    expect(() => writeCachedSiteTheme(full())).not.toThrow();
  });
});
