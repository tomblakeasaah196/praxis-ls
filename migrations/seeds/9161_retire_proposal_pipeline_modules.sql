-- ============================================================================
-- SEED (PLATFORM DB) — 9161 MOD-23, MOD-24 and `sales.proposals` leave the
-- catalogue.
--
-- The Sales lean revamp (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §5.1, PR 7) folded
-- the opportunity into the request (owner decision D3) and the proposal into
-- the quotation (D6). MOD-23 (Proposal Generator) and MOD-24 (Sales Pipeline)
-- have no code, no tables and no grants left (tenant migrations 14591, 14592
-- and seed 9032). Left in the catalogue, they would still be offered in plans,
-- in the company dashboard's feature switches and in the permission matrix,
-- granting access to nothing. `sales.proposals` (AI proposal generator) was
-- MOD-23's only feature, and nothing in the code gates on it: Draft With AI
-- lives on the quotation (MOD-27).
--
-- WHY A SEED AND NOT A PLATFORM MIGRATION. 9100 and 9110 insert these rows and
-- are frozen byte for byte (scripts/db/migration-idempotency-baseline.json).
-- On a fresh database every seed runs after every migration, so a migration
-- would delete rows that did not exist yet and 9100/9110 would then create
-- them. A seed that sorts after them runs last on a fresh database and once on
-- an existing one. PR 1's 9160 is the precedent.
--
-- `plan_feature` and `tenant_feature_override` rows for the feature cascade
-- (platform 0020). The feature goes first: it references MOD-23 without a
-- cascade.
-- ============================================================================

-- DESTRUCTIVE: the feature gates nothing; Draft With AI moved to the quotation (MOD-27)
DELETE FROM platform.feature_catalogue WHERE feature_key = 'sales.proposals';

-- DESTRUCTIVE: MOD-23's and MOD-24's code and tables were removed (tenant migrations 14591 and 14592)
DELETE FROM platform.module_catalogue WHERE module_key IN ('MOD-23', 'MOD-24');

-- DOWN
-- IRREVERSIBLE: the modules were removed by decision (D3, D6). The way back is
-- the pre-deploy dump; to restore only the rows, re-run 9100's MOD-23 and
-- MOD-24 rows and 9110's `sales.proposals` row.
