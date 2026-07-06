-- ============================================================================
-- TENANT DB — 0370 WMS depth (MOD-35,36,37) & Fleet depth (MOD-41,42,44,45).
-- WMS tracks CLIENT goods operationally (NOT class-3 stock, KB §5).
-- ============================================================================

-- MOD-35 Inventory control & tracking (operational, per owner/dossier) --------
CREATE TABLE inventory_item (
  inventory_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku              text,
  description      text NOT NULL,
  owner_client_id  uuid REFERENCES client_master(client_id),   -- client goods
  dossier_id       uuid REFERENCES dossier(dossier_id),
  location_id      uuid REFERENCES warehouse_location(location_id),
  qty_on_hand      numeric(18,4) NOT NULL DEFAULT 0,
  uom              text DEFAULT 'unit',
  state            text NOT NULL DEFAULT 'AVAILABLE' CHECK (state IN ('AVAILABLE','QA_HOLD','ALLOCATED','DISPATCHED','DAMAGED')),
  is_own_stock     boolean NOT NULL DEFAULT false,   -- true only for SmartLS consumables (class 3)
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE stock_movement (
  stock_movement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id uuid NOT NULL REFERENCES inventory_item(inventory_item_id) ON DELETE CASCADE,
  movement_kind    text NOT NULL CHECK (movement_kind IN ('INBOUND','PUTAWAY','PICK','PACK','DISPATCH','ADJUST','COUNT')),
  qty              numeric(18,4) NOT NULL,
  from_location    uuid REFERENCES warehouse_location(location_id),
  to_location      uuid REFERENCES warehouse_location(location_id),
  moved_by         uuid REFERENCES app_user(user_id),
  moved_at         timestamptz NOT NULL DEFAULT now()
);

-- MOD-36 Outbound operations (pick / pack / dispatch) ------------------------
CREATE TABLE outbound_order (
  outbound_order_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id       uuid REFERENCES dossier(dossier_id),
  client_id        uuid REFERENCES client_master(client_id),
  status           text NOT NULL DEFAULT 'CREATED'
                     CHECK (status IN ('CREATED','PICKING','PACKED','DISPATCHED','CANCELLED')),
  dispatched_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE outbound_line (
  outbound_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbound_order_id uuid NOT NULL REFERENCES outbound_order(outbound_order_id) ON DELETE CASCADE,
  inventory_item_id uuid REFERENCES inventory_item(inventory_item_id),
  qty              numeric(18,4) NOT NULL DEFAULT 1,
  picked           boolean NOT NULL DEFAULT false,
  packed           boolean NOT NULL DEFAULT false
);

-- MOD-37 Equipment handling (machinery allocation & status) ------------------
CREATE TABLE wms_equipment (
  wms_equipment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label            text NOT NULL,                    -- forklift, reach-stacker
  asset_id         uuid REFERENCES asset(asset_id),
  status           text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','IN_USE','MAINTENANCE','OUT_OF_SERVICE')),
  assigned_to      uuid REFERENCES app_user(user_id),
  location_id      uuid REFERENCES warehouse_location(location_id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- MOD-41 Maintenance & work orders (+ spare parts) ---------------------------
CREATE TABLE work_order (
  work_order_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id       uuid REFERENCES vehicle(vehicle_id),
  wms_equipment_id uuid REFERENCES wms_equipment(wms_equipment_id),
  kind             text NOT NULL CHECK (kind IN ('PREVENTIVE','CORRECTIVE')),
  description      text,
  status           text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','DONE','CANCELLED')),
  cost             numeric(18,2),
  dossier_id       uuid REFERENCES dossier(dossier_id),
  entry_id         uuid REFERENCES journal_entry(entry_id),
  opened_on        date NOT NULL DEFAULT CURRENT_DATE,
  closed_on        date,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE work_order_part (
  work_order_part_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id    uuid NOT NULL REFERENCES work_order(work_order_id) ON DELETE CASCADE,
  inventory_item_id uuid REFERENCES inventory_item(inventory_item_id),  -- own spare (class 3)
  label            text NOT NULL,
  qty              numeric(18,4) NOT NULL DEFAULT 1,
  unit_cost        numeric(18,2) NOT NULL DEFAULT 0
);

-- MOD-42 Dispatch & allocation (check-in/out logs) ---------------------------
CREATE TABLE fleet_dispatch (
  fleet_dispatch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id       uuid REFERENCES vehicle(vehicle_id),
  driver_employee_id uuid REFERENCES employee(employee_id),
  dossier_id       uuid REFERENCES dossier(dossier_id),
  check_out_at     timestamptz,
  check_in_at      timestamptz,
  odometer_out     integer, odometer_in integer,
  status           text NOT NULL DEFAULT 'ASSIGNED' CHECK (status IN ('ASSIGNED','OUT','RETURNED','CANCELLED')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- MOD-44 Driver management (licences & certifications + expiry) ---------------
CREATE TABLE driver_license (
  driver_license_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      uuid REFERENCES employee(employee_id),
  license_class    text NOT NULL,                    -- e.g. special low-bed carrier class
  license_number   text,
  issued_on        date, expires_on date,            -- expiry alerts via event engine
  certification    text,
  document_vault_id uuid REFERENCES document_vault(doc_id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- MOD-45 Incident & claim management -----------------------------------------
CREATE TABLE fleet_incident (
  fleet_incident_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id       uuid REFERENCES vehicle(vehicle_id),
  driver_employee_id uuid REFERENCES employee(employee_id),
  occurred_at      timestamptz,
  description      text,
  severity         text CHECK (severity IN ('MINOR','MAJOR','TOTAL')),
  status           text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','UNDER_REVIEW','CLOSED')),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE fleet_claim (
  fleet_claim_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_incident_id uuid REFERENCES fleet_incident(fleet_incident_id) ON DELETE CASCADE,
  insurer          text,
  claim_ref        text,
  amount_claimed   numeric(18,2),
  amount_settled   numeric(18,2),
  status           text NOT NULL DEFAULT 'FILED' CHECK (status IN ('FILED','ACKNOWLEDGED','SETTLED','REJECTED')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_inventory_updated BEFORE UPDATE ON inventory_item FOR EACH ROW EXECUTE FUNCTION set_updated_at();
