-- ============================================================================
-- TENANT DB — 0210 tax jurisdiction & VERSIONED tax codes (MOD-07, KB §21)
-- Rates are effective-dated ROWS, never literals. A new Finance Law is a new
-- version (effective_from), never an overwrite — preserves prior-period history.
-- ============================================================================

CREATE TABLE tax_jurisdiction (
  jurisdiction_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code     char(2) NOT NULL DEFAULT 'CM',
  name             text NOT NULL,
  currency         char(3) NOT NULL DEFAULT 'XAF',
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_code, name)
);

CREATE TABLE tax_code (
  tax_code_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_id  uuid NOT NULL REFERENCES tax_jurisdiction(jurisdiction_id) ON DELETE CASCADE,
  code             citext NOT NULL,                  -- 'TVA_STD' | 'WHT_SERVICE_REEL' | 'IS_MIN'
  kind             text NOT NULL CHECK (kind IN ('VAT','WHT','INCOME','PAYROLL','OTHER')),
  rate_percent     numeric(9,4),                     -- 19.2500 ; NULL for bracket tables
  base_rule        text,                             -- 'service_ht' | 'turnover' | 'net_taxable'
  applies_to       text,                             -- 'sales' | 'purchases' | 'salary' | 'nonresident'
  recoverable      boolean,                          -- for input VAT
  posts_debit_account  text REFERENCES chart_of_accounts(code),
  posts_credit_account text REFERENCES chart_of_accounts(code),
  brackets         jsonb,                            -- IRPP progressive scale, CNPS caps, etc.
  effective_from   date NOT NULL DEFAULT CURRENT_DATE,
  effective_to     date,
  legal_reference  text,                             -- CGI article / Finance Law year
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
-- One active version per code at a time (no overlapping windows is enforced in app;
-- this index just makes "current version" lookups fast).
CREATE INDEX ix_taxcode_lookup ON tax_code(jurisdiction_id, code, effective_from DESC);

-- Now wire the posting_rule.tax_code_id FK (dictionary line -> versioned tax).
ALTER TABLE posting_rule
  ADD CONSTRAINT fk_postrule_taxcode
  FOREIGN KEY (tax_code_id) REFERENCES tax_code(tax_code_id);
