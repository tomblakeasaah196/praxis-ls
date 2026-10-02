-- ============================================================================
-- TENANT DB — 14344 A rate says whether the figure typed included VAT.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- Meeting 6 (29 Sep 2026), register 3.4 / owner decision F4. A rate's VAT
-- basis was a free-text note: "72 700 TTC" typed there changed no arithmetic,
-- so a costing that priced the line at 72 700 then added 19,25 % VAT on top —
-- VAT twice.
--
-- `expense_rate.rate` stays what every reader already takes it to be: the HT
-- figure (costing, simulations, the resolver). When the person says the price
-- they typed INCLUDES VAT, the service stores
--
--     rate     = TTC ÷ (1 + the line's VAT rate)     — the HT every reader uses
--     rate_ttc = the figure exactly as typed          — shown beside it
--     vat_rate_percent / vat_tax_code_id              — the rate it was divided by
--
-- so both can be shown ("72 700 TTC = 60 964 HT at 19,25 %") and the division
-- can be re-checked later. A débours is always HT (it carries no VAT of ours),
-- so the service refuses the flag on one.
--
-- ── SHAPE ──────────────────────────────────────────────────────────────────
--
-- Plain columns on an existing table — the 13791 rule
-- (tests/unit/migration-constraint-ordering.test.js). `vat_tax_code_id` is
-- intent-only, REFERENCES tax_code(tax_code_id). The rule "rate_ttc and
-- vat_rate_percent are set exactly when price_includes_vat" is enforced in
-- expense_rate.service (applyVatBasis), not by a CHECK.
--
-- ── EXISTING RATES ARE NOT CHANGED ─────────────────────────────────────────
--
-- Nothing is backfilled: every existing rate starts out HT, which is what the
-- arithmetic has always treated it as. The ones whose NOTE says otherwise
-- ("TTC", "VAT inclusive", "TVA incluse") are LISTED for a person to review
-- (GET /expense-rates/vat-review), never re-divided here — a note is a guess
-- about intent, and dividing a rate that was in fact HT would under-price it.
-- ============================================================================

ALTER TABLE expense_rate ADD COLUMN IF NOT EXISTS price_includes_vat boolean NOT NULL DEFAULT false;
ALTER TABLE expense_rate ADD COLUMN IF NOT EXISTS rate_ttc numeric(18,2);
ALTER TABLE expense_rate ADD COLUMN IF NOT EXISTS vat_rate_percent numeric(9,4);
ALTER TABLE expense_rate ADD COLUMN IF NOT EXISTS vat_tax_code_id uuid;

COMMENT ON COLUMN expense_rate.price_includes_vat IS
  'True when the person typed a VAT-inclusive (TTC) price. `rate` is then the HT derived from it; `rate_ttc` is the figure as typed. Never true on a débours (service rule). 14344.';
COMMENT ON COLUMN expense_rate.rate_ttc IS
  'The VAT-inclusive figure as typed, when price_includes_vat. NULL otherwise. 14344.';
COMMENT ON COLUMN expense_rate.vat_rate_percent IS
  'The VAT rate the TTC figure was divided by (rate = rate_ttc / (1 + vat_rate_percent/100)). NULL when the rate was entered HT. 14344.';
COMMENT ON COLUMN expense_rate.vat_tax_code_id IS
  'The tax code that rate came from. Intent: REFERENCES tax_code(tax_code_id) — plain column per the 13791 rule. 14344.';

-- ============================================================================
-- VERIFY
--   SELECT expense_rate_id, rate, rate_ttc, vat_rate_percent
--     FROM expense_rate WHERE price_includes_vat;
--
-- DOWN
--   -- ALTER TABLE expense_rate DROP COLUMN IF EXISTS vat_tax_code_id;
--   -- ALTER TABLE expense_rate DROP COLUMN IF EXISTS vat_rate_percent;
--   -- ALTER TABLE expense_rate DROP COLUMN IF EXISTS rate_ttc;
--   -- ALTER TABLE expense_rate DROP COLUMN IF EXISTS price_includes_vat;
-- ============================================================================
