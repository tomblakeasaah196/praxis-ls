/**
 * ⌘K finds everything — and must not offer a door it knows is locked.
 *
 * WHY THIS SURFACE IN PARTICULAR. The ribbon and the rail were made
 * permission-aware first, which is the right order — they are what a user
 * looks at — and it left the palette as the widest unfiltered offer in the
 * product. It is now wider still (meeting 6, PR 4 — G5): every registered page
 * and hub, every 360 tab, and records from `/search`. So the permission cases
 * below are the ones that keep it honest, and the negative case at the bottom
 * of them is the one that keeps it USABLE: filtering against an unanswered
 * permissions read is indistinguishable from filtering against a user who has
 * nothing, and a palette that opens EMPTY on a slow first login teaches the
 * user the feature is broken.
 *
 * The record half is the server's: `/search` gates each provider on its
 * module's view grant before it queries (tests/unit/search.test.js). Here the
 * API is stubbed, and what is pinned is the palette's second lock — a record
 * whose address the person cannot open is dropped even if a response carries
 * it — and how a tab asks "which one?".
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { NavAccess } from "@/lib/nav-access";
import { ShellContext, type ShellContextValue } from "@/app/layout/shell-context";
import { EMPTY_SHELL_PREFS } from "@/lib/preferences";
import type { SearchAnswer } from "@/lib/search-api";
import { CommandPalette } from "./command-palette";

const searchRecords = vi.fn<(q: string, opts?: { types?: string[] }) => Promise<SearchAnswer>>();
vi.mock("@/lib/search-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/search-api")>()),
  searchRecords: (q: string, opts?: { types?: string[] }) => searchRecords(q, opts),
}));

/** The NAV shape the shell hands the palette. Two areas the fixtures below can
 *  grant independently. */
const GROUPS = [
  { heading: "Overview", items: [{ to: "/", label: "Control Tower" }] },
  {
    heading: "Finance",
    items: [
      { to: "/finance/invoices", label: "Invoices" },
      { to: "/finance/receivables", label: "Receivables" },
    ],
  },
  {
    heading: "Warehouse",
    items: [{ to: "/wms/inventory", label: "Inventory" }],
  },
];

function shell(modules: string[], resolved = true): ShellContextValue {
  const access: NavAccess = { modules, groups: [], byGroup: {}, isCeo: false, version: "v" };
  return {
    access,
    ready: resolved,
    resolved,
    prefs: EMPTY_SHELL_PREFS,
    setPrefs: () => {},
    grantNotice: null,
    dismissGrantNotice: () => {},
  };
}

function Where() {
  const l = useLocation();
  return <output data-testid="where">{`${l.pathname}${l.search}`}</output>;
}

function open(value: ShellContextValue, onClose = () => {}) {
  return render(
    <MemoryRouter>
      <ShellContext.Provider value={value}>
        <CommandPalette open groups={GROUPS} onClose={onClose} />
        <Where />
      </ShellContext.Provider>
    </MemoryRouter>,
  );
}

const dialog = () => screen.getByRole("dialog");
const labels = () =>
  within(dialog())
    .getAllByRole("button")
    .map((b) => b.textContent?.trim() ?? "");
const type = (text: string) => userEvent.type(screen.getByRole("textbox"), text);
const group = (name: string) => within(dialog()).getByRole("group", { name });

const answer = (groups: SearchAnswer["groups"]): SearchAnswer => ({ q: "", hint: null, groups });
const hit = (over: Partial<SearchAnswer["groups"][number]["items"][number]> & { id: string; type: string; url: string }) => ({
  ref: null,
  title: null,
  title_fr: null,
  sub: null,
  status: null,
  amount: null,
  currency: null,
  date: null,
  ...over,
});

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = () => {};
  searchRecords.mockReset();
  searchRecords.mockResolvedValue(answer([]));
  localStorage.clear();
});

