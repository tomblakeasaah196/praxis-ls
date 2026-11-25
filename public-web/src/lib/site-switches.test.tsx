import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  DEFAULT_SWITCHES,
  THEME_CACHE_KEY,
  __resetSiteSwitches,
  getSiteSwitches,
  isMultilingual,
  normaliseSwitches,
  setSiteSwitches,
} from "./site-switches";
import { detectLang, getLang, setLang } from "./i18n";
import i18n from "./i18n";
import { heroHeadline } from "@/components/site/hero";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { BrandingProvider } from "@/app/branding";

/**
 * The website's switches (14600, website v2) as the PRODUCT ships them:
 * English only, every optional section off. The rest of the suite runs with
 * them on (src/test/setup.ts) because it tests the sections; this file is
 * where the default is pinned.
 */

beforeEach(() => {
  __resetSiteSwitches();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
  await i18n.changeLanguage("en");
});

async function settle() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

describe("the switches themselves", () => {
  it("default to English only with every section off", () => {
    expect(getSiteSwitches()).toEqual(DEFAULT_SWITCHES);
    expect(DEFAULT_SWITCHES.languages).toEqual(["en"]);
    expect(Object.values({ ...DEFAULT_SWITCHES, languages: false }).some(Boolean)).toBe(false);
  });

  it("read anything unknown as off, and always keep English", () => {
    expect(normaliseSwitches(null)).toEqual(DEFAULT_SWITCHES);
    expect(normaliseSwitches({ top_rail: "yes", languages: ["fr"] })).toEqual({
      ...DEFAULT_SWITCHES,
      languages: ["en", "fr"],
    });
  });

  it("are read from the theme cache the pre-paint script reads", () => {
    // `lib/site-theme.ts` writes the cache under this key; a rename on one
    // side would silently cost every returning visitor their switches.
    expect(THEME_CACHE_KEY).toBe("praxis.site-theme.v1");
  });
});

describe("one language offered", () => {
  it("answers English whatever the link or the stored choice says", () => {
    window.history.replaceState(null, "", "/public?lang=fr");
    expect(detectLang()).toBe("en");
    localStorage.setItem("praxis.lang", "fr");
    expect(detectLang()).toBe("en");
  });

  it("refuses to switch to French", async () => {
    setLang("fr");
    await settle();
    expect(getLang()).toBe("en");
  });

  it("turns a French page English the moment the switches arrive", async () => {
    setSiteSwitches({ languages: ["en", "fr"] });
    setLang("fr");
    await settle();
    expect(getLang()).toBe("fr");
    setSiteSwitches({ languages: ["en"] });
    await settle();
    expect(getLang()).toBe("en");
    expect(isMultilingual()).toBe(false);
  });
});

describe("the header and footer as a new tenant gets them", () => {
  async function mountChrome() {
    const view = render(
      <BrandingProvider>
        <MemoryRouter initialEntries={["/public/track"]}>
          <SiteHeader />
          <SiteFooter />
        </MemoryRouter>
      </BrandingProvider>,
    );
    await settle();
    return view;
  }

  it("has no top rail, no language switch and no theme switch", async () => {
    const { container } = await mountChrome();
    expect(container.querySelector(".site-utility")).toBeNull();
    expect(screen.queryByRole("group", { name: /language/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /theme/i })).toBeNull();
  });

  it("leaves Portfolio and Careers out of the main nav, and keeps Careers in the footer", async () => {
    await mountChrome();
    const main = within(screen.getByRole("navigation", { name: "Main" }));
    expect(main.queryByRole("link", { name: /our work/i })).toBeNull();
    expect(main.queryByRole("link", { name: /careers/i })).toBeNull();
    const company = within(screen.getByRole("navigation", { name: /company/i }));
    expect(company.getByRole("link", { name: /careers/i })).toBeTruthy();
    expect(company.queryByRole("link", { name: /our work|portfolio/i })).toBeNull();
  });

  it("offers exactly one Client Portal button", async () => {
    await mountChrome();
    const header = screen.getByRole("banner");
    expect(within(header).getAllByRole("link", { name: /client portal/i })).toHaveLength(1);
  });

  it("draws the rail and the theme switch once the tenant turns them on", async () => {
    setSiteSwitches({ ...DEFAULT_SWITCHES, top_rail: true, visitor_theme_switch: true });
    const { container } = await mountChrome();
    expect(container.querySelector(".site-utility")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: /theme/i }).length).toBeGreaterThan(0);
  });
});

describe("a switched-off section", () => {
  it("answers the not-found page at its URL", async () => {
    const { AppRouter } = await import("@/app/router");
    render(
      <MemoryRouter initialEntries={["/public/portfolio"]}>
        <Routes>
          <Route path="*" element={<AppRouter />} />
        </Routes>
      </MemoryRouter>,
    );
    await settle();
    expect(await screen.findByRole("heading", { level: 1 }, { timeout: 4000 })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/success stories/i);
  });
});

describe("the hero headline", () => {
  const SHIPPED = "Freight that moves your business forward";

  it("draws the shipped line as its two halves", () => {
    expect(heroHeadline("Freight that moves your business", "forward", SHIPPED, SHIPPED)).toEqual({
      main: "Freight that moves your business",
      accent: "forward",
    });
  });

  it("never prints the accent twice when the first half already ends with it", () => {
    expect(
      heroHeadline("Freight that moves your business forward", "forward", SHIPPED, SHIPPED),
    ).toEqual({ main: "Freight that moves your business forward", accent: "" });
  });

  it("draws a tenant's whole headline as written, title-cased or not", () => {
    const theirs = "Freight That Moves Your Organization Forward";
    expect(heroHeadline("Freight That Moves Your Business", "Forward", theirs, SHIPPED)).toEqual({
      main: theirs,
      accent: "",
    });
    // The label post-processor title-cases the shipped line too: that is not
    // a rewrite.
    expect(
      heroHeadline("Freight That Moves Your Business", "Forward", "Freight That Moves Your Business Forward", SHIPPED),
    ).toEqual({ main: "Freight That Moves Your Business", accent: "Forward" });
  });

  it("drops a hidden accent", () => {
    expect(heroHeadline("Freight that moves your business", "", SHIPPED, SHIPPED).accent).toBe("");
  });
});
