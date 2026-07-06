-- ============================================================================
-- TENANT DB — 0240 finance gap fills (audit build list, high priority)
--   MOD-08 currency & live FX · AP supplier invoice · MOD-49 cash request doc ·
--   MOD-53 project financing (debt) · tax declarations (TVA/IS/DSF/CNPS) ·
--   MOD-57–59 statement snapshots + guided monthly close.
-- ============================================================================

-- MOD-08 Currency master + daily FX cache (midnight cron) + stamped history ---
CREATE TABLE currency (
  code             char(3) PRIMARY KEY,              -- 'XAF' | 'USD' | 'EUR'
  name             text NOT NULL,
  symbol           text,
  is_base          boolean NOT NULL DEFAULT false,   -- XAF is base
  decimals         smallint NOT NULL DEFAULT 2,
  is_active        boolean NOT NULL DEFAULT true
);
CREATE TABLE fx_rate_daily (
  fx_rate_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_code        char(3) NOT NULL REFERENCES currency(code),
  quote_code       char(3) NOT NULL REFERENCES currency(code),
  rate             numeric(18,8) NOT NULL,           -- 1 base = rate * quote
  as_of_date       date NOT NULL,
  source           text NOT NULL DEFAULT 'exchangerate-api',  -- 'exchangerate-api' | 'manual'
  is_override      boolean NOT NULL DEFAULT false,   -- manual override/fallback
  fetched_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (base_code, quote_code, as_of_date, source)
);
CREATE INDEX ix_fx_lookup ON fx_rate_daily(base_code, quote_code, as_of_date DESC);

