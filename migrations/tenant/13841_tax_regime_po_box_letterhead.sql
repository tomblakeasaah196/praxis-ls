-- 13841 — Tax regime strict enum + PO Box on letterhead + address po_box backfill
-- Additive, idempotent, runs per schema.

-- ── 1. client_address and supplier_address get po_box (entity_address already has it since 0515)
ALTER TABLE client_address ADD COLUMN IF NOT EXISTS po_box text;
ALTER TABLE supplier_address ADD COLUMN IF NOT EXISTS po_box text;

COMMENT ON COLUMN client_address.po_box IS 'PO Box / BP — printed on letterhead and invoices when present.';
COMMENT ON COLUMN supplier_address.po_box IS 'PO Box / BP — printed on letterhead and invoices when present.';

-- ── 2. entity_tax_registration.regime: strict format + known Cameroon codes
-- Before: free text comment only. After: CHECK that regime is either NULL or
-- uppercase 2-30 chars (allows inline creation), and when it matches a known
-- code it must be one of the Cameroon standard list. The regex allows the
-- inline \"Add\" UI without a migration; the IN list documents the standard.
-- We keep the CHECK permissive (regex) so custom regimes added inline are
-- accepted; the app-level Zod schema enforces the same.
ALTER TABLE entity_tax_registration DROP CONSTRAINT IF EXISTS entity_tax_registration_regime_check;
ALTER TABLE entity_tax_registration ADD CONSTRAINT entity_tax_registration_regime_check
  CHECK (
    regime IS NULL
    OR regime ~ '^[A-Z0-9_]{2,30}$'
  );

-- Document the allowed standard values — the single source lives in
-- packages/shared/data/tax-regimes.js (REEL,NORMAL,SIMPLIFIE,LIBERATOIRE,FORFAIT,FRANCHISE)
COMMENT ON COLUMN entity_tax_registration.regime IS 'Tax regime: REEL | NORMAL | SIMPLIFIE | LIBERATOIRE | FORFAIT | FRANCHISE, or custom uppercase code (2-30 chars). See packages/shared/data/tax-regimes.js';

-- ── 3. entity_letterhead: toggles for postal address / PO Box block
ALTER TABLE entity_letterhead
  ADD COLUMN IF NOT EXISTS show_postal_address boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_po_box boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS logo_height_mm numeric;

COMMENT ON COLUMN entity_letterhead.show_postal_address IS 'Show postal address block on letterhead — controls po_box / postal_address blocks';
COMMENT ON COLUMN entity_letterhead.show_po_box IS 'Show PO Box block on letterhead';
COMMENT ON COLUMN entity_letterhead.logo_height_mm IS 'Logo height in mm (4-60) — fixed, does not scale with fit';

-- ── 4. Ensure entity_address po_box exists (defensive — 0515 added it, but 0511 party tables did not)
ALTER TABLE entity_address ADD COLUMN IF NOT EXISTS po_box text;

-- ── DOWN (commented, for reference)
-- ALTER TABLE entity_letterhead DROP COLUMN IF EXISTS show_postal_address;
-- ALTER TABLE entity_letterhead DROP COLUMN IF EXISTS show_po_box;
-- ALTER TABLE entity_letterhead DROP COLUMN IF EXISTS logo_height_mm;
-- ALTER TABLE entity_tax_registration DROP CONSTRAINT IF EXISTS entity_tax_registration_regime_check;
-- ALTER TABLE client_address DROP COLUMN IF EXISTS po_box;
-- ALTER TABLE supplier_address DROP COLUMN IF EXISTS po_box;
