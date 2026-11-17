import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { apiClientMock, authContextMock, renderScreen } from "@/test/screen-harness";
vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

/**
 * The editor's own contract with the API is what these pin, so the API module
 * is faked directly: the harness's `tenant()` cannot see a request body.
 */
const saveSection = vi.fn();
vi.mock("@/lib/company-profile-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/company-profile-api")>("@/lib/company-profile-api");
  return { ...actual, getEditor: vi.fn(async () => EDITOR), saveSection: (...a: unknown[]) => saveSection(...a) };
});

import { CompanyProfilePage } from "./company-profile";
import type { Editor } from "@/lib/company-profile-api";

const published = {
  version_id: "v1", number: 1, status: "PUBLISHED" as const, change_note: null, created_at: "2026-11-01T10:00:00Z",
  created_by_name: null, published_at: "2026-11-01T10:00:00Z", published_by_name: "Test Operator",
};
const draft = { ...published, version_id: "v2", number: 2, status: "DRAFT" as const, published_at: null, published_by_name: null };

const EDITOR: Editor = {
  draft: null,
  published,
  versions: [published],
  sections: [
    { key: "cover", structure: { on: true }, text_en: { tagline: "Beyond borders" }, text_fr: {} },
    { key: "who_we_are", structure: { on: true, show: {} }, text_en: {}, text_fr: {} },
    { key: "services", structure: { on: true, items: [] }, text_en: {}, text_fr: {} },
    { key: "capacity", structure: { on: true, figures: {} }, text_en: {}, text_fr: {} },
    { key: "certifications", structure: { on: true, items: [] }, text_en: {}, text_fr: {} },
    { key: "case_stories", structure: { on: true, story_ids: [] }, text_en: {}, text_fr: {} },
    { key: "clients", structure: { on: false, logo_ids: [] }, text_en: {}, text_fr: {} },
    { key: "why_us", structure: { on: true, items: [] }, text_en: {}, text_fr: {} },
    { key: "contact", structure: { on: true, show: {} }, text_en: {}, text_fr: {} },
  ],
  completeness: {
    cover: "partial", who_we_are: "empty", services: "empty", capacity: "complete", certifications: "empty",
    case_stories: "empty", clients: "empty", why_us: "empty", contact: "complete",
  },
  cover_url: null,
  contact: null,
  choices: { services: [], stories: [], logos: [] },
  derived: null,
};

describe("Company Profile editor", () => {
  beforeEach(() => {
    saveSection.mockReset();
    saveSection.mockImplementation(async (key: string, body: Record<string, unknown>) => ({
      draft,
      section: { key, structure: (body.structure as object) || { on: true }, text_en: body.text_en || {}, text_fr: body.text_fr || {} },
      completeness: EDITOR.completeness,
    }));
  });

  it("lists the nine sections, says which version it shows, and has no JSON box", async () => {
    renderScreen(<CompanyProfilePage />);
    await screen.findByText("Published v1");
    for (const t of ["Who We Are", "Capacity & Network", "Certifications & Memberships", "Why Choose Us", "Contact"]) {
      expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    }
    expect(document.body.textContent).not.toMatch(/\[\s*\{/);
    // Publish waits for a draft: a published version is never edited.
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
  });

  it("saves a word when its box is left, merged with the words already there", async () => {
    renderScreen(<CompanyProfilePage />);
    const fr = await screen.findAllByRole("textbox");
    // Cover: Tagline EN, then Tagline FR.
    fireEvent.change(fr[1], { target: { value: "Au-delà des frontières" } });
    fireEvent.blur(fr[1]);
    await waitFor(() => expect(saveSection).toHaveBeenCalledTimes(1));
    expect(saveSection).toHaveBeenCalledWith("cover", { text_fr: { tagline: "Au-delà des frontières" } });
    await screen.findByText("Draft v2");
  });

  it("refuses an over-long word with the shared schema, before any request", async () => {
    renderScreen(<CompanyProfilePage />);
    const boxes = await screen.findAllByRole("textbox");
    // maxLength stops typing; a paste through the DOM is what this guards.
    fireEvent.change(boxes[0], { target: { value: "x".repeat(200) } });
    fireEvent.blur(boxes[0]);
    await screen.findByText(/At most 160 characters/);
    expect(saveSection).not.toHaveBeenCalled();
  });
});
