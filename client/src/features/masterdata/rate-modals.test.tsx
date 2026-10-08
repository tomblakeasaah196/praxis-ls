/**
 * Meeting 5 (21 Sep 2026) — changing what a dictionary line costs.
 *
 *   · "Apply to all shipping lines" opens with EVERY carrier ticked; the person
 *     unticks the exceptions, and only the carriers left ticked are sent.
 *   · A rate is in the tenant's base currency unless someone deliberately picks
 *     another — the currency is a statement, not a free box on every line.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { apiClientMock, authContextMock, renderScreen } from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

const applyAll = vi.fn();
const supersede = vi.fn();
vi.mock("@/lib/masterdata-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/masterdata-api")>()),
  applyDictRateToProviders: (...a: unknown[]) => applyAll(...a),
  supersedeDictRate: (...a: unknown[]) => supersede(...a),
}));

import { ApplyToCarriersModal, SetRateModal } from "./rate-modals";

const CURRENCIES = [
  { code: "XAF", name: "CFA franc", is_base: true, is_active: true },
  { code: "EUR", name: "Euro", is_base: false, is_active: true },
];
const carrier = (id: string, name: string) => ({
  rate_provider_id: id,
  kind: "SHIPPING_LINE" as const,
  code: name.toUpperCase(),
  name,
  is_active: true,
});
const CARRIERS = [carrier("p1", "Maersk"), carrier("p2", "MSC"), carrier("p3", "CMA CGM")];

beforeEach(() => {
  applyAll.mockReset().mockResolvedValue({ applied: 2, evolution: {} });
  supersede.mockReset().mockResolvedValue({});
});

describe("Apply one rate to all carriers", () => {
  it("starts with every carrier ticked and sends only the ones left ticked", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderScreen(
      <ApplyToCarriersModal
        itemId="i1"
        kindLabel="sea carriers"
        providers={CARRIERS as never}
        onClose={() => {}}
        onSaved={onSaved}
      />,
      { routes: { "/currencies": CURRENCIES } },
    );

    for (const name of ["Maersk", "MSC", "CMA CGM"])
      expect(screen.getByRole("checkbox", { name })).toBeChecked();

    await user.click(screen.getByRole("checkbox", { name: "MSC" }));
    await user.type(screen.getByRole("spinbutton"), "72700");
    await user.click(screen.getByRole("button", { name: /apply to 2 carriers/i }));

    expect(applyAll).toHaveBeenCalledTimes(1);
    const [itemId, body] = applyAll.mock.calls[0];
    expect(itemId).toBe("i1");
    expect(body.rate_provider_ids).toEqual(["p1", "p3"]);
    expect(body.rate).toBe(72700);
    // No currency chosen → the server applies the base currency.
    expect(body.currency).toBeUndefined();
    expect(onSaved).toHaveBeenCalledWith(2);
  });

  it("cannot be saved with every carrier unticked", async () => {
    const user = userEvent.setup();
    renderScreen(
      <ApplyToCarriersModal
        itemId="i1"
        kindLabel="sea carriers"
        providers={CARRIERS as never}
        onClose={() => {}}
        onSaved={() => {}}
      />,
      { routes: { "/currencies": CURRENCIES } },
    );
    await user.click(screen.getByRole("checkbox", { name: "All" }));
    await user.type(screen.getByRole("spinbutton"), "10");
    expect(screen.getByRole("button", { name: /apply to 0 carriers/i })).toBeDisabled();
  });
});

describe("Set rate", () => {
  it("shows the base currency as a fact and sends none unless another is picked", async () => {
    const user = userEvent.setup();
    renderScreen(
      <SetRateModal
        itemId="i1"
        providerLabel="Standard Rate"
        providerId={null}
        containerTypeId={null}
        containerTypeLabel={null}
        current={null}
        onClose={() => {}}
        onSaved={() => {}}
      />,
      { routes: { "/currencies": CURRENCIES } },
    );
    expect(await screen.findByText("XAF")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /other currency/i })).toBeInTheDocument();

    await user.type(screen.getByRole("spinbutton"), "20000");
    await user.click(screen.getByRole("button", { name: /save rate/i }));
    expect(supersede).toHaveBeenCalledTimes(1);
    const [, body] = supersede.mock.calls[0];
    expect(body).toMatchObject({ rate: 20000, rate_provider_id: null, container_type_ref_id: null });
    expect(body.currency).toBeUndefined();
  });
});

/**
 * Meeting 6 (29 Sep 2026), F4 — a rate says whether it includes VAT.
 *
 *   · "Price includes VAT" is off by default; ticked, the dialog shows what will
 *     be stored ("72,700 TTC = 60,964 HT at 19.25 %") and sends the figure as
 *     typed with the flag — the server divides with the same shared function.
 *   · It is not offered on a débours, which is always HT.
 */
