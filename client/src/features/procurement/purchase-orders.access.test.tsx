/**
 * A ROW OFFERS ONLY THE MOVES THIS ROLE MAY MAKE.
 *
 * A purchase order's status route asks for a different grant per target state:
 * issuing is `edit`, approving is `approve`, paying is `approve`, and asking
 * for an unlock is `edit` while granting one is `approve`. The list drew every
 * button for every role, so a clerk was shown Approve and a read-only role was
 * shown Edit (access audit, 17 Nov 2026).
 *
 * The map the screen reads is the one the route mounts (`@praxis/shared`,
 * pinned by tests/unit/transition-actions.test.js). This pins that the rows
 * actually use it.
 */
import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { apiClientMock, authContextMock, renderScreen } from "@/test/screen-harness";
import { ShellContext } from "@/app/layout/shell-context";
import { EMPTY_SHELL_PREFS } from "@/lib/preferences";

// Hoisted above every import below, which is why the screen is imported after.
vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { PurchaseOrdersPage } from "./purchase-orders";

const ORDERS = [
  { po_id: "po-draft", ref: "PO-DRAFT", status: "DRAFT", total_ttc: 100, currency: "XAF" },
  { po_id: "po-issued", ref: "PO-ISSUED", status: "ISSUED_LOCKED", total_ttc: 100, currency: "XAF" },
  { po_id: "po-approved", ref: "PO-APPROVED", status: "APPROVED_LOCKED", total_ttc: 100, currency: "XAF" },
  { po_id: "po-asked", ref: "PO-ASKED", status: "UNLOCK_REQUESTED", total_ttc: 100, currency: "XAF" },
];

function open(actions: string[] | "ceo" | "unknown") {
  return renderScreen(
    <ShellContext.Provider
      value={{
        access: {
          modules: ["MOD-60"],
          groups: [],
          byGroup: {},
          isCeo: actions === "ceo",
          version: "v",
          ...(Array.isArray(actions) ? { actions: { "MOD-60": actions } } : {}),
        },
        ready: true,
        resolved: true,
        prefs: EMPTY_SHELL_PREFS,
        setPrefs: () => {},
        grantNotice: null,
        dismissGrantNotice: () => {},
      }}
    >
      <PurchaseOrdersPage />
    </ShellContext.Provider>,
    { path: "/procurement/purchase-orders", routes: { "/purchase-orders": ORDERS } },
  );
}

/** The buttons drawn on one order's row, by name. */
async function buttonsOn(ref: string) {
  const cell = (await screen.findAllByText(ref))[0];
  const row = cell.closest("tr") ?? cell.closest("li") ?? cell.closest("[role=row]");
  if (!row) throw new Error(`no row for ${ref}`);
  return within(row as HTMLElement)
    .queryAllByRole("button")
    .map((b) => b.textContent?.trim() || "");
}

describe("Purchase orders: row actions follow the grant each move needs", () => {
  it("a role that can only read sees no move at all", async () => {
    open([]);
    expect(await buttonsOn("PO-DRAFT")).not.toEqual(expect.arrayContaining(["Edit"]));
    expect(await buttonsOn("PO-DRAFT")).not.toEqual(expect.arrayContaining(["Issue"]));
    expect(await buttonsOn("PO-ISSUED")).not.toEqual(expect.arrayContaining(["Approve"]));
    expect(await buttonsOn("PO-APPROVED")).not.toEqual(expect.arrayContaining(["Record payment"]));
    expect(await buttonsOn("PO-APPROVED")).not.toEqual(expect.arrayContaining(["Request unlock"]));
    expect(await buttonsOn("PO-ASKED")).not.toEqual(expect.arrayContaining(["Unlock"]));
  });

  it("A CLERK WITH `edit` MAY ISSUE AND ASK, AND IS NOT SHOWN THE DECISIONS", async () => {
    open(["edit"]);
    expect(await buttonsOn("PO-DRAFT")).toEqual(expect.arrayContaining(["Edit", "Issue"]));
    expect(await buttonsOn("PO-APPROVED")).toEqual(expect.arrayContaining(["Request unlock"]));
    // The decisions: approving, paying, and granting or refusing an unlock.
    expect(await buttonsOn("PO-ISSUED")).not.toEqual(expect.arrayContaining(["Approve"]));
    expect(await buttonsOn("PO-APPROVED")).not.toEqual(expect.arrayContaining(["Record payment"]));
    expect(await buttonsOn("PO-ASKED")).not.toEqual(expect.arrayContaining(["Unlock"]));
    expect(await buttonsOn("PO-ASKED")).not.toEqual(expect.arrayContaining(["Deny"]));
  });

  it("an approver without `edit` decides, and is not shown the clerk's moves", async () => {
    open(["approve"]);
    expect(await buttonsOn("PO-ISSUED")).toEqual(expect.arrayContaining(["Approve"]));
    expect(await buttonsOn("PO-APPROVED")).toEqual(expect.arrayContaining(["Record payment"]));
    expect(await buttonsOn("PO-ASKED")).toEqual(expect.arrayContaining(["Unlock", "Deny"]));
    expect(await buttonsOn("PO-DRAFT")).not.toEqual(expect.arrayContaining(["Issue"]));
    expect(await buttonsOn("PO-APPROVED")).not.toEqual(expect.arrayContaining(["Request unlock"]));
  });

  it("the CEO is offered everything", async () => {
    open("ceo");
    expect(await buttonsOn("PO-DRAFT")).toEqual(expect.arrayContaining(["Edit", "Issue"]));
    expect(await buttonsOn("PO-ISSUED")).toEqual(expect.arrayContaining(["Approve"]));
    expect(await buttonsOn("PO-ASKED")).toEqual(expect.arrayContaining(["Unlock", "Deny"]));
  });

  it("everything is offered when the server did not say", async () => {
    open("unknown");
    expect(await buttonsOn("PO-DRAFT")).toEqual(expect.arrayContaining(["Edit", "Issue"]));
    expect(await buttonsOn("PO-ISSUED")).toEqual(expect.arrayContaining(["Approve"]));
    expect(await buttonsOn("PO-APPROVED")).toEqual(
      expect.arrayContaining(["Record payment", "Request unlock"]),
    );
  });
});
