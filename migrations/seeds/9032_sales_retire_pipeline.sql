-- ============================================================================
-- SEED (TENANT DB) — 9032 the pipeline, the opportunity and the proposal leave
-- the tenant's reference data (Sales lean revamp, PR 7;
-- doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §4.8 and §5.1).
--
-- Stages are fixed on the request now (New, Contacted, Meeting, Quoted, Won,
-- Lost: owner decision D3), the opportunity and the proposal tables were dropped
-- in tenant migrations 14591 and 14592, and MOD-23 (Proposal Generator) and
-- MOD-24 (Sales Pipeline) are retired. What is left of them is reference data
-- that SEEDS created:
--
--   pipeline_stage            9030 inserts the default stages and 9031 their
--                             probabilities. Nothing reads it since PR 3, and
--                             the only foreign key onto it was opportunity's.
--   event types opportunity.* 0686 and 9030 (opportunity.won); proposal.sent
--   and proposal.*            from 9030. Nothing can raise them any more, so
--                             neither the workflow designer nor the
--                             notification settings should offer them. A
--                             workflow bound to one cascades (0120); event_log
--                             rows carry the key without a foreign key and stay
--                             as history.
--   MOD-23 and MOD-24 grants  9021 grants both to five roles. The modules no
--                             longer exist, so the grants grant nothing.
--
-- WHY A SEED AND NOT A MIGRATION. 9021, 9030 and 9031 are frozen byte for byte
-- (scripts/db/migration-idempotency-baseline.json), and on a fresh database
-- every seed runs after every migration. A migration would delete rows that do
-- not exist yet, and 9030 would then fail with "relation pipeline_stage does
-- not exist". This seed sorts after all three, so it runs last on a fresh
-- database and once on an existing one. PR 1's 9026 is the precedent.
--
-- MOD-23 and MOD-24 leave the platform catalogue in platform seed 9161.
-- ============================================================================

-- DESTRUCTIVE: stages are fixed on the request (D3); nothing reads this table and the opportunity that pointed at it was dropped in 14592
DROP TABLE IF EXISTS pipeline_stage;

-- DESTRUCTIVE: the opportunity and proposal modules were removed, so nothing can raise these events; bound workflows cascade (0120)
DELETE FROM event_type
 WHERE key LIKE 'opportunity.%'
    OR key LIKE 'proposal.%';

-- DESTRUCTIVE: MOD-23 (Proposal Generator) and MOD-24 (Sales Pipeline) were retired, so these grants grant nothing
DELETE FROM permission WHERE module_key IN ('MOD-23', 'MOD-24');

-- DOWN
-- IRREVERSIBLE: the modules these rows served were removed by decision (D3,
-- D6). The way back is the pre-deploy dump. To restore only the rows, recreate
-- pipeline_stage as 0350 and 0686 declare it, then re-run 9030's stage and
-- event-type inserts, 9031, 0686's event-type insert and 9021's "Stop 8" block.
