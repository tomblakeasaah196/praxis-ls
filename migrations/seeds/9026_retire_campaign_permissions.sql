-- ============================================================================
-- SEED (TENANT DB) — 9026 MOD-22 grants leave with the module.
--
-- Campaigns (MOD-22, Marketing Campaign Register) were removed in the Sales
-- lean revamp (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md, owner decision D10,
-- 17/11/2026; migration 14500). 9021 grants MOD-22 to five roles and is frozen
-- byte for byte (scripts/db/migration-idempotency-baseline.json), and on a
-- fresh database every seed runs after every migration, so the clean-up has to
-- be a seed that sorts after 9021. On a database that already has the grants it
-- runs once, like any seed.
-- ============================================================================

-- DESTRUCTIVE: MOD-22 no longer exists, so its grants grant nothing
DELETE FROM permission WHERE module_key = 'MOD-22';

-- DOWN
-- IRREVERSIBLE: the module these grants named was removed. Restoring them
-- means re-running 9021's "Stop 8" block after restoring MOD-22's code.
