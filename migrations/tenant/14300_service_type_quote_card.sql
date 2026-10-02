-- ============================================================================
-- TENANT DB — 14300 Where a service type sits in a quote request: its card,
-- and the Incoterms it offers (tenant review, meeting 6, PR 2 — A1 and B).
--
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- A quote request reaches the tenant from the website, the client portal and
-- the desk, and none of them stored WHICH service was asked for: the website
-- dropped the id it knew, the portal stored "Sea freight · Import" in whatever
-- language the client read, and the desk picked from a hard-coded list of ten.
-- The fix is that every request names a service type (14310). To get there a
-- client needs two taps — a CARD (how it moves) and a FLOW (which way) — and
-- every active service type has to land on exactly one card and one flow.
--
-- ── transport_mode: THE CARD, AS A COLUMN ──────────────────────────────────
--
--   SEA | AIR | RAIL | ROAD | STORAGE | CUSTOMS | OTHER
--
-- It was a DERIVATION (`_shared/service-mode.js` reads the key), which is fine
-- for a glyph — being wrong costs an icon. A card decides which questions a
-- client is asked, so a tenant whose key the ladder misreads has to be able to
-- correct it in Service types without engineering: the same reason 13774 gave
-- `enquiry_shape` its own column. The key's reading stays the DEFAULT —
-- backfilled below and applied by the trigger to every new row, the seeded
-- ones included (seed 9080 inserts the fifteen service types AFTER this file on
-- a fresh tenant, which is why a one-off UPDATE alone would miss them).
--
-- The FLOW is not a column. It is the existing, editable `territory`, read
-- through `serviceScope.flowOf` (INTERNATIONAL_IMPORT → Import, …). One fact,
-- one place to change it.
--
-- ── incoterms: WHAT THE SERVICE OFFERS ─────────────────────────────────────
--
-- Owner decision Q3: each service type carries the Incoterms it offers,
-- pre-filled from the ICC 2020 rules — a sea service all eleven, an air, road
-- or rail service the seven any-mode terms (FAS, FOB, CFR and CIF are for sea
-- and inland waterway only). Customs and "other" start with all eleven, storage
-- with none. `@praxis/shared` data/incoterms.js `defaultsForMode` is the same
-- table, in the same order.
--
-- ── NO CHECK CONSTRAINTS, ON PURPOSE ───────────────────────────────────────
--
-- service_type is an existing table and this file is above 13791, so it may
-- only gain PLAIN columns (tests/unit/migration-constraint-ordering.test.js):
-- a constraint here aborts provisioning a fresh tenant. The vocabulary is held
-- by the shared validator the service-type routes use (service_type.validator
-- → serviceScope.MODES, incoterms.CODES), and the trigger never writes a value
-- outside it.
-- ============================================================================

ALTER TABLE service_type
  ADD COLUMN IF NOT EXISTS transport_mode text;
ALTER TABLE service_type
  ADD COLUMN IF NOT EXISTS incoterms text[];