describe("the palette offers only what this user can open", () => {
  it("drops a curated jump into a module the user lacks", async () => {
    // The empty-query state. `/finance` and `/operations` are two of the five
    // curated shortcuts, and a warehouse role holds neither.
    open(shell(["MOD-33", "MOD-35"]));
    const shown = labels();
    expect(shown).not.toContain("Finance & Treasury");
    expect(shown).not.toContain("Operations");
    // …and keeps what they CAN open, rather than collapsing to nothing.
    expect(shown).toContain("Warehouse");
  });

  it("drops a typed page result into a module the user lacks", async () => {
    open(shell(["MOD-33", "MOD-35"]));
    await type("invoice");
    expect(within(dialog()).queryByText("Invoices")).toBeNull();
    expect(within(dialog()).queryByText("Supplier invoices")).toBeNull();
    // Once the record search has answered (with nothing), the palette says so.
    expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument();
  });

  it("keeps a typed page result the user CAN open", async () => {
    open(shell(["MOD-35"]));
    await type("inventory");
    expect(within(group("Pages")).getByText("Inventory")).toBeInTheDocument();
  });

  it("drops an ACTION whose destination is closed", async () => {
    // "New invoice" and "File a tax return" are hard-coded routes into Finance.
    open(shell(["MOD-33", "MOD-35"]));
    const shown = labels();
    expect(shown).not.toContain("New invoice");
    expect(shown).not.toContain("File a tax return");
    expect(shown).not.toContain("New operations file");
  });

  it("keeps an action whose destination is open", async () => {
    open(shell(["MOD-51"]));
    expect(labels()).toContain("New invoice");
  });

  it("keeps 'Ask Praxis AI…', which is not a route at all", async () => {
    // It opens a panel, and it is gated by the TENANT's AI flag rather than by
    // a module. A route filter it does not participate in must not remove it.
    open(shell([]));
    expect(labels()).toContain("Ask Praxis AI…");
  });

  it("gives a CEO with no grant rows everything, because rbac.js does", async () => {
    const value = shell([]);
    open({ ...value, access: { ...value.access, isCeo: true } });
    expect(labels()).toContain("Finance & Treasury");
  });

  it("FILTERS NOTHING while the permissions read is unresolved", async () => {
    open(shell([], false));
    const shown = labels();
    expect(shown).toContain("Finance & Treasury");
    expect(shown).toContain("New invoice");
  });

  it("is axe-clean once filtered", async () => {
    const { container } = open(shell(["MOD-33", "MOD-35"]));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("pages, in real words (meeting 6, G5)", () => {
  it.each(["quotation", "quotations", "devis", "cotation", "quote", "offre"])("“%s” finds Quotations", async (word) => {
    open(shell(["MOD-27"]));
    await type(word);
    expect(within(group("Pages")).getByText("Quotations")).toBeInTheDocument();
  });

  it("tolerates a one-letter typo", async () => {
    open(shell(["MOD-27"]));
    await type("quotaion");
    expect(within(group("Pages")).getByText("Quotations")).toBeInTheDocument();
  });

  it("ignores accents and case, and reads the French title", async () => {
    open(shell(["MOD-70"]));
    await type("PARAMETRES commerciaux");
    expect(within(group("Pages")).getByText("Commercial Settings")).toBeInTheDocument();
  });

  it("finds a hub by its area name", async () => {
    open(shell(["MOD-27"]));
    await type("ventes");
    expect(within(group("Pages")).getByText("Sales & CRM")).toBeInTheDocument();
  });

  it("never offers Quotations to someone without its grant, whatever word they use", async () => {
    open(shell(["MOD-35"]));
    await type("devis");
    expect(within(dialog()).queryByText("Quotations")).toBeNull();
  });
});

describe("records, from /search", () => {
  it("shows a client by name and a quotation by number, grouped by type, and opens the record", async () => {
    searchRecords.mockResolvedValue(
      answer([
        { type: "quotation", module: "MOD-27", label: { en: "Quotations", fr: "Devis" }, route: "/sales/quotations",
          items: [hit({ id: "q1", type: "quotation", ref: "QUO-2026-0007", title: "QUO-2026-0007", sub: "Acme Trading", status: "SENT", amount: 1100000, currency: "XAF", url: "/sales/quotations?focus=q1" })] },
        { type: "client", module: "MOD-03", label: { en: "Clients", fr: "Clients" }, route: "/master/clients",
          items: [hit({ id: "c1", type: "client", ref: "CL-0001", title: "Acme Trading", url: "/master/clients?focus=c1" })] },
      ]),
    );
    open(shell(["MOD-03", "MOD-27"]));
    await type("acme");
    await waitFor(() => expect(group("Clients")).toBeInTheDocument());
    expect(within(group("Clients")).getByText("Acme Trading")).toBeInTheDocument();
    expect(within(group("Quotations")).getByText("QUO-2026-0007")).toBeInTheDocument();
    // Clients come before quotations, whatever order the server answered in.
    const headings = within(dialog()).getAllByRole("group").map((g) => g.getAttribute("aria-label"));
    expect(headings.indexOf("Clients")).toBeLessThan(headings.indexOf("Quotations"));
    fireEvent.click(within(group("Quotations")).getByText("QUO-2026-0007"));
    expect(screen.getByTestId("where").textContent).toBe("/sales/quotations?focus=q1");
  });

  it("drops a record whose address the person cannot open, even if a response carries it", async () => {
    searchRecords.mockResolvedValue(
      answer([
        { type: "invoice", module: "MOD-51", label: { en: "Invoices", fr: "Factures" }, route: "/finance/invoices",
          items: [hit({ id: "i1", type: "invoice", ref: "INV-0042", title: "INV-0042", url: "/finance/invoices?focus=i1" })] },
      ]),
    );
    open(shell(["MOD-03"]));
    await type("0042");
    await waitFor(() => expect(searchRecords).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(/Searching records/)).toBeNull());
    expect(within(dialog()).queryByText("INV-0042")).toBeNull();
  });

  it("asks nothing for a single letter — the API would refuse it", async () => {
    open(shell(["MOD-03"]));
    await type("a");
    await new Promise((r) => setTimeout(r, 250));
    expect(searchRecords).not.toHaveBeenCalled();
  });

  it("says so when records cannot be searched, and still answers with pages", async () => {
    searchRecords.mockRejectedValue(new Error("offline"));
    open(shell(["MOD-27"]));
    await type("devis");
    await screen.findByText(/Records could not be searched/);
    expect(within(group("Pages")).getByText("Quotations")).toBeInTheDocument();
  });
});

describe("tabs — the X tab of a record", () => {
  it("finds a 360 tab by name, then asks which record and opens it on that tab", async () => {
    searchRecords.mockImplementation(async (_q, opts) =>
      opts?.types?.includes("client")
        ? answer([{ type: "client", module: "MOD-03", label: { en: "Clients", fr: "Clients" }, route: "/master/clients",
            items: [hit({ id: "c1", type: "client", title: "Acme Trading", url: "/master/clients?focus=c1" })] }])
        : answer([]),
    );
    open(shell(["MOD-03"]));
    await type("contacts");
    const row = within(group("Tabs")).getByText(/Clients .*› Contacts/);
    fireEvent.click(row);
    // The question is asked in the input, and the search is narrowed to the tab's records.
    expect(screen.getByRole("textbox").getAttribute("placeholder")).toMatch(/Which client/);
    await type("acme");
    await waitFor(() => expect(searchRecords).toHaveBeenLastCalledWith("acme", expect.objectContaining({ types: ["client", "supplier"] })));
    fireEvent.click(await within(dialog()).findByText("Acme Trading"));
    expect(screen.getByTestId("where").textContent).toBe("/master/clients?focus=c1&tab=Contacts");
  });

  it("does not offer a tab of a record type the person cannot open", async () => {
    open(shell(["MOD-35"]));
    await type("money");
    expect(within(dialog()).queryByRole("group", { name: "Tabs" })).toBeNull();
  });
});

describe("actions and recents", () => {
  it("asks Praxis AI with what was typed", async () => {
    const heard: unknown[] = [];
    const on = (e: Event) => heard.push((e as CustomEvent).detail);
    window.addEventListener("praxis:open-copilot", on);
    open(shell([]));
    await type("overdue invoices this month");
    fireEvent.click(within(group("Actions")).getByText(/Ask Praxis AI about/));
    window.removeEventListener("praxis:open-copilot", on);
    expect(heard).toEqual([{ prompt: "overdue invoices this month" }]);
  });

  it("remembers what was searched and offers it next time", async () => {
    const first = open(shell(["MOD-27"]));
    await type("devis");
    fireEvent.click(within(group("Pages")).getByText("Quotations"));
    first.unmount();
    open(shell(["MOD-27"]));
    expect(within(group("Recent searches")).getByText("devis")).toBeInTheDocument();
  });
});
