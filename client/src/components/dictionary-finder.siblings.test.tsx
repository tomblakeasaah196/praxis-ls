/**
 * One service, one row — meeting 6, owner decision F2.
 *
 * WHAT THESE PIN
 *   - "Gate-Pass Fee" is listed ONCE in the finder, though the catalogue holds
 *     it as two rows (our own cost, and "— Client Account" débours).
 *   - Picking it asks one plain question, preset from the document: on a
 *     client-billed document "Billed to the client at cost" is the suggestion.
 *   - Each answer hands back its own row: billed → the débours sibling, our own
 *     cost → the expense sibling.
 *   - A line whose mode contradicts its document is flagged with one sentence
 *     and a one-tap switch to the sibling that fits.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiClientMock,
  authContextMock,
  fixtures,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { DictionaryFinder } from "./dictionary-finder";

const G = "g-1";
const OWN = {
  dictionary_item_id: "e013",
  code: "#E013",
  label_en: "Gate-Pass Fee",
  label_fr: "Saisie du Ticket de Livraison",
  direction: "EXPENSE",
  category: "overhead",
  is_disbursement: false,
  sibling_group: G,
  mode: "own",
};
const BILLED = {
  dictionary_item_id: "d153",
  code: "#D153",
  label_en: "Gate-Pass Fee — Client Account",
  label_fr: "Saisie du Ticket de Livraison — Pour Compte Client",
  direction: "DISBURSEMENT",
  category: "disbursement",
  is_disbursement: true,
  sibling_group: G,
  mode: "billed",
};
const HIT = {
  ...BILLED,
  siblings: [BILLED, OWN],
  group_label_en: "Gate-Pass Fee",
  group_label_fr: "Saisie du Ticket de Livraison",
};

beforeEach(() => {
  fixtures.current = {};
});

async function openAndSearch(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Item" }));
  await user.type(screen.getByRole("textbox", { name: "Item" }), "gate");
}

describe("DictionaryFinder — siblings", () => {
  it("lists Gate-Pass Fee once and asks how it is charged, preset to billed on a client document", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    renderScreen(
      <DictionaryFinder label="Item" onPick={onPick} fulfilment="billed" />,
      { routes: { "/financial-dictionary/search": [HIT] } },
    );
    await openAndSearch(user);
    const rows = await screen.findAllByRole("option");
    const gate = rows.filter((r) => /Gate-Pass Fee/.test(r.textContent || ""));
    expect(gate).toHaveLength(1);
    expect(gate[0]).toHaveTextContent("Billed or own cost");
    expect(gate[0]).not.toHaveTextContent("Client Account");

    await user.click(gate[0]);
    expect(await screen.findByText("How is this charged on this file?")).toBeInTheDocument();
    const billed = screen.getByRole("button", { name: /Billed to the client at cost — débours, no VAT/ });
    expect(billed).toHaveTextContent("Suggested for this file");
    await user.click(billed);
    expect(onPick).toHaveBeenCalledWith("d153", "Gate-Pass Fee — Client Account", expect.objectContaining({ dictionary_item_id: "d153" }));
  });

  it("“Our own cost” hands back the expense sibling", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    renderScreen(<DictionaryFinder label="Item" onPick={onPick} fulfilment="billed" />, {
      routes: { "/financial-dictionary/search": [HIT] },
    });
    await openAndSearch(user);
    await user.click((await screen.findAllByRole("option")).find((r) => /Gate-Pass Fee/.test(r.textContent || ""))!);
    await user.click(await screen.findByRole("button", { name: /^Our own cost/ }));
    expect(onPick).toHaveBeenCalledWith("e013", "Gate-Pass Fee", expect.objectContaining({ dictionary_item_id: "e013" }));
  });

  it("flags our own cost on a client-billed line and switches it in one tap", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    renderScreen(
      <DictionaryFinder label="Item" value="e013" valueLabel="Gate-Pass Fee" onPick={onPick} fulfilment="billed" />,
      {
        routes: {
          "/financial-dictionary/siblings": {
            e013: { dictionary_item_id: "e013", direction: "EXPENSE", mode: "own", sibling_group: G, siblings: [BILLED, OWN] },
          },
        },
      },
    );
    expect(await screen.findByText(/This is our own cost, so it will not be re-billed/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Switch to: Billed to the client at cost/ }));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith("d153", "Gate-Pass Fee — Client Account", expect.anything()));
  });

  it("says nothing when the line agrees with its document", async () => {
    renderScreen(
      <DictionaryFinder label="Item" value="d153" valueLabel="Gate-Pass Fee — Client Account" onPick={vi.fn()} fulfilment="billed" />,
      {
        routes: {
          "/financial-dictionary/siblings": {
            d153: { dictionary_item_id: "d153", direction: "DISBURSEMENT", mode: "billed", sibling_group: G, siblings: [BILLED, OWN] },
          },
        },
      },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
