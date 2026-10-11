/**
 * Service type 360 → Commercial.
 *
 * Four things worth a test, all of them the kind that look fine in a browser
 * on a tenant with one invoice:
 *
 *   1. The sub-tab is URL state (`?sub=`), on its own key, so picking Bill
 *      cannot knock the reader out of Commercial the way sharing `?tab=`
 *      would.
 *   2. Only the open sub-tab's blocks are MOUNTED. That is the whole point of
 *      the split: eleven paginated tables that all fetch on open is eleven
 *      requests for a page showing three.
 *   3. A refused block says so. An empty table and a refusal look identical,
 *      and mean opposite things.
 *   4. A refused tile reads "Restricted", never 0. Same reason, on the strip.
 */
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";

import { apiClientMock, authContextMock, renderScreen } from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { ServiceTypeCommercialTab } from "./service-type-commercial-tab";

const ST_ID = "st-commercial-1";

const BLOCKS = [
  { block: "quotations", group: "sell", allowed: true, gate: "MOD-27" },
  { block: "proforma", group: "sell", allowed: true, gate: "MOD-50" },
  { block: "margin_sims", group: "sell", allowed: true, gate: null },
  { block: "extra_charges", group: "sell", allowed: true, gate: "MOD-28" },
  { block: "pricing_variance", group: "sell", allowed: true, gate: "MOD-27" },
  // Refused: this reader has no MOD-51 and no finance visibility.
  { block: "invoices", group: "bill", allowed: false, gate: "MOD-51" },
  { block: "credit_notes", group: "bill", allowed: false, gate: "MOD-51" },
  { block: "collections", group: "bill", allowed: true, gate: "MOD-09" },
  { block: "costings", group: "spend", allowed: true, gate: "MOD-46" },
  { block: "cash_requests", group: "spend", allowed: true, gate: "MOD-49" },
  { block: "supplier_invoices", group: "spend", allowed: true, gate: "MOD-61" },
];

const SUMMARY = {
  blocks: BLOCKS,
  totals: {
    quotations: [{ currency: "XAF", doc_count: 3, total_ttc: 2146500, won_ttc: 1788750 }],
    proforma: [],
    margin_sims: [],
    extra_charges: [],
    pricing_variance: [],
    invoices: null,
    credit_notes: null,
    collections: [],
    costings: [{ currency: "XAF", doc_count: 1, planned_total: 800000, planned_disbursement: 100000 }],
    cash_requests: [],
    supplier_invoices: [],
  },
  actual_xaf: 700000,
  kpis: {
    quoted: {
      allowed: true,
      xaf: 2146500,
      count: 3,
      by_currency: [
        { currency: "XAF", total_ttc: 2146500 },
        { currency: "EUR", total_ttc: 2385 },
      ],
    },
    win_rate: { allowed: true, percent: 66.666, won: 2, decided: 3 },
    planned: { allowed: true, xaf: 800000, by_currency: [{ currency: "XAF", planned_total: 800000 }] },
    actual: { allowed: true, xaf: 700000, by_currency: [] },
    // Refused, because the invoices block is.
    billed_net: { allowed: false, xaf: null, by_currency: [] },
    margin: { allowed: false, percent: null },
  },
  finance_visibility: false,
};

const QUOTATION_ROWS = [
  {
    row_id: "q1",
    doc_number: "DEV-0001",
    status: "ACCEPTED",
    currency: "XAF",
    total_ht: "1000000.00",
    total_ttc: "1192500.00",
    margin_percent: "18.5",
    valid_until: "2026-11-30",
    dossier_ref: "SL-0001",
    client_name: "Bolloré Logistics",
  },
];

const COSTING_ROWS = [
  {
    row_id: "c1",
    doc_number: "CST-0001",
    status: "APPROVED_LOCKED",
    currency: "XAF",
    planned_total: "800000.00",
    planned_disbursement: "100000.00",
    dossier_ref: "SL-0001",
    client_name: "Bolloré Logistics",
  },
];

