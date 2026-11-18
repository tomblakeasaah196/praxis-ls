-- ============================================================================
-- TENANT DB — 14592 Sales lean revamp, PR 7: the opportunity goes
-- (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §4.2, §4.8; owner decisions D3 and D11).
--
-- The request is the deal (14511): its stage, value, currency, owner, file and
-- settle date were copied from the opportunity it became, and 14512 made every
-- other opportunity a request. 14590 proved every opportunity id maps to one
-- and removed every foreign key and trigger that reached into this table.
--
--   quotation.opportunity_id   nothing writes or selects it since PR 4; 14512
--                              copied it into quotation.quote_request_id, the
--                              one link from here on. Its index
--                              (idx_quotation_opportunity_id) goes with it.
--   opportunity                the deal record (0350, 0686). Its own triggers
--                              go with it; their functions are dropped below.
--
-- `pipeline_stage` (which opportunity pointed at) is NOT dropped here: seeds
-- 9030 and 9031 write it, and on a fresh database every seed runs after every
-- migration, so it is dropped by tenant seed 9032, which sorts after them.
-- The `opportunity.*` event types and the MOD-24 grants go in 9032 too.
--
-- WHAT STAYS: `quote_request.converted_opportunity_id`, the old-link map (14590).
-- ============================================================================

-- DESTRUCTIVE: quotation.quote_request_id is the one link (14512 copied every opportunity_id into it)
ALTER TABLE IF EXISTS quotation DROP COLUMN IF EXISTS opportunity_id;

-- DESTRUCTIVE: every opportunity is a request (14511, 14512) and 14590 proved each id maps to one
DROP TABLE IF EXISTS opportunity;

-- The table's trigger functions (0686). The triggers went with the table.
-- DESTRUCTIVE: the function kept opportunity.settled_at in step and has no table left
DROP FUNCTION IF EXISTS opportunity_sync_settled();
-- DESTRUCTIVE: the function gave a new opportunity its first stage and has no table left
DROP FUNCTION IF EXISTS opportunity_default_stage();

-- DOWN
-- IRREVERSIBLE: the rows are gone by decision (D3); each one lives on as the
-- request it became, found through quote_request.converted_opportunity_id.
-- Restoring the table means restoring the pre-deploy dump. To restore only the
-- SHAPES, re-run 0350's opportunity CREATE and its quotation.opportunity_id
-- foreign key, then 0686.
