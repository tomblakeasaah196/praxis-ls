-- ============================================================================
-- TENANT DB — 14591 Sales lean revamp, PR 7: the proposal tables go
-- (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §4.6, §4.8; owner decision D6).
--
-- Every proposal became a quotation in 14542: its lines are quotation lines,
-- its narratives are quotation sections, its share token was carried over, and
-- `quotation.source_proposal_id` records which proposal each quotation was. PR 6
-- removed the last screen and service that read these tables.
--
--   proposal_narrative   the narratives (0350, 0690), now quotation_section
--   proposal_line        the price lines (0350), now quotation_line
--   proposal             the header (0350, 0690, 0692, 0693), now quotation
--   mail send point `proposal.shared` (10726), declared and never wired; 14543
--                        left it for this PR. Its bindings cascade (10726).
--
-- WHAT STAYS: `quotation.source_proposal_id` (no foreign key, so the drop does
-- not touch it). It is the old proposal links' map: `/sales/proposals/:id`,
-- `entity-route` `proposal`, the portal chat's `proposal:<id>` references and
-- public-web's `/proposal/<token>` all resolve through it. The PROPOSAL vault
-- document type stays too, so a signed proposal PDF still verifies.
--
-- The event types `proposal.*` and the MOD-23 grants are removed by tenant seed
-- 9032, because seeds 9030 and 9021 create them and on a fresh database every
-- seed runs after every migration.
-- ============================================================================

-- DESTRUCTIVE: every narrative became a quotation_section in 14542
DROP TABLE IF EXISTS proposal_narrative;

-- DESTRUCTIVE: every line became a quotation_line in 14542
DROP TABLE IF EXISTS proposal_line;

-- DESTRUCTIVE: every proposal became a quotation in 14542; quotation.source_proposal_id keeps the map
DROP TABLE IF EXISTS proposal;

-- DESTRUCTIVE: nothing shares a proposal any more; quotations send through quotation.sent
DELETE FROM mail_send_point WHERE send_point_key = 'proposal.shared';

-- DOWN
-- IRREVERSIBLE: the rows are gone by decision (D6); every one lives on as the
-- quotation 14542 made of it. Restoring the tables themselves means restoring
-- the pre-deploy dump. To restore only the SHAPES, re-run 0350's proposal,
-- proposal_line and proposal_narrative CREATE statements, then 0690, 0692 and
-- 0693's ALTER statements, and 10726's proposal.shared row.
