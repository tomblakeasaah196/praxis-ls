/**
 * The tax screen, after the meeting-7 review.
 *
 * ── WHAT THESE PIN ─────────────────────────────────────────────────────────
 *
 * On 1 Oct 2026 at 01:25:15, twelve of the twenty-one seeded tax codes were
 * mapped on one side only or pointed at a non-postable heading, and the FIRST
 * place anybody could see that was Tom clicking Amend rate on one code, live in
 * front of the tenant: "oh I think there's a problem here, it doesn't write the
 * accounts it posts to … debit accounts none."
 *
 * The data is repaired (seed 90999) and the API refuses a thirteenth
 * (rules.assertPostingAccounts). These assert the part that makes a FOURTEENTH
 * findable without a code review: the mapping is a column on the screen, and a
 * jurisdiction with a gap says so at the top the moment it opens. A banner is
 * easy to delete by accident and nothing else would notice.
 *
 * Plus the one-word change the tenant asked for twice (01:29:29): the OTHER
 * family reads "Autres taxes (Other taxes)", not "Autre".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
  fixtures,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { TaxJurisdictionsPage } from "./tax-jurisdictions";

const JUR = {
  jurisdiction_id: "j1",
  country_code: "CM",
  name: "Cameroun",
  currency: "XAF",
  is_active: true,
};

/** Three codes as 9010 ships them, two of them defective. */
const CODES = [
  {
    tax_code_id: "t1",
    code: "TVA_STD",
    kind: "VAT",
    rate_percent: "19.2500",
    applies_to: "sales",
    posts_debit_account: "4111",
    posts_credit_account: "4432",
    effective_from: "2026-01-01",
    legal_reference: "CGI TVA",
  },
  {
    tax_code_id: "t2",
    code: "CFC_EE",
    kind: "PAYROLL",
    rate_percent: "1.0000",
    applies_to: "salary",
    // The exact shape Tom hit: a credit and no debit.
    posts_debit_account: null,
    posts_credit_account: "4471",
    effective_from: "2026-01-01",
    legal_reference: "Crédit Foncier (salarié)",
  },
  {
    tax_code_id: "t3",
    code: "PATENTE",
    kind: "OTHER",
    rate_percent: null,
    applies_to: null,
    posts_debit_account: "62",
    posts_credit_account: "447",
    effective_from: "2026-01-01",
    legal_reference: null,
  },
];

/** What `tax_jurisdiction.get` ships alongside the codes. */
const UNMAPPED = [
  {
    tax_code_id: "t2",
    code: "CFC_EE",
    kind: "PAYROLL",
    reason: "MISSING",
    posts_debit_account: null,
    posts_credit_account: "4471",
  },
  {
    tax_code_id: "t3",
    code: "PATENTE",
    kind: "OTHER",
    reason: "NOT_POSTABLE",
    posts_debit_account: "62",
    posts_credit_account: "447",
  },
];

const routes = (unmapped = UNMAPPED) => ({
  "/tax-jurisdictions": [JUR],
  "/tax-jurisdictions/j1": { ...JUR, tax_codes: CODES, unmapped_codes: unmapped },
  "/chart-of-accounts": [
    { code: "4111", label_en: "Customers", is_postable: true },
    { code: "4432", label_en: "Output VAT on services", is_postable: true },
    { code: "4471", label_en: "Payroll withholding", is_postable: true },
    { code: "422", label_en: "Net pay payable", is_postable: true },
  ],
});

const view = (unmapped = UNMAPPED) =>
  renderScreen(<TaxJurisdictionsPage />, { routes: routes(unmapped) });

beforeEach(() => {
  fixtures.current = {};
});

