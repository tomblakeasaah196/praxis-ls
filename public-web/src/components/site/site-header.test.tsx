/**
 * The header as a client meets it (tenant review of 29 Sep 2026):
 *
 *   - F1 / D6 — "Client Portal" sits beside "Request a Quote" on the bar and
 *     first in the mobile drawer, and the utility strip keeps its link;
 *   - F2 / D5 — the labels render in Title Case, in English and French, with
 *     the standard ON (the harness pins it off for everything else);
 *   - F3 — the Services link carries its caret inside its own padding.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BrandingProvider } from "@/app/branding";
import { SiteHeader } from "@/components/site/site-header";
import i18n from "@/lib/i18n";
import { setLabelCase } from "@/lib/label-case";
import { __resetServiceCache } from "@/lib/use-services";

const card = (n: number) => ({
  service_type_id: `st-${n}`, slug_fr: `s-${n}`, slug_en: `s-${n}`, name_fr: `Service ${n}`, name_en: `Service ${n}`,
  mode: "SEA", enquiry_shape: "ROUTE", short_description_fr: null, short_description_en: null, claim_fr: null,
  claim_en: null, accent: null, cover_url: null, icon_url: null, has_video: false, sort_order: n, published_month: null,
});

beforeEach(() => {
  __resetServiceCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const body = String(url).includes("/public/services")
        ? { data: { groups: [{ key: "freight", name_fr: "Fret", name_en: "Freight", icon: null, services: [card(1), card(2)] }] } }
        : { data: {} };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  setLabelCase("TITLE", i18n);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  setLabelCase("AS_WRITTEN", i18n);
  await i18n.changeLanguage("en");
});

async function mount(lang: "en" | "fr") {
  await i18n.changeLanguage(lang);
  const view = render(
    <BrandingProvider>
      <MemoryRouter initialEntries={["/public/track"]}>
        <SiteHeader />
      </MemoryRouter>
    </BrandingProvider>,
  );
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  return view;
}

describe("the portal entry beside the quote (D6)", () => {
  it("puts an outline Client Portal button beside the orange Request a Quote", async () => {
    const { container } = await mount("en");
    const row = container.querySelector(".hdr-row > div:last-child") as HTMLElement;
    const [portal, quote] = within(row).getAllByRole("link");
    expect(portal).toHaveTextContent("Client Portal");
    expect(portal).toHaveAttribute("href", "/portal/login");
    expect(portal.className).toMatch(/\bbtn-outline\b/);
    expect(quote).toHaveTextContent("Request a Quote");
    expect(quote.className).toMatch(/\bbtn-primary\b/);
    // The utility strip keeps its own link.
    expect(within(container.querySelector(".site-utility") as HTMLElement).getByRole("link", { name: "Client Portal" })).toBeInTheDocument();
  });

  it("opens the mobile drawer on the same two buttons, first", async () => {
    await mount("en");
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    const drawer = document.getElementById("site-menu") as HTMLElement;
    const links = within(drawer).getAllByRole("link").map((a) => a.textContent);
    expect(links.slice(0, 2)).toEqual(["Client Portal", "Request a Quote"]);
  });
});

describe("labels in Title Case (D5)", () => {
  it("in English", async () => {
    await mount("en");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Our Work" })).toBeInTheDocument();
  });

  it("in French, small words left small", async () => {
    const { container } = await mount("fr");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Nos Réalisations" })).toBeInTheDocument();
    const row = container.querySelector(".hdr-row > div:last-child") as HTMLElement;
    expect(within(row).getAllByRole("link").map((a) => a.textContent)).toEqual(["Portail Client", "Demander un Devis"]);
  });
});

describe("the nav's rhythm (F3)", () => {
  it("gives the Services link its caret's room inside its own padding", async () => {
    await mount("en");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Services" }).className).toMatch(/\bnavlink-caret\b/);
    expect(within(nav).getByRole("link", { name: "About" }).className).not.toMatch(/navlink-caret/);
  });
});
