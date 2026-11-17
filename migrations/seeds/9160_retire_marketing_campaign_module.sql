-- ============================================================================
-- SEED (PLATFORM DB) — 9160 MOD-22 and `sales.marketing` leave the catalogue.
--
-- Campaigns (MOD-22, Marketing Campaign Register) and the website newsletter
-- they sent to were removed in the Sales lean revamp
-- (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md, owner decision D10, 17/11/2026; tenant
-- migration 14500). Left in the catalogue, the module would still be offered
-- in plans, in the company dashboard's feature switches and in the permission
-- matrix, granting access to nothing.
--
-- WHY A SEED AND NOT A PLATFORM MIGRATION. 9100 and 9110 insert both rows and
-- are frozen byte for byte (scripts/db/migration-idempotency-baseline.json).
-- On a fresh database every seed runs after every migration, so a migration
-- would delete rows that did not exist yet and 9100/9110 would then create
-- them. A seed that sorts after them runs last on a fresh database and once on
-- an existing one.
--
-- `plan_feature` and `tenant_feature_override` rows for the feature cascade
-- (platform 0020). Nothing else references the module key.
-- ============================================================================

-- DESTRUCTIVE: the feature gates nothing since its module was removed
DELETE FROM platform.feature_catalogue WHERE feature_key = 'sales.marketing';

-- DESTRUCTIVE: MOD-22's code and tables were removed (tenant migration 14500)
DELETE FROM platform.module_catalogue WHERE module_key = 'MOD-22';

-- DOWN
-- IRREVERSIBLE: the module was removed by decision. To restore the rows,
-- re-run 9100's MOD-22 row and 9110's `sales.marketing` row.
