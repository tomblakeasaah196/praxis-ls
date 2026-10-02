/**
 * Meeting 6, owner decision G2 — families, all four:
 *
 *   · several lines moved at once (the ticked selection, "Move to family…");
 *   · changed one line at a time (the line's own family picker — the keyboard
 *     path for a drag);
 *   · dragged between families, and the move announced;
 *   · ordered per document, ↑ / ↓ on each family, "Default order" to reset —
 *     and the order on screen is the order `groupByFamily` gives the printer's
 *     twin.
 */
import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { groupByFamily } from "@/lib/client-headings";

const listDictRefs = vi.fn();
vi.mock("@/lib/masterdata-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/masterdata-api")>("@/lib/masterdata-api");
  return { ...actual, listDictRefs: (...a: unknown[]) => listDictRefs(...a) };
});

import { ClientFamilies, moveLines, useLineSelection, type FamilyLine } from "./client-families";

const REGISTRY = [
  { ref_id: "r1", kind: "CLIENT_HEADING", code: "CUSTOMS", name_fr: "Formalités Douanières", name_en: "Customs Formalities", sort_order: 10 },
  { ref_id: "r2", kind: "CLIENT_HEADING", code: "PORT", name_fr: "Frais Portuaires", name_en: "Port Charges", sort_order: 20 },
  { ref_id: "r3", kind: "CLIENT_HEADING", code: "TRANSPORT", name_fr: "Transport", name_en: "Transport", sort_order: 30 },
];
const AT = (code: string, en: string) => ({ client_heading_code: code, client_heading_en: en, client_heading_fr: en });

const START: FamilyLine[] = [
  { label: "Clearance fee", qty: 1, amount: 100, is_disbursement: false, ...AT("CUSTOMS", "Customs Formalities") },
  { label: "THC", qty: 1, amount: 200, is_disbursement: false, ...AT("PORT", "Port Charges") },
  { label: "Truck", qty: 1, amount: 300, is_disbursement: false, ...AT("TRANSPORT", "Transport") },
];

function Harness({ onOrder }: { onOrder?: (o: string[] | null) => void }) {
  const [lines, setLines] = React.useState(START);
  const [order, setOrder] = React.useState<string[] | null>(null);
  const selection = useLineSelection(lines.length);
  return (
    <>
      <ClientFamilies
        lines={lines}
        currency="XAF"
        readOnly={false}
        selection={selection}
        order={order}
        onOrder={(o) => {
          setOrder(o);
          onOrder?.(o);
        }}
        onHeading={(i, h) => setLines((ls) => moveLines(ls, [i], h))}
        onHeadingMany={(is, h) => setLines((ls) => moveLines(ls, is, h))}
      />
      <pre data-testid="state">{JSON.stringify(lines.map((l) => [l.label, l.client_heading ?? null]))}</pre>
    </>
  );
}

function renderHarness(props: { onOrder?: (o: string[] | null) => void } = {}) {
  listDictRefs.mockResolvedValue(REGISTRY);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
}
const state = () => JSON.parse(screen.getByTestId("state").textContent || "[]") as [string, string | null][];
const sectionTitles = () => screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);

describe("ClientFamilies — G2", () => {
  it("moves several ticked lines at once", async () => {
    const user = userEvent.setup();
    renderHarness();
    await waitFor(() => expect(sectionTitles()).toEqual(["Customs Formalities", "Port Charges", "Transport"]));
    await waitFor(() => expect(listDictRefs).toHaveBeenCalled());
    await user.click(screen.getByRole("checkbox", { name: "Tick Clearance fee" }));
    await user.click(screen.getByRole("checkbox", { name: "Tick THC" }));
    expect(screen.getByText("2 lines ticked")).toBeInTheDocument();
    const bar = screen.getByRole("group", { name: "Move the ticked lines" });
    await waitFor(() => expect(within(bar).getByRole("option", { name: "Transport" })).toBeInTheDocument());
    await user.selectOptions(within(bar).getByRole("combobox"), "TRANSPORT");
    await user.click(within(bar).getByRole("button", { name: /^Move$/ }));
    expect(state()).toEqual([["Clearance fee", "TRANSPORT"], ["THC", "TRANSPORT"], ["Truck", null]]);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("2 lines moved to Transport."));
  });

  it("changes one line from its own picker — the keyboard path", async () => {
    const user = userEvent.setup();
    renderHarness();
    const picker = screen.getByRole("combobox", { name: "Family — THC 2" });
    // The registry's headings arrive with the registry read.
    await waitFor(() => expect(within(picker).getByRole("option", { name: "Customs Formalities" })).toBeInTheDocument());
    await user.selectOptions(picker, "CUSTOMS");
    expect(state()[1]).toEqual(["THC", "CUSTOMS"]);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("“THC” moved to Customs Formalities."));
  });

  it("drags a line onto another family", async () => {
    renderHarness();
    await waitFor(() => expect(sectionTitles()).toHaveLength(3));
    const store: Record<string, string> = {};
    const dataTransfer = {
      setData: (k: string, v: string) => (store[k] = v),
      getData: (k: string) => store[k] || "",
      get types() {
        return Object.keys(store);
      },
      effectAllowed: "move",
    };
    const truck = screen.getByText("Truck").closest("li")!;
    fireEvent.dragStart(truck, { dataTransfer });
    const port = screen.getByRole("region", { name: "Port Charges" });
    fireEvent.dragOver(port, { dataTransfer });
    fireEvent.drop(port, { dataTransfer });
    expect(state()[2]).toEqual(["Truck", "PORT"]);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("“Truck” moved to Port Charges."));
  });

  it("orders the families for this document, and resets to the registry's", async () => {
    const user = userEvent.setup();
    const onOrder = vi.fn();
    renderHarness({ onOrder });
    await waitFor(() => expect(sectionTitles()).toEqual(["Customs Formalities", "Port Charges", "Transport"]));
    await user.click(screen.getByRole("button", { name: "Move Transport up" }));
    expect(onOrder).toHaveBeenLastCalledWith(["CUSTOMS", "TRANSPORT", "PORT"]);
    expect(sectionTitles()).toEqual(["Customs Formalities", "Transport", "Port Charges"]);
    await user.click(screen.getByRole("button", { name: "Move Transport up" }));
    expect(sectionTitles()).toEqual(["Transport", "Customs Formalities", "Port Charges"]);
    await user.click(screen.getByRole("button", { name: "Default order" }));
    expect(onOrder).toHaveBeenLastCalledWith(null);
    expect(sectionTitles()).toEqual(["Customs Formalities", "Port Charges", "Transport"]);
  });

  it("orders exactly as the printer's twin does", () => {
    const reg = REGISTRY.map((r) => ({ code: r.code, name_en: r.name_en, name_fr: r.name_fr, sort_order: r.sort_order }));
    expect(groupByFamily(START, reg, ["TRANSPORT"]).map((f) => f.heading.key)).toEqual(["TRANSPORT", "CUSTOMS", "PORT"]);
    expect(groupByFamily(START, reg).map((f) => f.heading.key)).toEqual(["CUSTOMS", "PORT", "TRANSPORT"]);
  });
});
