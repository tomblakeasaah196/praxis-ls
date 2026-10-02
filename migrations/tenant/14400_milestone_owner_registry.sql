-- ============================================================================
-- TENANT DB — 14400 Milestone owners become a registry a tenant can add to.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- Meeting 7 (1 Oct 2026), 01:56:14 → 01:57:20. Reviewing the PROJECT_CARGO
-- chain, the owner reached the stage-owner dropdown and found it closed:
--
--   "it's good to put the party that is directly involved in the operation and
--    I think we should even have the possibility of adding more parties here so
--    if it's not amongst this listed here … we should have the possibility of
--    adding. So maybe under milestones, let me see if we already have it. No, we
--    don't have that. So we're going to have a settings button, a configurations
--    button that will permit us to create new milestone owner categories."
--
-- The five values were hardcoded in three places at once — this CHECK, the same
-- CHECK on `milestone_instance.attributed_to`, a zod enum in
-- `milestone.validator.js`, and `OWNER_TIERS` in the client. A forwarder whose
-- permits sit with a ROAD AUTHORITY and whose survey sits with a MARINE
-- SURVEYOR had to file both under "Customs / authority", which is also what the
-- delay-attribution report then shows: one bucket, two unrelated third parties,
-- and no way to tell a port strike from a slow surveyor.
--
-- ── THE SHAPE ──────────────────────────────────────────────────────────────
--
-- `milestone_owner` is the master-data registry pattern the product already uses
-- for client types, supplier types and KYC document types (spec §6.2): system
-- rows that a tenant may RENAME and DEACTIVATE but never delete, plus rows they
-- add themselves. `code` is what every stage and every instance stores, so it is
-- stable; `name` / `name_fr` are what a person reads and are freely editable.
--
-- `is_internal` is the one flag that carries behaviour (owner decision, meeting
-- 7 Q3). The attribution report's whole job is "ours or theirs", and that
-- question has to keep working for an owner that did not exist when the report
-- was written — a tenant who adds "Internal — customs desk" means US.
--
-- ── WHY THE TWO CHECKS GO AND NOTHING REPLACES THEM IN THE DB ──────────────
--
-- An FK from `milestone_template_stage.owner_tier` to this table would be the
-- obvious move and is not available: adding a CHECK or a REFERENCES to a table
-- that already exists aborts provisioning a fresh tenant at 13791 (the rule in
-- tests/unit/migration-constraint-ordering.test.js). A NEW table may carry any
-- constraint it likes, so the registry is fully constrained; referential
-- integrity for the two consumer columns is enforced in milestone.service
-- (`resolveOwnerCodes`) and in the validator, and said so where it happens.
--
-- Dropping the CHECKs is the point of this file: with them in place, a row this
-- registry allows cannot be stored. The data they guarded is unaffected — every
-- existing stage holds one of the five seeded codes, which 9160 seeds as system
-- rows, so nothing is orphaned.
-- ============================================================================

CREATE TABLE IF NOT EXISTS milestone_owner (
  owner_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- What a stage and an instance STORE. Uppercase key, never renamed: four
  -- years of files are filed under it and the attribution report groups on it.
  code         text NOT NULL,
  name         text NOT NULL,                       -- English, what a person reads
  name_fr      text,                                -- French; falls back to name
  -- "Ours or theirs" for the attribution report. A tenant's own owner declares
  -- it; nothing infers it from the name.
  is_internal  boolean NOT NULL DEFAULT false,
  description  text,
  sort_order   integer NOT NULL DEFAULT 100,
  is_system    boolean NOT NULL DEFAULT false,      -- shipped: deactivate, never delete
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT milestone_owner_code_uq     UNIQUE (code),
  CONSTRAINT milestone_owner_code_shape  CHECK (code ~ '^[A-Z][A-Z0-9_]{1,31}$')
);

CREATE INDEX IF NOT EXISTS ix_milestone_owner_active ON milestone_owner(is_active, sort_order, code);

COMMENT ON TABLE milestone_owner IS
  'The parties a milestone stage can be owned by, and whom a slip is charged to. Seeded system rows plus the tenant''s own (14400, meeting 7 01:57:20). Referenced by milestone_template_stage.owner_tier and milestone_instance.attributed_to — enforced in milestone.service, not by an FK (the 13791 rule).';
COMMENT ON COLUMN milestone_owner.code IS
  'The stable key stored on every stage and instance. Never renamed — rename `name`/`name_fr` instead. 14400.';
COMMENT ON COLUMN milestone_owner.is_internal IS
  'True when this owner is US. The delay-attribution split (ours vs. a third party) reads this and nothing else, so a tenant-added internal desk is still counted as ours. 14400.';
COMMENT ON COLUMN milestone_owner.is_system IS
  'Shipped with the product. Renameable and deactivatable, never deletable (spec §6.2). 14400.';

-- ── The three CHECKs that made the registry unusable ────────────────────────
-- Not destructive: no data is lost, and no row in either table violates what is
-- left. The registry + milestone.service now decide which codes are legal.
-- All three matter: a stage carries the owner, an instance carries the owner it
-- was stamped with AND the owner a slip was charged to, so leaving any one in
-- place would let the chain publish and the dossier fail at instantiate.
ALTER TABLE milestone_template_stage DROP CONSTRAINT IF EXISTS milestone_stage_owner_tier_chk;
ALTER TABLE milestone_instance       DROP CONSTRAINT IF EXISTS milestone_instance_owner_tier_chk;
ALTER TABLE milestone_instance       DROP CONSTRAINT IF EXISTS milestone_instance_attributed_chk;

-- ============================================================================
-- VERIFY
--   SELECT code, name, name_fr, is_internal, is_system FROM milestone_owner
--     ORDER BY sort_order, code;
--   SELECT DISTINCT owner_tier FROM milestone_template_stage
--     WHERE owner_tier IS NOT NULL
--       AND owner_tier NOT IN (SELECT code FROM milestone_owner);   -- expect 0 rows
--   SELECT DISTINCT attributed_to FROM milestone_instance
--     WHERE attributed_to IS NOT NULL
--       AND attributed_to NOT IN (SELECT code FROM milestone_owner);  -- expect 0 rows
--
-- DOWN
--   -- ALTER TABLE milestone_instance ADD CONSTRAINT milestone_instance_attributed_chk
--   --   CHECK (attributed_to IS NULL OR attributed_to IN ('INTERNAL','CARRIER','TERMINAL','AUTHORITY','CLIENT'));
--   -- ALTER TABLE milestone_instance ADD CONSTRAINT milestone_instance_owner_tier_chk
--   --   CHECK (owner_tier IS NULL OR owner_tier IN ('INTERNAL','CARRIER','TERMINAL','AUTHORITY','CLIENT'));
--   -- ALTER TABLE milestone_template_stage ADD CONSTRAINT milestone_stage_owner_tier_chk
--   --   CHECK (owner_tier IS NULL OR owner_tier IN ('INTERNAL','CARRIER','TERMINAL','AUTHORITY','CLIENT'));
--   --   (both only after re-mapping every stage and instance back onto the five.)
--   -- DROP TABLE IF EXISTS milestone_owner;
-- ============================================================================