-- The key ladder, term for term with @praxis/shared rules/service-scope.js
-- MODE_LADDER (tests/unit/service-scope.test.js reads this function to hold
-- the two together). Precedence is the content: AIR before SEA, RAIL before
-- ROAD, INLAND and HINTERLAND are road unless rail said so first.
CREATE OR REPLACE FUNCTION service_type_mode_from_key(p_key text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN k LIKE '%AIR%' OR k LIKE '%FLIGHT%' THEN 'AIR'
    WHEN k LIKE '%SEA%' OR k LIKE '%OCEAN%' OR k LIKE '%SHIPPING%' THEN 'SEA'
    WHEN k LIKE '%RAIL%' THEN 'RAIL'
    WHEN k LIKE '%ROAD%' OR k LIKE '%TRUCK%' OR k LIKE '%HAULAGE%' OR k LIKE '%INLAND%' OR k LIKE '%HINTERLAND%' THEN 'ROAD'
    WHEN k LIKE '%WAREHOUS%' OR k LIKE '%STORAGE%' THEN 'STORAGE'
    WHEN k LIKE '%CUSTOMS%' OR k LIKE '%CLEARANCE%' OR k LIKE '%DECLARATION%' THEN 'CUSTOMS'
    ELSE 'OTHER'
  END
  FROM (SELECT upper(coalesce(p_key, '')) AS k) s
$$;

-- ICC 2020, in the order data/incoterms.js lists them.
CREATE OR REPLACE FUNCTION service_type_default_incoterms(p_mode text)
RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_mode IN ('AIR', 'ROAD', 'RAIL') THEN ARRAY['EXW','FCA','CPT','CIP','DAP','DPU','DDP']::text[]
    WHEN p_mode = 'STORAGE' THEN ARRAY[]::text[]
    ELSE ARRAY['EXW','FCA','FAS','FOB','CPT','CIP','CFR','CIF','DAP','DPU','DDP']::text[]
  END
$$;

-- NULL is never a state for either column: an insert without them (a seed, a
-- sandbox copy, an import) gets the key's card and that card's terms, and an
-- update that clears one gets them back. A value the tenant chose is never
-- touched — the trigger fills blanks, it does not overrule.
CREATE OR REPLACE FUNCTION service_type_quote_defaults()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.transport_mode IS NULL THEN
    NEW.transport_mode := service_type_mode_from_key(NEW.key);
  END IF;
  IF NEW.incoterms IS NULL THEN
    NEW.incoterms := service_type_default_incoterms(NEW.transport_mode);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_service_type_quote_defaults
  BEFORE INSERT OR UPDATE ON service_type
  FOR EACH ROW EXECUTE FUNCTION service_type_quote_defaults();

-- Backfill. Idempotent by predicate: a row already carrying a value is not
-- matched, so a re-run changes nothing and a tenant's own choice survives.
UPDATE service_type
   SET transport_mode = service_type_mode_from_key(key)
 WHERE transport_mode IS NULL;

UPDATE service_type
   SET incoterms = service_type_default_incoterms(transport_mode)
 WHERE incoterms IS NULL;

COMMENT ON COLUMN service_type.transport_mode IS
  'The quote form''s card for this service: SEA | AIR | RAIL | ROAD | STORAGE | CUSTOMS | OTHER (14300). Defaults to the key''s reading (service_type_mode_from_key); editable in Service types. The flow inside the card is derived from territory.';
COMMENT ON COLUMN service_type.incoterms IS
  'The Incoterms 2020 codes a quote request for this service may use (14300). Pre-filled from the card by ICC rules — sea all 11, air/road/rail the 7 any-mode terms, storage none — and editable in Service types. Requests also accept TBD ("Not sure").';

-- ============================================================================
-- VERIFY
--   SELECT key, transport_mode, territory, incoterms FROM service_type ORDER BY key;
--   -- the fifteen 9080 services:
--   --   AIR_*                     AIR      7 terms
--   --   SEA_* / END_TO_END_SEA_*  SEA      11 terms
--   --   END_TO_END_AIR_FREIGHT    AIR      7 terms
--   --   HINTERLAND_TRANSIT        ROAD     7 terms
--   --   INLAND_TRANSPORTATION     ROAD     7 terms
--   --   RAIL_*  / END_TO_END_RAIL RAIL     7 terms
--   --   WAREHOUSING               STORAGE  {}
--   --   CUSTOMS_BROKERAGE         CUSTOMS  11 terms
--   --   BUSINESS_REPRESENTATION   OTHER    11 terms
--   --   PROJECT_CARGO             OTHER    11 terms
--   SELECT count(*) FROM service_type WHERE transport_mode IS NULL OR incoterms IS NULL;
--   -- expect 0
--
-- DOWN
--   DROP TRIGGER IF EXISTS trg_service_type_quote_defaults ON service_type;
--   DROP FUNCTION IF EXISTS service_type_quote_defaults();
--   DROP FUNCTION IF EXISTS service_type_default_incoterms(text);
--   DROP FUNCTION IF EXISTS service_type_mode_from_key(text);
--   ALTER TABLE service_type DROP COLUMN IF EXISTS incoterms,
--                            DROP COLUMN IF EXISTS transport_mode;
--   -- Loses every card and Incoterm list a tenant corrected by hand. Revert
--   -- service_type.repo / validator and the quote wizards first: they read and
--   -- write both columns.
-- ============================================================================
