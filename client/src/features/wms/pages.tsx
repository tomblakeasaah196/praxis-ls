/** WMS (Phase 3) screens — read skeletons over the warehouse endpoints. */
import { ResourceList } from "@/components/resource-list";
import { HubCrumb } from "@/components/tabbed-hub";

export const LocationsPage = () => (
  <ResourceList eyebrow={<HubCrumb area="Warehouse" />}
    title="Locations"
    description="Warehouse slotting: zone / aisle / rack / bin / yard."
    endpoint="/locations"
    columns={[
      { key: "zone", label: "Zone" },
      { key: "aisle", label: "Aisle" },
      { key: "rack", label: "Rack" },
      { key: "bin", label: "Bin" },
      { key: "capacity_units", label: "Capacity" },
    ]}
  />
);

export const InventoryPage = () => (
  <ResourceList eyebrow={<HubCrumb area="Warehouse" />}
    title="Inventory"
    description="Stock on hand & state. Movements journal per item."
    endpoint="/inventory"
    columns={[
      { key: "sku", label: "SKU" },
      { key: "description", label: "Description" },
      { key: "qty_on_hand", label: "Qty" },
      { key: "uom", label: "UoM" },
      { key: "state", label: "State" },
      { key: "location_id", label: "Location" },
    ]}
  />
);

export const InboundPage = () => (
  <ResourceList eyebrow={<HubCrumb area="Warehouse" />}
    title="Inbound / GRN"
    description="Goods received & QA gate."
    endpoint="/inbound"
    columns={[
      { key: "dossier_id", label: "Dossier" },
      { key: "qa_status", label: "QA" },
      { key: "putaway_location", label: "Putaway" },
      { key: "created_at", label: "When" },
    ]}
  />
);

export const OutboundPage = () => (
  <ResourceList eyebrow={<HubCrumb area="Warehouse" />}
    title="Outbound"
    description="Pick / pack / dispatch orders."
    endpoint="/outbound"
    columns={[
      { key: "client_id", label: "Client" },
      { key: "status", label: "Status" },
      { key: "dispatched_at", label: "Dispatched" },
      { key: "created_at", label: "Created" },
    ]}
  />
);

export const EquipmentPage = () => (
  <ResourceList eyebrow={<HubCrumb area="Warehouse" />}
    title="Equipment"
    description="Handling equipment: forklifts, reach-stackers."
    endpoint="/equipment"
    columns={[
      { key: "label", label: "Label" },
      { key: "status", label: "Status" },
      { key: "assigned_to", label: "Assigned to" },
      { key: "location_id", label: "Location" },
    ]}
  />
);

export const CycleCountsPage = () => (
  <ResourceList eyebrow={<HubCrumb area="Warehouse" />}
    title="Cycle counts"
    description="Physical counts & discrepancies."
    endpoint="/cycle-counts"
    columns={[
      { key: "location_id", label: "Location" },
      { key: "counted_by", label: "Counted by" },
      { key: "discrepancy", label: "Discrepancy" },
      { key: "created_at", label: "When" },
    ]}
  />
);
