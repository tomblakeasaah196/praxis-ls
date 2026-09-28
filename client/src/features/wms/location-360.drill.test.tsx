/**
 * Warehouse location 360 → the list tiles open the rows they count, and the
 * pages those rows land on honour `?focus=`.
 *
 * Pinned: Items stored / On hand / Equipment are buttons over THIS location's
 * rows (the same arrays the tiles count — another slot's stock never appears);
 * On hand ranks by quantity; Capacity used is a percentage and stays inert; a
 * row lands on Inventory focused on the item, which opens it, and on the
 * Equipment board focused on the card, which is ringed.
 */
import { describe, it, expect, vi } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { LocationsPage } from "./location-360";
import { InventoryPage } from "./inventory";
import { EquipmentPage } from "./equipment";

const LOCATIONS = [
  {
    location_id: "loc1",
    zone: "A",
    aisle: "01",
    rack: "R1",
    bin: "B1",
    capacity_units: 100,
  },
  {
    location_id: "loc2",
    zone: "B",
    aisle: "02",
    rack: "R1",
    bin: "B2",
    capacity_units: 100,
  },
];
const INVENTORY = [
  {
    inventory_item_id: "it1",
    sku: "SKU-SMALL",
    description: "Shrink wrap",
    qty_on_hand: 4,
    uom: "roll",
    state: "AVAILABLE",
    location_id: "loc1",
  },
  {
    inventory_item_id: "it2",
    sku: "SKU-BIG",
    description: "Pallets",
    qty_on_hand: 40,
    uom: "pc",
    state: "AVAILABLE",
    location_id: "loc1",
  },
  {
    inventory_item_id: "it3",
    sku: "SKU-ELSEWHERE",
    description: "Cartons",
    qty_on_hand: 90,
    uom: "pc",
    state: "AVAILABLE",
    location_id: "loc2",
  },
];
const EQUIPMENT = [
  {
    wms_equipment_id: "eq1",
    label: "Forklift FL-01",
    status: "AVAILABLE",
    location_id: "loc1",
  },
];
const ROUTES = {
  "/locations": LOCATIONS,
  "/inventory": INVENTORY,
  "/equipment": EQUIPMENT,
  "/cycle-counts": [],
};

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

describe("Location 360 · drill-ins", () => {
  const mount = () =>
    renderScreen(
      <>
        <LocationsPage />
        <Where />
      </>,
      { routes: ROUTES, path: "/wms/locations" },
    );

  it("opens this slot's stock, largest quantity first for On hand, and leaves Capacity inert", async () => {
    mount();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /^open on hand$/i }),
    );
    const dialog = await screen.findByRole("dialog");
    const rows = within(dialog).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("SKU-BIG");
    expect(rows[1]).toHaveTextContent("SKU-SMALL");
    expect(within(dialog).queryByText("SKU-ELSEWHERE")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /open capacity used/i }),
    ).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: "SKU-BIG" }));
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent(
        "/wms/inventory?focus=it2",
      ),
    );
  });

  it("opens the equipment parked here and lands on its card", async () => {
    mount();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /^open equipment$/i }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Forklift FL-01" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent(
        "/wms/equipment?focus=eq1",
      ),
    );
  });
});

describe("the landing pages honour ?focus=", () => {
  it("Inventory opens the focused item", async () => {
    renderScreen(<InventoryPage />, {
      routes: ROUTES,
      path: "/wms/inventory?focus=it2",
    });
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getAllByText(/Pallets|SKU-BIG/).length,
    ).toBeGreaterThan(0);
  });

  it("Equipment rings the focused card", async () => {
    renderScreen(<EquipmentPage />, {
      routes: ROUTES,
      path: "/wms/equipment?focus=eq1",
    });
    const card = (await screen.findByText("Forklift FL-01")).closest(
      "[data-row-key]",
    );
    expect(card).toHaveAttribute("data-row-key", "eq1");
    expect(card?.className).toMatch(/ring-2/);
  });
});
