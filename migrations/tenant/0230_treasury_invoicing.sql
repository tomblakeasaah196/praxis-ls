-- ============================================================================
-- TENANT DB — 0230 treasury, régie d'avance, invoicing, receivables, assets
-- (MOD-09/49/50/51/52/54). Accounting behaviour per KB §6, §7, §8.
-- ============================================================================

-- Treasury accounts (bank 521, cash 571, MoMo 538x). Each maps to a COA account.
CREATE TABLE treasury_account (
  treasury_account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid NOT NULL REFERENCES corporate_entity(entity_id),
  kind             text NOT NULL CHECK (kind IN ('BANK','CASH','MOMO')),
  label            text NOT NULL,                    -- 'Afriland 521-1' | 'MTN MoMo'
  coa_code         text NOT NULL REFERENCES chart_of_accounts(code),
  momo_network     text,                             -- 'MTN' | 'ORANGE'
  momo_fee_account text REFERENCES chart_of_accounts(code),  -- book fees separately (631x)
  currency         char(3) NOT NULL DEFAULT 'XAF',
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Régie d'avance (581) state machine (KB §6.8). Aging reclassifies 581->4211,
-- NEVER auto-allocates to 4731.
CREATE TABLE regie_advance (
  regie_advance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holder_user_id   uuid REFERENCES app_user(user_id),
  amount           numeric(18,2) NOT NULL,
  justified_amount numeric(18,2) NOT NULL DEFAULT 0,
  returned_amount  numeric(18,2) NOT NULL DEFAULT 0,
  issued_on        date NOT NULL DEFAULT CURRENT_DATE,
  policy_window_days integer NOT NULL DEFAULT 7,
  state            text NOT NULL DEFAULT 'ISSUED'
                     CHECK (state IN ('ISSUED','PARTIALLY_JUSTIFIED','JUSTIFIED','AGED_UNJUSTIFIED','QUERIED')),
  issue_entry_id   uuid REFERENCES journal_entry(entry_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Customer advances received on a proforma (4191) — a liability, not revenue.
CREATE TABLE advance (
  advance_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid,                             -- FK added in 0300
  dossier_id       uuid,                             -- FK added in 0310
  amount           numeric(18,2) NOT NULL,
  received_on      date NOT NULL DEFAULT CURRENT_DATE,
  applied_amount   numeric(18,2) NOT NULL DEFAULT 0,
  entry_id         uuid REFERENCES journal_entry(entry_id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Invoices: proforma (no GL) and final (recognises revenue). MOD-50/51.
CREATE TABLE invoice (
  invoice_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid NOT NULL REFERENCES corporate_entity(entity_id),
  client_id        uuid,                             -- FK added in 0300
  dossier_id       uuid,                             -- FK added in 0310
  type             text NOT NULL CHECK (type IN ('PROFORMA','FINAL','CREDIT_NOTE')),
  doc_number       text,                             -- allocated on issue/lock
  currency         char(3) NOT NULL DEFAULT 'XAF',
  fx_rate          numeric(18,8) NOT NULL DEFAULT 1,
  quote_model      text NOT NULL DEFAULT 'HT_ON_TOP' CHECK (quote_model IN ('HT_ON_TOP','TTC')),
  service_ht       numeric(18,2) NOT NULL DEFAULT 0,
  debours_total    numeric(18,2) NOT NULL DEFAULT 0,
  vat_total        numeric(18,2) NOT NULL DEFAULT 0,
  total_ttc        numeric(18,2) NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT','SUBMITTED_FOR_VALIDATION','SUBMITTED_FOR_APPROVAL',
                                       'ISSUED_LOCKED','APPROVED_LOCKED','POSTED_LOCKED','CANCELLED','REVERSED')),
  entry_id         uuid REFERENCES journal_entry(entry_id),  -- the posted revenue entry
  content_hash     text,                             -- SHA-256 document DNA (§8.4)
  pdf_vault_id     uuid,                             -- FK to document_vault (0340)
  issued_by        uuid REFERENCES app_user(user_id),
  validated_by     uuid REFERENCES app_user(user_id),
  approved_by      uuid REFERENCES app_user(user_id),
  payment_due_on   date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_invoice_client ON invoice(client_id);
CREATE INDEX ix_invoice_dossier ON invoice(dossier_id);

CREATE TABLE invoice_line (
  invoice_line_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       uuid NOT NULL REFERENCES invoice(invoice_id) ON DELETE CASCADE,
  dictionary_item_id uuid REFERENCES dictionary_item(dictionary_item_id),
  label            text NOT NULL,
  qty              numeric(18,4) NOT NULL DEFAULT 1,
  unit_price       numeric(18,2) NOT NULL DEFAULT 0,
  is_debours       boolean NOT NULL DEFAULT false,
  tax_code_id      uuid REFERENCES tax_code(tax_code_id),
  line_ht          numeric(18,2) NOT NULL DEFAULT 0,
  line_no          integer,
  -- §23.5 mirror: a débours invoice line carries no tax.
  CONSTRAINT chk_debours_no_tax CHECK (NOT (is_debours AND tax_code_id IS NOT NULL))
);
CREATE INDEX ix_invline_invoice ON invoice_line(invoice_id);

-- Payments / receivables (MOD-52).
CREATE TABLE payment_receipt (
  receipt_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid,
  method           text NOT NULL CHECK (method IN ('BANK','CASH','MOBILE_MONEY','CHEQUE')),
  treasury_account_id uuid REFERENCES treasury_account(treasury_account_id),
  amount           numeric(18,2) NOT NULL,
  received_on      date NOT NULL DEFAULT CURRENT_DATE,
  content_hash     text,
  status           text NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT','POSTED_LOCKED','REVERSED')),
  entry_id         uuid REFERENCES journal_entry(entry_id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payment_allocation (
  allocation_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id       uuid NOT NULL REFERENCES payment_receipt(receipt_id) ON DELETE CASCADE,
  invoice_id       uuid NOT NULL REFERENCES invoice(invoice_id),
  amount           numeric(18,2) NOT NULL
);

-- Fixed assets & depreciation (MOD-54): acquisition->depreciation->disposal.
CREATE TABLE asset (
  asset_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid NOT NULL REFERENCES corporate_entity(entity_id),
  tag              text UNIQUE,                      -- barcode
  label            text NOT NULL,
  coa_asset_code   text REFERENCES chart_of_accounts(code),      -- 245, 231, 213 ...
  coa_depr_code    text REFERENCES chart_of_accounts(code),      -- 2845, 2831 ...
  acquisition_cost numeric(18,2) NOT NULL,
  residual_value   numeric(18,2) NOT NULL DEFAULT 0,
  method           text NOT NULL DEFAULT 'LINEAR' CHECK (method IN ('LINEAR','DECLINING')),
  useful_life_months integer NOT NULL,
  acquired_on      date NOT NULL,
  disposed_on      date,
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISPOSED')),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE depreciation_schedule (
  depreciation_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id         uuid NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
  period_code      text NOT NULL,                    -- '2026-01'
  amount           numeric(18,2) NOT NULL,
  entry_id         uuid REFERENCES journal_entry(entry_id),
  posted           boolean NOT NULL DEFAULT false,
  UNIQUE (asset_id, period_code)
);

CREATE TRIGGER trg_regie_updated   BEFORE UPDATE ON regie_advance FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_invoice_updated BEFORE UPDATE ON invoice       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
