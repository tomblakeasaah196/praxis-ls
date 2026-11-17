/**
 * AccessLink, HubCrumb and the hub tab strip: a destination is offered only to
 * someone who can open it.
 *
 * These are the three shared pieces every screen leans on. The per-screen
 * links are held by `npm run check:access`; what that gate cannot see is
 * whether the component it trusts actually asks, so that is what is pinned
 * here, against the real shell context rather than a stub of `canOpen`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import * as React from "react";
import type { NavAccess } from "@/lib/nav-access";
import { ShellContext } from "@/app/layout/shell-context";
import { EMPTY_SHELL_PREFS } from "@/lib/preferences";
import { AccessLink } from "./access-link";
import { HubCrumb, TabbedHub } from "@/components/tabbed-hub";
import { hubTabs } from "@/app/layout/areas";

const access = (modules: string[], isCeo = false): NavAccess => ({
  modules,
  groups: [],
  byGroup: {},
  isCeo,
  version: modules.join("|"),
});

/** The shell, answering for one role. `resolved: false` is a first sign-in
 *  before `/permissions/mine` has come back. */
function As({
  modules,
  resolved = true,
  at = "/",
  children,
}: {
  modules: string[];
  resolved?: boolean;
  at?: string;
  children: React.ReactNode;
}) {
  return (
    <MemoryRouter initialEntries={[at]}>
      <ShellContext.Provider
        value={{
          access: access(modules),
          ready: true,
          resolved,
          prefs: EMPTY_SHELL_PREFS,
          setPrefs: () => {},
          grantNotice: null,
          dismissGrantNotice: () => {},
        }}
      >
        {children}
      </ShellContext.Provider>
    </MemoryRouter>
  );
}

beforeEach(() => vi.clearAllMocks());

describe("AccessLink", () => {
  it("draws the link for someone who can open it", () => {
    render(
      <As modules={["MOD-03"]}>
        <AccessLink to="/master/clients">Open client</AccessLink>
      </As>,
    );
    expect(screen.getByRole("link", { name: "Open client" })).toHaveAttribute("href", "/master/clients");
  });

  it("DRAWS NOTHING for someone who cannot: an action nobody can take is not offered", () => {
    const { container } = render(
      <As modules={["MOD-27"]}>
        <AccessLink to="/master/clients">Open client</AccessLink>
      </As>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the WORDS when they are data, and only drops the link", () => {
    // A file reference or a client's name is a fact the reader still needs.
    render(
      <As modules={["MOD-27"]}>
        <AccessLink to="/operations/files/abc" whenDenied="text">
          SLAS-2026-0042
        </AccessLink>
      </As>,
    );
    expect(screen.getByText("SLAS-2026-0042")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("asks about the PATH, so a query string or a record id does not open a door", () => {
    const { container } = render(
      <As modules={["MOD-27"]}>
        <AccessLink to="/master/clients?focus=c-1">Open client</AccessLink>
      </As>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers everything while access is still unknown, so nothing flashes away and back", () => {
    render(
      <As modules={[]} resolved={false}>
        <AccessLink to="/master/clients">Open client</AccessLink>
      </As>,
    );
    expect(screen.getByRole("link", { name: "Open client" })).toBeInTheDocument();
  });
});

describe("the hub breadcrumb", () => {
  it("names the area for everyone, and links it only for someone who can open it", () => {
    // A Quotations screen sits under Sales. A costing officer can read the
    // first without the second, and used to be offered a crumb that refused.
    const { unmount } = render(
      <As modules={["MOD-27"]}>
        <HubCrumb area="Finance & Treasury" to="/finance" />
      </As>,
    );
    expect(screen.getByText(/Finance & Treasury/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Finance & Treasury" })).toBeNull();
    unmount();

    render(
      <As modules={["MOD-51"]}>
        <HubCrumb area="Finance & Treasury" to="/finance" />
      </As>,
    );
    expect(screen.getByRole("link", { name: "Finance & Treasury" })).toBeInTheDocument();
  });
});

describe("a hub shows only the tabs this person can open", () => {
  const Page = (name: string) => () => <p>{name} screen</p>;
  const tabs = hubTabs("/wms", {
    locations: Page("Locations"),
    inventory: Page("Inventory"),
    inbound: Page("Inbound"),
    outbound: Page("Outbound"),
  });
  // What gates each of those sections, read off the registry rather than
  // typed here, so the test follows the product.
  const moduleOf = async (route: string) => {
    const { moduleForPath } = await import("@/lib/route-access");
    return moduleForPath(route) as string;
  };
  const hub = (modules: string[], at = "/wms") => (
    <As modules={modules} at={at}>
      <Routes>
        <Route path="/wms" element={<TabbedHub eyebrow="Warehouse" basePath="/wms" tabs={tabs} inPlace inlineTabs />} />
        <Route path="/wms/:section" element={<TabbedHub eyebrow="Warehouse" basePath="/wms" tabs={tabs} inPlace inlineTabs />} />
      </Routes>
    </As>
  );

  it("THE STRIP OFFERS ONLY WHAT THE ROLE HOLDS", async () => {
    const inventory = await moduleOf("/wms/inventory");
    const locations = await moduleOf("/wms/locations");
    // Only meaningful where the two sections are gated by different modules.
    expect(inventory).not.toBe(locations);
    render(hub([inventory]));
    const offered = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(offered).toContain("Inventory");
    expect(offered).not.toContain("Locations");
  });

  it("THE BARE HUB ADDRESS OPENS A TAB THE PERSON HOLDS, not the first one in the list", async () => {
    // /wms used to render Locations for everyone, whatever they held.
    const inventory = await moduleOf("/wms/inventory");
    render(hub([inventory]));
    expect(screen.getByText("Inventory screen")).toBeInTheDocument();
    expect(screen.queryByText("Locations screen")).toBeNull();
  });

  it("an in-place hub cannot be switched to a tab that is not offered", async () => {
    // Warehouse and Fleet switch tabs without changing the address, so the
    // route gate never looks again. The only defence is not drawing the tab.
    const inventory = await moduleOf("/wms/inventory");
    const inbound = await moduleOf("/wms/inbound");
    render(hub([inventory, inbound]));
    await userEvent.click(screen.getByRole("tab", { name: /Inbound/ }));
    expect(await screen.findByText("Inbound screen")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Locations/ })).toBeNull();
  });

  it("shows every tab while access is unknown, so a hub never opens empty", () => {
    render(
      <As modules={[]} resolved={false} at="/wms">
        <Routes>
          <Route path="/wms" element={<TabbedHub eyebrow="Warehouse" basePath="/wms" tabs={tabs} inPlace inlineTabs />} />
        </Routes>
      </As>,
    );
    expect(screen.getAllByRole("tab")).toHaveLength(4);
  });
});
