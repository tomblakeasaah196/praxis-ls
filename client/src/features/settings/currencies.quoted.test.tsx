/**
 * Rates read foreign-first.
 *
 * WHAT THESE PIN
 *   - `fx_rate_daily.rate` is stored base-first ("1 XAF = 0.00152449 EUR"),
 *     but the page shows it the way banks quote it: "1 EUR = 655.957 XAF".
 *   - The Set-rate form takes that quoted figure and sends the base-first
 *     inverse, so the stored convention (and every conversion built on it)
 *     is unchanged.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiClientMock,
  authContextMock,
  fixtures,
  renderScreen,
} from "@/test/screen-harness";

const posts: { path: string; init?: { method?: string; body?: unknown } }[] = [];

vi.mock("@/lib/api-client", async () => {
  const base = await apiClientMock();
  return {
    ...base,
    tenant: (path: string, init?: { method?: string; body?: unknown }) => {
      if (init?.method) {
        posts.push({ path, init });
        return Promise.resolve({});
      }
      return base.tenant(path);
    },
  };
});
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { CurrenciesPage } from "./currencies";

const LIST = [
  { code: "XAF", name: "CFA Franc BEAC", symbol: "FCFA", is_base: true, is_active: true, decimals: 0, usage_count: 5, most_used: true },
  { code: "EUR", name: "Euro", symbol: "€", is_base: false, is_active: true, decimals: 2, usage_count: 2 },
  { code: "GBP", name: "Pound Sterling", symbol: "£", is_base: false, is_active: true, decimals: 2, usage_count: 1 },
];

const RATE = { rate: 0.00152449, as_of_date: "2026-09-19", source: "exchangerate-api", is_override: false, fetched_at: "2026-09-19T00:05:00.000Z" };
const GBP_RATE = { rate: 0.00131, as_of_date: "2026-09-19", source: "exchangerate-api", is_override: false, fetched_at: "2026-09-19T00:05:00.000Z" };
const GBP_OVERRIDE = { rate: 0.0013, as_of_date: "2026-09-18", source: "manual", is_override: true, standing: true, set_by_name: "Ada Treasurer" };
const PARITY = { base: "XAF", quote: "EUR", rate: 1 / 655.957, authority: "BEAC", anchor: "EUR", source: "BEAC" };

const routes = {
  "/currencies": LIST,
  "/currencies/sync-status": { data: { key_configured: true, scheduler_enabled: true, base: "XAF", last_run: null } },
  "/currencies/XAF/360": {
    currency: LIST[0], base: "XAF", is_base: true, catalogue: null, countries: [],
    rate_history: [], rate_history_total: 0, latest_rate: null, last_sync: null, overrides: [], usage: [], usage_total: 0,
  },
  "/currencies/EUR/360": {
    currency: LIST[1], base: "XAF", is_base: false,
    catalogue: { code: "EUR", name: "Euro", symbol: "€", decimals: 2, numeric: "978" },
    countries: [], rate_history: [RATE], rate_history_total: 1,
    latest_rate: RATE, last_sync: RATE, overrides: [], usage: [], usage_total: 0,
    working_rate: { ...PARITY, is_fixed: true, as_of_date: "2026-10-01" },
    fixed_parity: PARITY,
    standing_override: null,
  },
  "/currencies/GBP/360": {
    currency: LIST[2], base: "XAF", is_base: false,
    catalogue: { code: "GBP", name: "Pound Sterling", symbol: "£", decimals: 2, numeric: "826" },
    countries: [], rate_history: [GBP_RATE, GBP_OVERRIDE], rate_history_total: 2,
    latest_rate: GBP_RATE, last_sync: GBP_RATE, overrides: [GBP_OVERRIDE], usage: [], usage_total: 0,
    working_rate: GBP_OVERRIDE, fixed_parity: null, standing_override: GBP_OVERRIDE,
  },
};

beforeEach(() => {
  posts.length = 0;
  fixtures.current = {};
});

describe("Currencies page — rates read foreign-first", () => {
  it("shows the latest rate as 1 EUR = 655.957 XAF", async () => {
    const user = userEvent.setup();
    renderScreen(<CurrenciesPage />, { routes });
    await user.click(await screen.findByText("Euro"));
    // The latest-rate card and the last-sync line both read foreign-first.
    expect((await screen.findAllByText("1 EUR = 655.957 XAF")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/1 XAF = /)).not.toBeInTheDocument();
  });

  it("stores the base-first inverse of the rate typed in the form", async () => {
    const user = userEvent.setup();
    renderScreen(<CurrenciesPage />, { routes });
    await user.click(await screen.findByText("Pound Sterling"));
    await user.click(await screen.findByRole("button", { name: "Set rate" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByPlaceholderText("655.957"), "800");
    expect(within(dialog).getByText(/saved as 1 XAF = 0\.00125 GBP/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Save rate" }));
    await waitFor(() => expect(posts.some((p) => p.path === "/currencies/rates")).toBe(true));
    const body = posts.find((p) => p.path === "/currencies/rates")!.init!.body as Record<string, unknown>;
    expect(body).toMatchObject({ base: "XAF", quote: "GBP", rate: 0.00125 });
  });
});

describe("Currencies page — the fixed EUR parity (meeting 6, F1)", () => {
  it("shows EUR at 655.957 with a Fixed parity (BEAC) badge and no Set rate", async () => {
    const user = userEvent.setup();
    renderScreen(<CurrenciesPage />, { routes });
    await user.click(await screen.findByText("Euro"));
    expect(await screen.findByText("Fixed parity (BEAC)")).toBeInTheDocument();
    expect(screen.getAllByText("1 EUR = 655.957 XAF").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Set rate" })).not.toBeInTheDocument();
    // The list marks it too.
    expect(screen.getAllByText("Fixed").length).toBeGreaterThan(0);
  });
});

describe("Currencies page — a manual rate stands until released (meeting 6, 3.1)", () => {
  it("says the manual rate stands and releases it with Follow the feed again", async () => {
    const user = userEvent.setup();
    renderScreen(<CurrenciesPage />, { routes });
    await user.click(await screen.findByText("Pound Sterling"));
    expect(await screen.findByText(/A manual rate stands: 1 GBP = 769\.231 XAF/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Follow the feed again" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Follow the feed again" }));
    await waitFor(() => expect(posts.some((p) => p.path === "/currencies/rates/release")).toBe(true));
    const body = posts.find((p) => p.path === "/currencies/rates/release")!.init!.body as Record<string, unknown>;
    expect(body).toEqual({ base: "XAF", quote: "GBP" });
  });
});
