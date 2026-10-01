/**
 * Meeting 6 (29 Sep 2026), register 3.9 — an empty LIVE does not look broken.
 *
 *   · LIVE with no operations file: the Control Tower shows "Getting started"
 *     — six steps, each with its live state and a link to its screen — in
 *     place of the map and the band of zeros.
 *   · TEST never asks for it, and never shows it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";

import { apiClientMock, authContextMock, fixtures, renderScreen } from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());
let env = "live";
vi.mock("@/lib/token-store", async (orig) => {
  const mod = await orig<typeof import("@/lib/token-store")>();
  return { ...mod, tokenStore: { ...mod.tokenStore, getEnv: () => env } };
});

import { GettingStartedPanel, type GettingStarted } from "./components/getting-started";
import { DashboardPage } from "./index";

const CHECKLIST: GettingStarted = {
  show: true,
  env: "live",
  done: 2,
  total: 6,
  items: [
    { key: "client", label: "Create a client", to: "/master/clients", done: true, count: 1 },
    { key: "portal", label: "Invite them to the portal", to: "/settings/portal-access", done: false, count: 0 },
    { key: "file", label: "Open the first operations file", to: "/operations/files", done: false, count: 0 },
    { key: "treasury", label: "Set the treasury accounts", to: "/master/treasury-accounts", done: true, count: 2 },
    { key: "mailbox", label: "Connect the mailbox", to: "/comms/setup", done: false, count: 0 },
    { key: "team", label: "Invite the team", to: "/security/users", done: false, count: 0 },
  ],
};

beforeEach(() => {
  env = "live";
  fixtures.current = {};
});

describe("Getting started", () => {
  it("lists the six steps, each with its state and its screen", () => {
    renderScreen(<GettingStartedPanel data={CHECKLIST} />);
    const list = screen.getByRole("list");
    const links = within(list).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/master/clients",
      "/settings/portal-access",
      "/operations/files",
      "/master/treasury-accounts",
      "/comms/setup",
      "/security/users",
    ]);
    expect(within(links[0]).getAllByText("Done").length).toBeGreaterThan(0);
    expect(within(links[2]).getAllByText("To do").length).toBeGreaterThan(0);
    expect(screen.getByText("2/6 done")).toBeInTheDocument();
  });

  it("an empty LIVE tower shows it instead of the band of zeros", async () => {
    renderScreen(<DashboardPage />, {
      routes: { "/dashboard/getting-started": CHECKLIST, "/dashboard/control-tower": {} },
    });
    expect(await screen.findByRole("heading", { name: "Getting started" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Meeting view" })).not.toBeInTheDocument();
  });

  it("TEST never shows it", async () => {
    env = "sandbox";
    renderScreen(<DashboardPage />, {
      routes: { "/dashboard/getting-started": CHECKLIST, "/dashboard/control-tower": {} },
    });
    expect(await screen.findByRole("button", { name: "Meeting view" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Getting started" })).not.toBeInTheDocument();
  });
});