describe("the tax screen · the gap is named at the top (finding 3.1)", () => {
  it("counts the half-mapped codes before anyone clicks anything", async () => {
    view();
    expect(await screen.findByText(/2 tax codes are not fully mapped/i)).toBeInTheDocument();
  });

  it("names each one, and says which KIND of gap it is", async () => {
    view();
    await screen.findByText(/not fully mapped/i);
    // "a side is NULL" and "points at a heading" need different fixes, so the
    // banner distinguishes them rather than saying "broken" twice.
    expect(screen.getByText(/debit account missing/i)).toBeInTheDocument();
    expect(
      screen.getByText(/points at a heading, not a postable account/i),
    ).toBeInTheDocument();
    // Scoped to the banner: both codes are also in the table below, which is
    // the point — the banner is the summary, the row is where you fix it.
    const banner = screen.getByText(/not fully mapped/i).closest("div") as HTMLElement;
    expect(within(banner).getByText("CFC_EE")).toBeInTheDocument();
    expect(within(banner).getByText("PATENTE")).toBeInTheDocument();
  });

  it("says nothing at all once every code is mapped", async () => {
    // The quiet state matters: a banner that is always there is a banner nobody
    // reads, and the repaired tenant must open clean.
    view([]);
    await screen.findByText(/The current effective rate for every code/i);
    expect(screen.queryByText(/not fully mapped/i)).not.toBeInTheDocument();
  });

  it("uses the singular for one", async () => {
    view([UNMAPPED[0]]);
    expect(await screen.findByText(/1 tax code is not fully mapped/i)).toBeInTheDocument();
  });
});

describe("the tax screen · where a code posts is a column (finding 3.1)", () => {
  it("shows both accounts on the overview, and flags the ones that are not mapped", async () => {
    view();
    const table = await screen.findByRole("table");
    // One cell, "debit → credit", so it reads as a posting rather than two
    // unrelated numbers. Asserted on the ROW's text because the arrow is its own
    // muted span, which breaks a plain text matcher.
    const row = within(table)
      .getByText("TVA_STD")
      .closest("tr") as HTMLElement;
    expect(row.textContent?.replace(/\s+/g, " ")).toContain("4111 → 4432");
    // And the gap reads as a gap in the row itself, not only in the banner —
    // with the server's reason, so "no debit" and "that is a heading" are not
    // reported as the same thing.
    expect(within(table).getByText("not mapped")).toBeInTheDocument();
    expect(within(table).getByText("not a postable account")).toBeInTheDocument();
  });
});

describe("the tax screen · 'other taxes' (finding 3.5)", () => {
  it("renames the family the tenant asked about, twice", async () => {
    view();
    await screen.findByText(/not fully mapped/i);
    // "Why did you put it in French? … that put it other taxes. Yes. Put it
    // other taxes." — and the bilingual shape the TVA tab already had.
    // SectionTabs renders real buttons with aria-current, not role="tab"
    // (section-tabs.tsx:9 — only one strip on a page may be a tablist).
    expect(
      screen.getByRole("button", { name: /Autres taxes \(Other taxes\)/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Autre$/ })).not.toBeInTheDocument();
  });

  it("gives every other family the same French (English) shape", async () => {
    view();
    await screen.findByText(/not fully mapped/i);
    for (const name of [
      /TVA \(VAT\)/i,
      /Retenue à la source \(Withholding\)/i,
      /Impôt sociétés \(Corporate tax\)/i,
      /Paie & social \(Payroll\)/i,
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });
});

describe("the tax screen · a new code cannot be half-mapped (decision D4)", () => {
  it("blocks Save until both accounts are chosen, and says why", async () => {
    const user = userEvent.setup();
    view();
    await user.click(await screen.findByRole("button", { name: "Add code" }));
    // The server refuses it too (rules.assertPostingAccounts); this is the
    // message arriving before the press rather than as a 422 after it.
    await waitFor(() =>
      expect(screen.getByText(/Both accounts are required/i)).toBeInTheDocument(),
    );
    const save = screen
      .getAllByRole("button")
      .find((b) => /^(Save|Add)/i.test(b.textContent || ""));
    expect(save).toBeDefined();
    expect(save).toBeDisabled();
  });
});
