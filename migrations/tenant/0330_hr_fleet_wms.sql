-- ============================================================================
-- TENANT DB — 0330 HR/payroll (MOD-17), fleet (MOD-39–45), WMS (MOD-33–38)
-- Payroll config is DATA (allowance/component types, not hard-coded); the run is
-- a state machine that auto-posts the payroll journal (KB §8.11).
-- ============================================================================

-- Configurable allowance/bonus + payroll component types (not hard-coded) -----
CREATE TABLE payroll_component (
  component_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             citext UNIQUE NOT NULL,           -- 'VEHICLE_ALLOWANCE' | 'CNPS_PENSION_EE'
  name             text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('EARNING','DEDUCTION','EMPLOYER_CHARGE')),
  is_taxable       boolean NOT NULL DEFAULT true,
  tax_code_id      uuid REFERENCES tax_code(tax_code_id),
  coa_code         text REFERENCES chart_of_accounts(code),
  is_system        boolean NOT NULL DEFAULT false
);

CREATE TABLE payroll_run (
  payroll_run_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid REFERENCES corporate_entity(entity_id),
  period_code      text NOT NULL,                    -- '2026-01'
  status           text NOT NULL DEFAULT 'OPEN'
                     CHECK (status IN ('OPEN','COMPUTED','SUBMITTED','APPROVED','VALIDATED','DISBURSED','REJECTED')),
  config_snapshot  jsonb NOT NULL DEFAULT '{}'::jsonb,  -- rates in force at run time
  entry_id         uuid REFERENCES journal_entry(entry_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, period_code)
);
CREATE TABLE payroll_run_item (
  payroll_run_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id   uuid NOT NULL REFERENCES payroll_run(payroll_run_id) ON DELETE CASCADE,
  employee_id      uuid REFERENCES employee(employee_id),
  gross            numeric(18,2) NOT NULL DEFAULT 0,
  net_pay          numeric(18,2) NOT NULL DEFAULT 0,
  breakdown        jsonb NOT NULL DEFAULT '{}'::jsonb   -- per-component computed amounts
);

CREATE TABLE leave_request (
  leave_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      uuid REFERENCES employee(employee_id),
  kind             text,                             -- leave | salary_advance | mission
  starts_on        date, ends_on date,
  amount           numeric(18,2),                    -- salary advance -> 4211
  status           text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','REJECTED')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE attendance_log (
  attendance_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      uuid REFERENCES employee(employee_id),
  clock_in_at      timestamptz,
  clock_out_at     timestamptz,
  location         jsonb,                            -- captured GPS at clock-in
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Fleet (MOD-39–45) ---------------------------------------------------------
CREATE TABLE vehicle (
  vehicle_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid REFERENCES corporate_entity(entity_id),
  asset_id         uuid REFERENCES asset(asset_id),  -- links to COA 245 (KB §5 class 2)
  registration     text,
  category         text,                             -- low-bed | truck | company_car
  status           text NOT NULL DEFAULT 'ACTIVE',
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vehicle_compliance (
  compliance_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id       uuid REFERENCES vehicle(vehicle_id) ON DELETE CASCADE,
  kind             text,                             -- insurance | visite_technique
  expires_on       date,                             -- alert engine fires event before lapse
  document_vault_id uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE fuel_log (
  fuel_log_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id       uuid REFERENCES vehicle(vehicle_id),
  odometer         integer,
  litres           numeric(12,2),
  cost             numeric(18,2),
  dossier_id       uuid REFERENCES dossier(dossier_id),  -- fuel posts to 6053 tagged to dossier
  entry_id         uuid REFERENCES journal_entry(entry_id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- WMS (MOD-33–38) — client goods are NOT SmartLS stock (KB §5); tracked here
-- operationally, never in class 3.
CREATE TABLE warehouse_location (
  location_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone text, aisle text, rack text, bin text, yard text,
  capacity_units   numeric(12,2)
);
CREATE TABLE grn_inbound (
  grn_inbound_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id       uuid REFERENCES dossier(dossier_id),
  qa_status        text CHECK (qa_status IN ('HOLD','PASSED','REJECTED')),
  putaway_location uuid REFERENCES warehouse_location(location_id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cycle_count (
  cycle_count_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id      uuid REFERENCES warehouse_location(location_id),
  counted_by       uuid REFERENCES app_user(user_id),
  discrepancy      jsonb,
  certified_report_vault_id uuid,                    -- Rapport d'Audit
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_payrun_updated BEFORE UPDATE ON payroll_run FOR EACH ROW EXECUTE FUNCTION set_updated_at();
