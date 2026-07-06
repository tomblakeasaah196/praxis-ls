-- ============================================================================
-- TENANT DB — 0250 commercial: quotation (life-cycle step 4), the two
-- simulators (MOD-27/28, no GL impact per KB §7), and the Pricing Variance Index.
-- ============================================================================

-- Quotation (devis) — accept/reject, feeds pipeline, NO accounting impact ------
CREATE TABLE quotation (
  quotation_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_number       text,
  entity_id        uuid REFERENCES corporate_entity(entity_id),
  client_id        uuid REFERENCES client_master(client_id),
  dossier_id       uuid REFERENCES dossier(dossier_id),
  costing_id       uuid REFERENCES costing(costing_id),
  opportunity_id   uuid,                             -- FK added in 0350 (sales)
  currency         char(3) NOT NULL DEFAULT 'XAF' REFERENCES currency(code),
  quote_model      text NOT NULL DEFAULT 'HT_ON_TOP' CHECK (quote_model IN ('HT_ON_TOP','TTC')),
  margin_percent   numeric(9,4),
  total_ht         numeric(18,2) NOT NULL DEFAULT 0,
  total_ttc        numeric(18,2) NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT','SENT','ACCEPTED','REJECTED','EXPIRED','CONVERTED')),
  valid_until      date,
  content_hash     text,
  pdf_vault_id     uuid REFERENCES document_vault(doc_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE quotation_line (
  quotation_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id     uuid NOT NULL REFERENCES quotation(quotation_id) ON DELETE CASCADE,
  dictionary_item_id uuid REFERENCES dictionary_item(dictionary_item_id),
  label            text NOT NULL,
  qty              numeric(18,4) NOT NULL DEFAULT 1,
  unit_price       numeric(18,2) NOT NULL DEFAULT 0,
  is_debours       boolean NOT NULL DEFAULT false,
  tax_code_id      uuid REFERENCES tax_code(tax_code_id),
  line_no          integer
);

-- MOD-27 Margin Simulator (quick quote from costing; NO GL) -------------------
CREATE TABLE margin_simulation (
  margin_simulation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id       uuid REFERENCES dossier(dossier_id),
  service_type_id  uuid REFERENCES service_type(service_type_id),
  created_by       uuid REFERENCES app_user(user_id),
  margin_percent   numeric(9,4),
  total_cost       numeric(18,2) NOT NULL DEFAULT 0,
  total_price      numeric(18,2) NOT NULL DEFAULT 0,
  currency         char(3) NOT NULL DEFAULT 'XAF' REFERENCES currency(code),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE margin_simulation_line (
  margin_simulation_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  margin_simulation_id uuid NOT NULL REFERENCES margin_simulation(margin_simulation_id) ON DELETE CASCADE,
  dictionary_item_id uuid REFERENCES dictionary_item(dictionary_item_id),
  label            text NOT NULL,
  qty              numeric(18,4) NOT NULL DEFAULT 1,
  unit_cost        numeric(18,2) NOT NULL DEFAULT 0,
  unit_price       numeric(18,2) NOT NULL DEFAULT 0,
  is_debours       boolean NOT NULL DEFAULT false    -- margin applies to services only (§6)
);

-- MOD-28 Extra-Charges / Demurrage simulator (rapid quotes; NO GL) -----------
CREATE TABLE extra_charge_simulation (
  extra_charge_simulation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id       uuid REFERENCES dossier(dossier_id),
  shipping_line    text,
  container_variant text,                            -- '20ft' | '40ft'
  free_days        integer,
  out_of_port_on   date,
  computed_charges jsonb NOT NULL DEFAULT '[]'::jsonb,  -- per-day demurrage/detention breakdown
  total_amount     numeric(18,2) NOT NULL DEFAULT 0,
  currency         char(3) NOT NULL DEFAULT 'XAF' REFERENCES currency(code),
  created_by       uuid REFERENCES app_user(user_id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Pricing Variance Index (Sales-visible R/Y/G; never exposes raw cost) --------
CREATE TABLE pricing_variance (
  pricing_variance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id       uuid REFERENCES dossier(dossier_id),
  quotation_id     uuid REFERENCES quotation(quotation_id),
  margin_simulation_id uuid REFERENCES margin_simulation(margin_simulation_id),
  costing_id       uuid REFERENCES costing(costing_id),
  quoted_price     numeric(18,2),
  actual_cost      numeric(18,2),                    -- finance boundary computes; not exposed to Sales
  variance_percent numeric(9,4),
  flag             text CHECK (flag IN ('GREEN','YELLOW','RED')),
  computed_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_quotation_updated BEFORE UPDATE ON quotation FOR EACH ROW EXECUTE FUNCTION set_updated_at();
