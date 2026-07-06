-- ============================================================================
-- TENANT DB — 0200 the three accounting layers (KB §4, §22). NEVER MERGED.
--   Layer 1 chart_of_accounts  — statutory SYSCOHADA, hierarchical, seeded
--   Layer 2 dictionary_item    — operational catalogue (is_debours), user-editable
--   Layer 3 posting_rule       — the glue: dict item -> accounts + tax_code + context
-- ============================================================================

-- LAYER 1 — statutory chart (MOD-06). Core is regulated; tenants add sub-accounts.
CREATE TABLE chart_of_accounts (
  code             text PRIMARY KEY,                 -- '4731', '706', '245'
  parent_code      text REFERENCES chart_of_accounts(code),
  label_fr         text NOT NULL,                    -- canonical (French)
  label_en         text,
  class            smallint NOT NULL CHECK (class BETWEEN 1 AND 9),
  normal_balance   char(1) NOT NULL CHECK (normal_balance IN ('D','C')),
  is_postable      boolean NOT NULL DEFAULT false,   -- only leaf/detail accounts are postable
  requires_analytic boolean NOT NULL DEFAULT false,  -- 4731, 706, 707 require a dossier_id
  entity_id        uuid REFERENCES corporate_entity(entity_id), -- NULL = shared statutory row
  is_system        boolean NOT NULL DEFAULT true,    -- seeded statutory vs tenant sub-account
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_coa_parent ON chart_of_accounts(parent_code);
CREATE INDEX ix_coa_class  ON chart_of_accounts(class);

-- LAYER 2 — operational item catalogue (MOD-05, re-scoped). Friendly EN/FR names,
-- rate/currency/shipping-line data, and THE is_debours flag (§6).
CREATE TABLE dictionary_item (
  dictionary_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             citext UNIQUE NOT NULL,
  label_fr         text NOT NULL,
  label_en         text,
  description      text,
  category         text NOT NULL CHECK (category IN ('debours','service','overhead','asset','other')),
  is_debours       boolean NOT NULL DEFAULT false,
  is_billable      boolean NOT NULL DEFAULT true,
  default_price    numeric(18,2),
  currency         char(3) NOT NULL DEFAULT 'XAF',
  shipping_line    text,                             -- MSC / Maersk ... (feeds MOD-10 expense rate)
  service_type_key citext,                           -- applicability (which services surface it)
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Expense rates per shipping line (MOD-10): seeded-but-editable, feeds costing.
CREATE TABLE expense_rate (
  expense_rate_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dictionary_item_id uuid NOT NULL REFERENCES dictionary_item(dictionary_item_id) ON DELETE CASCADE,
  shipping_line    text,
  variant          text,                             -- '20ft' | '40ft'
  rate             numeric(18,2) NOT NULL,
  currency         char(3) NOT NULL DEFAULT 'XAF',
  effective_from   date NOT NULL DEFAULT CURRENT_DATE,
  effective_to     date,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_exprate_item ON expense_rate(dictionary_item_id);

-- LAYER 3 — posting rules / account determination (the glue). A dict item may
-- post to several accounts, so this is a child table (cardinality > 1). tax_code
-- FK is added in 0210 after tax_code exists.
CREATE TABLE posting_rule (
  posting_rule_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dictionary_item_id uuid NOT NULL REFERENCES dictionary_item(dictionary_item_id) ON DELETE CASCADE,
  applies_context  text NOT NULL CHECK (applies_context IN ('sale','purchase','disbursement')),
  debit_account    text REFERENCES chart_of_accounts(code),
  credit_account   text REFERENCES chart_of_accounts(code),
  tax_code_id      uuid,                             -- FK -> tax_code (added in 0210); NULL for débours
  is_debours       boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_postrule_item ON posting_rule(dictionary_item_id);

-- INVARIANT (KB §23 rule 14): a dictionary item cannot exist without at least one
-- complete posting rule. Enforced as a DEFERRABLE constraint trigger so the item
-- + its rule can be inserted in the same transaction.
CREATE OR REPLACE FUNCTION assert_dictionary_has_rule() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM posting_rule pr WHERE pr.dictionary_item_id = NEW.dictionary_item_id) THEN
    RAISE EXCEPTION 'dictionary_item % has no posting_rule (KB §23.14)', NEW.dictionary_item_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER trg_dict_needs_rule
  AFTER INSERT ON dictionary_item
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_dictionary_has_rule();

CREATE TRIGGER trg_dictitem_updated BEFORE UPDATE ON dictionary_item FOR EACH ROW EXECUTE FUNCTION set_updated_at();