describe("Price includes VAT (F4)", () => {
  const VAT = {
    dictionary_item_id: "i1",
    is_disbursement: false,
    offered: true,
    vat_rate_percent: 19.25,
    tax_code_id: "tc-std",
    tax_code: "TVA_STD",
    source: "standard",
  };

  it("is off by default; ticked, it previews TTC = HT and sends the flag", async () => {
    const user = userEvent.setup();
    renderScreen(
      <SetRateModal
        itemId="i1"
        providerLabel="Standard Rate"
        providerId={null}
        containerTypeId={null}
        containerTypeLabel={null}
        current={null}
        onClose={() => {}}
        onSaved={() => {}}
      />,
      { routes: { "/currencies": CURRENCIES, "/expense-rates/vat-basis": VAT } },
    );
    const box = await screen.findByRole("checkbox", { name: "Price includes VAT" });
    expect(box).not.toBeChecked();

    await user.type(screen.getByRole("spinbutton"), "72700");
    await user.click(box);
    expect(await screen.findByText("72,700 TTC = 60,964 HT at 19.25 %")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /save rate/i }));
    const [, body] = supersede.mock.calls[0];
    expect(body).toMatchObject({ rate: 72700, price_includes_vat: true });
  });

  it("re-opens a VAT-inclusive rate as it was typed, and shows both figures", async () => {
    renderScreen(
      <SetRateModal
        itemId="i1"
        providerLabel="Standard Rate"
        providerId={null}
        containerTypeId={null}
        containerTypeLabel={null}
        current={{
          expense_rate_id: "r1",
          rate: 60964.36,
          currency: "XAF",
          effective_from: "2026-01-01",
          in_force: true,
          superseded: false,
          price_includes_vat: true,
          rate_ttc: "72700.00",
          vat_rate_percent: "19.2500",
        }}
        onClose={() => {}}
        onSaved={() => {}}
      />,
      { routes: { "/currencies": CURRENCIES, "/expense-rates/vat-basis": VAT } },
    );
    expect(await screen.findByRole("checkbox", { name: "Price includes VAT" })).toBeChecked();
    expect(screen.getByRole("spinbutton")).toHaveValue(72700);
    expect(screen.getAllByText("72,700 TTC = 60,964 HT at 19.25 %").length).toBeGreaterThan(0);
  });

  it("is not offered on a débours", async () => {
    renderScreen(
      <SetRateModal
        itemId="d1"
        providerLabel="Standard Rate"
        providerId={null}
        containerTypeId={null}
        containerTypeLabel={null}
        current={null}
        onClose={() => {}}
        onSaved={() => {}}
      />,
      {
        routes: {
          "/currencies": CURRENCIES,
          "/expense-rates/vat-basis": { ...VAT, dictionary_item_id: "d1", is_disbursement: true, offered: false },
        },
      },
    );
    expect(await screen.findByText("XAF")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("checkbox", { name: "Price includes VAT" })).not.toBeInTheDocument();
  });
});
