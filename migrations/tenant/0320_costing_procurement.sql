-- ============================================================================
-- TENANT DB — 0320 costing / margin (MOD-46/47/48/27) & procurement (MOD-60/61/62)
-- Costing posts to the ledger tagged dossier_id; procurement enforces 3-way match.
-- ============================================================================

CREATE TABLE costing (
  costing_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id       uuid NOT NULL REFERENCES dossier(dossier_id) ON DELETE CASCADE,
  doc_number       text,
  currency         char(3) NOT NULL DEFAULT 'XAF',
  exchange_rate_to_xaf numeric(18,8) NOT NULL DEFAULT 1,
  margin_percent   numeric(9,4),
  status           text NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT','SUBMITTED_FOR_VALIDATION','SUBMITTED_FOR_APPROVAL',
                                       'APPROVED_LOCKED','REJECTED')),
  validator_id     uuid REFERENCES app_user(user_id),
  approver_id      uuid REFERENCES app_user(user_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE costing_line (
  costing_line_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  costing_id       uuid NOT NULL REFERENCES costing(costing_id) ON DELETE CASCADE,
  dictionary_item_id uuid REFERENCES dictionary_item(dictionary_item_id),
  label            text NOT NULL,
  qty              numeric(18,4) NOT NULL DEFAULT 1,
  unit_cost        numeric(18,2) NOT NULL DEFAULT 0,
  is_debours       boolean NOT NULL DEFAULT false,   -- excluded from margin (§6.7)
  tax_code_id      uuid REFERENCES tax_code(tax_code_id)
);

-- Cost tracking (budget vs actual per dossier & per category).
CREATE TABLE cost_entry (
  cost_entry_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id       uuid NOT NULL REFERENCES dossier(dossier_id),
  dictionary_item_id uuid REFERENCES dictionary_item(dictionary_item_id),
  category         text,
  amount           numeric(18,2) NOT NULL,
  entry_id         uuid REFERENCES journal_entry(entry_id),
  proof_vault_id   uuid,                             -- compliance checker requires proof
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Procurement ---------------------------------------------------------------
CREATE TABLE purchase_request (
  pr_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_number       text,
  requested_by     uuid REFERENCES app_user(user_id),
  department       text,
  justification    text,
  status           text NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','ORDERED')),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE purchase_order (
  po_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_id            uuid REFERENCES purchase_request(pr_id),
  supplier_id      uuid REFERENCES supplier_master(supplier_id),
  dossier_id       uuid REFERENCES dossier(dossier_id),
  doc_number       text,
  expense_category text CHECK (expense_category IN ('OPERATIONS','OVERHEAD')),
  total_ttc        numeric(18,2),
  security_hash    text,
  issuer_id        uuid REFERENCES app_user(user_id),
  approver_id      uuid REFERENCES app_user(user_id),
  status           text NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT','ISSUED_LOCKED','APPROVED_LOCKED','RECEIVED','CLOSED','CANCELLED')),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE purchase_order_item (
  po_item_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id            uuid NOT NULL REFERENCES purchase_order(po_id) ON DELETE CASCADE,
  dictionary_item_id uuid REFERENCES dictionary_item(dictionary_item_id),
  label            text NOT NULL,
  qty              numeric(18,4) NOT NULL DEFAULT 1,
  unit_price       numeric(18,2) NOT NULL DEFAULT 0
);
CREATE TABLE goods_received_note (
  grn_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id            uuid REFERENCES purchase_order(po_id),
  received_by      uuid REFERENCES app_user(user_id),
  supplier_invoice_ref text,
  three_way_matched boolean NOT NULL DEFAULT false,  -- PR<->PO<->GRN<->supplier invoice (KB §8.5)
  entry_id         uuid REFERENCES journal_entry(entry_id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_costing_updated BEFORE UPDATE ON costing FOR EACH ROW EXECUTE FUNCTION set_updated_at();