const ROUTES = {
  [`/service-types/${ST_ID}/commercial`]: SUMMARY,
  [`/service-types/${ST_ID}/commercial/quotations`]: QUOTATION_ROWS,
  [`/service-types/${ST_ID}/commercial/costings`]: COSTING_ROWS,
  [`/service-types/${ST_ID}/commercial/proforma`]: [],
  [`/service-types/${ST_ID}/commercial/margin_sims`]: [],
  [`/service-types/${ST_ID}/commercial/extra_charges`]: [],
  [`/service-types/${ST_ID}/commercial/pricing_variance`]: [],
  [`/service-types/${ST_ID}/commercial/collections`]: [],
  [`/service-types/${ST_ID}/commercial/cash_requests`]: [],
  [`/service-types/${ST_ID}/commercial/supplier_invoices`]: [],
};

let lastSearch = "";
function LocationProbe() {
  lastSearch = useLocation().search;
  return null;
}

const mount = (path = "/") =>
  renderScreen(
    <>
      <ServiceTypeCommercialTab serviceTypeId={ST_ID} />
      <LocationProbe />
    </>,
    { routes: ROUTES, path },
  );

describe("ServiceTypeCommercialTab", () => {
  it("opens on Sell, and only the Sell blocks are mounted", async () => {
    mount();
    expect(await screen.findByText("Quotations")).toBeInTheDocument();
    expect(screen.getByText("Pricing Variance")).toBeInTheDocument();
    // Bill and Spend are a sub-tab away, so their tables are not in the tree
    // and their endpoints have not been asked for.
    expect(screen.queryByText("FINAL Invoices")).not.toBeInTheDocument();
    expect(screen.queryByText("Costing Sheets")).not.toBeInTheDocument();
  });

  it("the open sub-tab is ?sub=, and a remount at that URL restores it", async () => {
    const user = userEvent.setup();
    const first = mount();
    await screen.findByText("Quotations");
    // Sell is the fallback, so it leaves the URL clean.
    expect(lastSearch).toBe("");

    await user.click(screen.getByRole("button", { name: /^Spend$/ }));
    expect(await screen.findByText("Costing Sheets")).toBeInTheDocument();
    expect(lastSearch).toBe("?sub=Spend");

    first.unmount();
    mount("/?sub=Spend");
    expect(await screen.findByText("Costing Sheets")).toBeInTheDocument();
    expect(screen.getByText("Cash Requests")).toBeInTheDocument();
  });

  it("renders a block's rows and its per-currency subtotal", async () => {
    mount();
    expect(await screen.findByText("DEV-0001")).toBeInTheDocument();
    expect(screen.getByText("Bolloré Logistics")).toBeInTheDocument();
    // The subtotal is the SERVER's figure, not a sum of the loaded page.
    expect(screen.getByText(/quoted 2,146,500\.00 XAF/)).toBeInTheDocument();
  });

  it("a refused block says so instead of rendering an empty table", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText("Quotations");
    await user.click(screen.getByRole("button", { name: /^Bill$/ }));

    expect(await screen.findByText("FINAL Invoices")).toBeInTheDocument();
    // Two refused blocks on this sub-tab, each saying why rather than showing
    // a table that looks like "no invoices exist".
    expect(
      screen.getAllByText(/You do not have permission to see this/),
    ).toHaveLength(2);
    // ...and the collections block, which this reader MAY open, is a table.
    expect(screen.getByText("Collections")).toBeInTheDocument();
  });

  it("an empty block says what is absent, in its own words", async () => {
    mount();
    await screen.findByText("Quotations");
    // The block's own line, not MiniTable's generic "Nothing here yet." — and
    // exactly once: rendering both the table's empty branch and this said it
    // twice.
    expect(
      await screen.findByText(
        "No proforma has been issued on a file of this service type.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Nothing here yet.")).not.toBeInTheDocument();
  });

  it("a refused tile reads Restricted, never zero", async () => {
    mount();
    await screen.findByText("Quotations");
    // Billed and margin are refused; quoted and planned are not.
    expect(screen.getAllByText("Restricted").length).toBeGreaterThanOrEqual(2);
    // `getAllByText`: KpiTile renders its value and repeats it in a `title`
    // for the truncated case, so the figure is legitimately in the tree twice.
    expect(screen.getAllByText("2,146,500.00 XAF").length).toBeGreaterThan(0);
    expect(screen.getAllByText("67%").length).toBeGreaterThan(0);
  });
});
