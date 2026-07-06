-- ============================================================================
-- TENANT DB — 0300 master data: clients, suppliers, employees (MOD-02/03/04)
-- Carries forward the Cameroon-real fields from the legacy codebase.
-- ============================================================================

-- Dynamic client types (Shipper/Consignee/Business Partner + custom) ---------
CREATE TABLE client_type (
  client_type_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             citext UNIQUE NOT NULL,
  name             text NOT NULL,
  is_system        boolean NOT NULL DEFAULT false
);

CREATE TABLE client_master (
  client_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref              text UNIQUE,                      -- 'SLAS-CL-...'
  entity_id        uuid REFERENCES corporate_entity(entity_id),
  name             text NOT NULL,
  client_type_id   uuid REFERENCES client_type(client_type_id),
  niu              text, rccm text,
  payment_terms_days integer,
  credit_limit     numeric(18,2),
  kyc_docs         jsonb NOT NULL DEFAULT '[]'::jsonb,
  cached_receivables numeric(18,2) NOT NULL DEFAULT 0,
  cached_overdue   numeric(18,2) NOT NULL DEFAULT 0,
  is_withholding_agent boolean NOT NULL DEFAULT false,   -- withholds WHT (KB §6.6/§17)
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE supplier_master (
  supplier_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref              text UNIQUE,                      -- 'SLAS-SS-...'
  entity_id        uuid REFERENCES corporate_entity(entity_id),
  name             text NOT NULL,
  supplier_type    text,
  niu              text, rccm text,
  payment_method   text CHECK (payment_method IN ('BANK','CASH','MOBILE_MONEY','CHEQUE')),
  momo_network     text, momo_number text,
  bank_block       jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_non_resident  boolean NOT NULL DEFAULT false,   -- triggers SIT withholding (KB §17/B.7)
  rating           smallint CHECK (rating BETWEEN 1 AND 5),
  cached_payables  numeric(18,2) NOT NULL DEFAULT 0,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE employee (
  employee_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid REFERENCES corporate_entity(entity_id),
  full_name        text NOT NULL,
  department       text,
  job_title        text,
  employment_type  text,
  cnps_number      text,
  base_salary      numeric(18,2),
  risk_class_rate  numeric(9,4),                     -- CNPS work-injury rate per category (KB §9.1)
  bank_block       jsonb NOT NULL DEFAULT '{}'::jsonb,
  signatory_name   text,                             -- for PDF signing
  avatar_ref       text,
  is_driver        boolean NOT NULL DEFAULT false,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Back-wire the deferred FKs from earlier migrations -------------------------
ALTER TABLE app_user       ADD CONSTRAINT fk_user_employee   FOREIGN KEY (employee_id) REFERENCES employee(employee_id);
ALTER TABLE advance         ADD CONSTRAINT fk_advance_client  FOREIGN KEY (client_id)   REFERENCES client_master(client_id);
ALTER TABLE invoice         ADD CONSTRAINT fk_invoice_client  FOREIGN KEY (client_id)   REFERENCES client_master(client_id);
ALTER TABLE payment_receipt ADD CONSTRAINT fk_receipt_client  FOREIGN KEY (client_id)   REFERENCES client_master(client_id);

CREATE TRIGGER trg_client_updated   BEFORE UPDATE ON client_master   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_supplier_updated BEFORE UPDATE ON supplier_master FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_employee_updated BEFORE UPDATE ON employee        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
