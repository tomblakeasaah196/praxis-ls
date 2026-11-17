import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ProfilePage } from "@/features/profile/profile-page";
import "@/lib/i18n";

/**
 * The shared Company Profile page (Sales lean revamp PR 5, guide §3.6), against
 * a stubbed read: it prints the server's presentation as given, and a dead
 * link says so in the page's own words.
 */

const PRESENTATION = {
  language: "EN",
  title: "Company Profile",
  version: { number: 3, published_at: "2026-11-02T10:00:00Z" },
  company: { name: "Smart Logistics", tagline: "Freight through Central Africa", logo_url: null, cover_url: null },
  sections: [
    { key: "who_we_are", title: "Who We Are", paragraphs: [{ key: "positioning", label: null, body: "A forwarder in Douala." }] },
    { key: "capacity", title: "Capacity & Network", figures: [{ key: "fleet_size", label: "Fleet Size", value: "1,250", detail: "vehicles" }], note: null },
    { key: "contact", title: "Contact", lines: [{ key: "email", label: "Email", value: "hello@example.org", href: "mailto:hello@example.org" }] },
  ],
};

function stub(status: number, data?: unknown) {
  const fetch = vi.fn(async (_input: RequestInfo | URL) =>
    new Response(JSON.stringify(status === 200 ? { data } : { error: { code: "NOT_FOUND" } }), {
      status,
      headers: { "Content-Type": "application/json" },
    }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/public/profile/:token" element={<ProfilePage />} />
      </Routes>
    </MemoryRouter>,
  );

afterEach(() => vi.unstubAllGlobals());

describe("the shared Company Profile page", () => {
  it("prints the server's sections and figures exactly as sent", async () => {
    const fetch = stub(200, { presentation: PRESENTATION });
    renderAt("/public/profile/tok123?lang=EN");
    expect(await screen.findByRole("heading", { level: 1, name: "Smart Logistics" })).toBeTruthy();
    expect(screen.getByText("Freight through Central Africa")).toBeTruthy();
    // Formatted by the server; the page must not re-format it.
    expect(screen.getByText("1,250")).toBeTruthy();
    expect(screen.getByRole("link", { name: "hello@example.org" }).getAttribute("href")).toBe("mailto:hello@example.org");
    const url = String(fetch.mock.calls[0][0]);
    expect(url).toContain("/public/company-profile/tok123");
    expect(url).toContain("lang=EN");
    const pdf = screen.getAllByRole("link").find((a) => a.getAttribute("href")?.includes("/pdf"));
    expect(pdf?.getAttribute("href")).toBe("/api/tenant/public/company-profile/tok123/pdf?lang=EN");
  });

  it("says a dead link is dead, and offers no sign-in", async () => {
    stub(404);
    renderAt("/public/profile/expired");
    expect(await screen.findByText("This link is no longer valid.")).toBeTruthy();
    expect(screen.queryByText(/sign in/i)).toBeNull();
  });
});
