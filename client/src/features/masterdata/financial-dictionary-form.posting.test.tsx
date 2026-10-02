/**
 * The AI-suggested OHADA posting in the dictionary wizard — meeting 6, F3/F7.
 *
 * WHAT THESE PIN
 *   - With the label and category filled, the wizard asks once (debounced) and
 *     PRE-FILLS the posting on existing accounts, saying where it came from.
 *   - A low-confidence posting carries "Check this one" and cannot be saved
 *     until a person ticks that they checked it.
 *   - The save carries the suggestion's provenance for the audit trail.
 *   - It runs on its own switch: the assistant (`ai_enabled`) is OFF here.
 *   - With its switch off, nothing is asked and the form is as before.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { apiClientMock, fixtures, renderScreen } from "@/test/screen-harness";

const posts: { path: string; body?: unknown }[] = [];
let aiPosting = true;

vi.mock("@/lib/api-client", async () => {
  const base = await apiClientMock();
  return {
    ...base,
    tenant: (path: string, init?: { method?: string; body?: unknown }) => {
      if (init?.method === "POST" || init?.method === "PATCH") {
        posts.push({ path, body: init.body });
        if (path === "/financial-dictionary/posting-suggestion") {
          return Promise.resolve(SUGGESTION);
        }
        return Promise.resolve({ dictionary_item_id: "new", code: "#E099", posting_rules: [], service_tiers: [] });
      }
      return base.tenant(path);
    },
  };
});
vi.mock("@/app/auth/auth-context", async () => {
  const { authContextMock } = await import("@/test/screen-harness");
  const mod = await authContextMock({ ai_enabled: false });
  return {
    ...mod,
    useAuth: () => {
      const a = mod.useAuth();
      return { ...a, user: { ...a.user, ai_features: { dictionary_posting: aiPosting } } };
    },
  };
});

import { DictForm } from "./financial-dictionary-form";

const SUGGESTION = {
  source: "search",
  model: "gemini-3.1-pro",
  cache_entry_id: "11111111-1111-4111-8111-111111111111",
  answered_at: "2026-10-01T10:00:00Z",
  direction: "EXPENSE",
  is_disbursement: false,
  vat_treatment: "STANDARD",
  rules: [
    {
      applies_context: "purchase",
      debit_account: "6131",
      credit_account: "4011",
      tax_code_id: null,
      is_disbursement: false,
      mapping: { debit: { suggested: "6131", account: "6131", how: "exact" }, credit: { suggested: "4011", account: "4011", how: "exact" } },
    },
  ],
  needs_mint: false,
  confidence: "low",
  check_needed: true,
  rationale: "Transport charges bought in on our own account.",
  sources: [{ title: "Plan SYSCOHADA révisé", uri: "https://example.org/ohada" }],
  search_suggestion_html: "<div>chip</div>",
  matched_label: null,
  similarity: null,
  fallback_reason: null,
  cost: { native: 0.02, currency: "USD", search: 0.014 },
};

beforeEach(() => {
  posts.length = 0;
  fixtures.current = {};
  aiPosting = true;
  try {
    localStorage.clear();
  } catch {
    /* @silent:storage — a test without storage starts clean anyway */
  }
});

describe("the wizard pre-fills a suggested OHADA posting", () => {
  it("asks once the label and category are filled, pre-fills, and saves with its provenance after a check", async () => {
    const user = userEvent.setup();
    renderScreen(<DictForm row={null} onClose={() => {}} onSaved={() => {}} />, {
      routes: { "/chart-of-accounts": [{ code: "6131", label_fr: "Transport routier tiers", class: 6, is_postable: true }, { code: "4011", label_fr: "Fournisseurs", class: 4, is_postable: true }] },
    });
    await user.type(screen.getByLabelText(/Name \(FR\)/), "Frais de ticket");
    await user.type(screen.getByLabelText(/Name \(EN\)/), "Gate-Pass Fee");

    expect(await screen.findByText("AI-suggested posting", {}, { timeout: 3000 })).toBeInTheDocument();
    const asked = posts.filter((p) => p.path === "/financial-dictionary/posting-suggestion");
    expect(asked).toHaveLength(1);
    expect(asked[0].body).toMatchObject({ label_fr: "Frais de ticket", label_en: "Gate-Pass Fee", category: "service", direction: null });
    expect(screen.getByText(/Suggested from a web search · gemini-3\.1-pro/)).toBeInTheDocument();
    expect(screen.getByText("Low confidence")).toBeInTheDocument();
    expect(screen.getByText("Check this one")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Plan SYSCOHADA révisé" })).toHaveAttribute("href", "https://example.org/ohada");
    expect(screen.getByTitle("Google Search suggestions")).toBeInTheDocument();

    // Low confidence: not savable until a person confirms it.
    const save = screen.getByRole("button", { name: "Create item" });
    expect(save).toBeDisabled();
    await user.click(screen.getByLabelText("I checked this posting"));
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    await waitFor(() => expect(posts.some((p) => p.path === "/financial-dictionary")).toBe(true));
    const body = posts.find((p) => p.path === "/financial-dictionary")!.body as Record<string, unknown>;
    expect(body.direction).toBe("EXPENSE");
    expect(body.posting_rules).toEqual([
      expect.objectContaining({ applies_context: "purchase", debit_account: "6131", credit_account: "4011" }),
    ]);
    expect(body.posting_suggestion).toMatchObject({
      source: "search",
      model: "gemini-3.1-pro",
      confidence: "low",
      direction: "EXPENSE",
      checked: true,
    });
  });

  it("with its own switch off, asks nothing", async () => {
    aiPosting = false;
    const user = userEvent.setup();
    renderScreen(<DictForm row={null} onClose={() => {}} onSaved={() => {}} />, { routes: {} });
    await user.type(screen.getByLabelText(/Name \(FR\)/), "Frais de ticket");
    await new Promise((r) => setTimeout(r, 1200));
    expect(posts.filter((p) => p.path === "/financial-dictionary/posting-suggestion")).toHaveLength(0);
    expect(screen.queryByText("AI-suggested posting")).not.toBeInTheDocument();
  });
});