-- Accounts payable: supplier invoice (three-way match feeds it) ---------------
CREATE TABLE supplier_invoice (
  supplier_invoice_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid REFERENCES corporate_entity(entity_id),
  supplier_id      uuid REFERENCES supplier_master(supplier_id),
  po_id            uuid REFERENCES purchase_order(po_id),
  grn_id           uuid REFERENCES goods_received_note(grn_id),
  dossier_id       uuid REFERENCES dossier(dossier_id),
  supplier_ref     text,
  doc_number       text,
  currency         char(3) NOT NULL DEFAULT 'XAF' REFERENCES currency(code),
  fx_rate          numeric(18,8) NOT NULL DEFAULT 1,
  amount_ht        numeric(18,2) NOT NULL DEFAULT 0,
  vat_total        numeric(18,2) NOT NULL DEFAULT 0,
  wht_total        numeric(18,2) NOT NULL DEFAULT 0,   -- SIT/précompte we must withhold
  amount_ttc       numeric(18,2) NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT','MATCHED','POSTED_LOCKED','PAID','REVERSED')),
  entry_id         uuid REFERENCES journal_entry(entry_id),
  due_on           date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE supplier_invoice_line (
  supplier_invoice_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_invoice_id uuid NOT NULL REFERENCES supplier_invoice(supplier_invoice_id) ON DELETE CASCADE,
  dictionary_item_id uuid REFERENCES dictionary_item(dictionary_item_id),
  label            text NOT NULL,
  qty              numeric(18,4) NOT NULL DEFAULT 1,
  unit_price       numeric(18,2) NOT NULL DEFAULT 0,
  tax_code_id      uuid REFERENCES tax_code(tax_code_id),
  expense_account  text REFERENCES chart_of_accounts(code)
);

-- MOD-49 Cash request / disbursal document (régie is the ledger side) ---------
CREATE TABLE cash_request (
  cash_request_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_number       text,
  dossier_id       uuid REFERENCES dossier(dossier_id),
  costing_id       uuid REFERENCES costing(costing_id),
  requested_by     uuid REFERENCES app_user(user_id),
  regie_advance_id uuid REFERENCES regie_advance(regie_advance_id),
  amount           numeric(18,2) NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','DISBURSED','JUSTIFIED','REJECTED')),
  approver_id      uuid REFERENCES app_user(user_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cash_request_line (
  cash_request_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_request_id  uuid NOT NULL REFERENCES cash_request(cash_request_id) ON DELETE CASCADE,
  dictionary_item_id uuid REFERENCES dictionary_item(dictionary_item_id),
  label            text NOT NULL,
  budget_amount    numeric(18,2) NOT NULL DEFAULT 0,
  spent_amount     numeric(18,2) NOT NULL DEFAULT 0,
  is_debours       boolean NOT NULL DEFAULT false,
  proof_vault_id   uuid REFERENCES document_vault(doc_id)
);
CREATE TABLE cash_request_payment (
  cash_request_payment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_request_id  uuid NOT NULL REFERENCES cash_request(cash_request_id) ON DELETE CASCADE,
  treasury_account_id uuid REFERENCES treasury_account(treasury_account_id),
  amount           numeric(18,2) NOT NULL,
  paid_on          date NOT NULL DEFAULT CURRENT_DATE,
  entry_id         uuid REFERENCES journal_entry(entry_id)
);

-- MOD-53 Project financing (debt) --------------------------------------------
CREATE TABLE debt_engagement (
  debt_engagement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid REFERENCES corporate_entity(entity_id),
  dossier_id       uuid REFERENCES dossier(dossier_id),
  lender_kind      text CHECK (lender_kind IN ('BANK','THIRD_PARTY','DIRECTOR')),
  lender_name      text,
  principal        numeric(18,2) NOT NULL,
  currency         char(3) NOT NULL DEFAULT 'XAF' REFERENCES currency(code),
  interest_rate    numeric(9,4),
  coa_code         text REFERENCES chart_of_accounts(code),   -- 162 loans
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SETTLED','DEFAULTED')),
  started_on       date, due_on date,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE debt_repayment (
  debt_repayment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_engagement_id uuid NOT NULL REFERENCES debt_engagement(debt_engagement_id) ON DELETE CASCADE,
  principal_part   numeric(18,2) NOT NULL DEFAULT 0,
  interest_part    numeric(18,2) NOT NULL DEFAULT 0,
  paid_on          date NOT NULL DEFAULT CURRENT_DATE,
  entry_id         uuid REFERENCES journal_entry(entry_id)
);

-- Tax declarations / returns produced from the ledger (TVA, IS, DSF, CNPS) ----
CREATE TABLE tax_declaration (
  tax_declaration_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid REFERENCES corporate_entity(entity_id),
  kind             text NOT NULL CHECK (kind IN ('TVA','IS','MIN_TAX','WHT','DSF','CNPS','DIPE','PATENTE')),
  period_code      text NOT NULL,                    -- '2026-01' | '2026'
  computed_dataset jsonb NOT NULL DEFAULT '{}'::jsonb,  -- the generated figures traceable to journals
  amount_due       numeric(18,2),
  status           text NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT','COMPUTED','APPROVED','FILED','PAID')),
  due_on           date,                             -- from the tax calendar (15th, 15 Mar/Apr/May)
  filed_on         date,
  filed_ref        text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, kind, period_code)
);

-- Compliance calendar of statutory obligations (drives reminders/alerts) ------
CREATE TABLE tax_calendar (
  tax_calendar_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid REFERENCES corporate_entity(entity_id),
  obligation       text NOT NULL,                    -- 'VAT_RETURN' | 'DIPE' | 'DSF' | 'IS_INSTALMENT'
  due_on           date NOT NULL,
  status           text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DONE','LATE')),
  tax_declaration_id uuid REFERENCES tax_declaration(tax_declaration_id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- MOD-57–59 Statement snapshots + guided monthly close -----------------------
CREATE TABLE financial_statement (
  financial_statement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid REFERENCES corporate_entity(entity_id),
  period_id        uuid REFERENCES accounting_period(period_id),
  kind             text NOT NULL CHECK (kind IN ('BILAN','COMPTE_RESULTAT','TAFIRE','NOTES','ESS','TRIAL_BALANCE')),
  dataset          jsonb NOT NULL DEFAULT '{}'::jsonb,   -- rendered from the trial balance
  generated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, period_id, kind)
);
CREATE TABLE close_checklist (
  close_checklist_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id        uuid NOT NULL REFERENCES accounting_period(period_id) ON DELETE CASCADE,
  step_key         text NOT NULL,                    -- 'accruals' | 'depreciation' | 'fx_retranslation' | 'vat' | 'is'
  label            text NOT NULL,
  is_done          boolean NOT NULL DEFAULT false,
  done_by          uuid REFERENCES app_user(user_id),
  done_at          timestamptz,
  UNIQUE (period_id, step_key)
);

CREATE TRIGGER trg_supplierinv_updated BEFORE UPDATE ON supplier_invoice FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_cashreq_updated     BEFORE UPDATE ON cash_request     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_taxdecl_updated     BEFORE UPDATE ON tax_declaration  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
