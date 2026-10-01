/**
 * Meeting 6 (29 Sep 2026), register 3.6 — discarding a draft client.
 *
 *   · A DRAFT with no history offers "Discard draft"; the confirm is
 *     destructive, names the outcome, and only its own button deletes.
 *   · A DRAFT with history says "Deactivate instead" — no delete is offered.
 *   · Without the client master's `delete` right (403), nothing renders.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { apiClientMock, authContextMock, fixtures, renderScreen } from "@/test/screen-harness";

const deletes: string[] = [];
vi.mock("@/lib/api-client", async () => {
  const base = await apiClientMock();
  return {
    ...base,
    tenant: (path: string, init?: { method?: string }) => {
      if (init?.method === "DELETE") {
        deletes.push(path);
        return Promise.resolve({ discarded: true, client_id: "c1", removed: {} });
      }
      return base.tenant(path);
    },
  };
});
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { DiscardDraftClient } from "./client-discard";

const CHECK = { client_id: "c1", registration_status: "DRAFT", can_discard: true, reason: null, history: [] };

beforeEach(() => {
  deletes.length = 0;
  fixtures.current = {};
});

describe("Discard a draft client", () => {
  it("a draft with no history is discarded after a destructive confirm", async () => {
    const user = userEvent.setup();
    const onDeactivate = vi.fn();
    renderScreen(<DiscardDraftClient clientId="c1" name="CINECAM" onDeactivate={onDeactivate} />, {
      routes: { "/clients/c1/discard-check": CHECK },
    });
    await user.click(await screen.findByRole("button", { name: "Discard draft" }));

    expect(await screen.findByText("Discard this draft client?")).toBeInTheDocument();
    expect(screen.getByText(/“CINECAM” and its contacts, addresses, registrations, documents and portal access are deleted/)).toBeInTheDocument();
    // Keep it: nothing is deleted.
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(deletes).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Discard draft" }));
    await user.click(await screen.findByRole("button", { name: "Discard draft client" }));
    await vi.waitFor(() => expect(deletes).toEqual(["/clients/c1"]));
    expect(onDeactivate).not.toHaveBeenCalled();
  });

  it("a draft with history offers Deactivate instead, never a delete", async () => {
    const user = userEvent.setup();
    const onDeactivate = vi.fn();
    renderScreen(<DiscardDraftClient clientId="c1" name="Has a file" onDeactivate={onDeactivate} />, {
      routes: {
        "/clients/c1/discard-check": {
          ...CHECK,
          can_discard: false,
          reason: "HAS_HISTORY",
          history: [{ key: "operations_files", count: 1, label: "operations files" }],
        },
      },
    });
    const btn = await screen.findByRole("button", { name: "Deactivate instead" });
    expect(btn).toHaveAttribute("title", expect.stringContaining("1 operations files"));
    expect(screen.queryByRole("button", { name: "Discard draft" })).not.toBeInTheDocument();
    await user.click(btn);
    expect(onDeactivate).toHaveBeenCalledTimes(1);
    expect(deletes).toEqual([]);
  });

  it("renders nothing without the delete right", async () => {
    renderScreen(<DiscardDraftClient clientId="c1" name="X" onDeactivate={() => {}} />, {
      routes: { "/clients/c1/discard-check": { __error: { status: 403, message: "Forbidden", code: "FORBIDDEN" } } },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
