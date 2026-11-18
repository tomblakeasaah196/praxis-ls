-- ============================================================================
-- TENANT DB — 14590 Sales lean revamp, PR 7: nothing points at `opportunity`
-- any more (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §4.8, PR 7 list).
--
-- The first of the PR 7 drops, and the one the others wait on. Before the
-- retired tables can go, every constraint and trigger that reaches into them
-- goes, so the drops in 14591 to 14594 are plain drops with no CASCADE and no
-- surprise about what else they took with them.
--
--   fk_quote_opportunity        quotation.opportunity_id -> opportunity (0350)
--   fk_proposal_opportunity     proposal.opportunity_id -> opportunity (0350)
--   fk_quote_request_converted_opportunity
--                               quote_request.converted_opportunity_id ->
--                               opportunity (10700)
--   trg_quote_request_sync_converted, quote_request_sync_converted()
--                               (0683) rewrote `status` to
--                               CONVERTED_TO_OPPORTUNITY whenever the column
--                               was set. `status` goes in 14593; "converted"
--                               means nothing once there is no opportunity.
--   trg_quote_request_stamp_opportunity_source,
--   opportunity_inherit_intake_source()
--                               (0686) wrote back into `opportunity` from a
--                               request. With the table gone it would fail on
--                               the first request that carries the column.
--
-- WHAT STAYS: `quote_request.converted_opportunity_id`. It is the only map from
-- an old opportunity id to the request it became, and old links resolve through
-- it (`/sales/opportunities/:id` reads `?converted_opportunity_id=`, and
-- `quotation.repo quoteRequestForOpportunity` finds the request for an old
-- `opportunity_id` input). Its foreign key goes, its trigger goes, and its
-- COMMENT says what it is now. Its two indexes stay: they serve that lookup.
--
-- THE PROOF. 14512 made every opportunity that no request pointed at into a
-- request and set this column on it, and PR 2 retired every opportunity write,
-- so every opportunity id should already be mapped. "Should" is not good
-- enough for a drop, so before anything is dropped:
--
--   1. A request 14512 made from an opportunity but that has lost the id is
--      found again by what 14512 wrote (channel MANUAL, the opportunity's name
--      as its title, the opportunity's creation time) and the id is set back.
--      RAISE NOTICE says how many rows that took (zero is the expected answer).
--   2. If any opportunity is STILL unmapped, the migration stops here. Nothing
--      in this file has committed (one file, one transaction), `opportunity` is
--      untouched, and the message names how many and where to look. Dropping
--      the table with an unmapped id would break that opportunity's old links
--      for good, which is exactly what the column is kept to prevent.
--
-- `ALTER TABLE IF EXISTS` and `IF EXISTS` throughout: on a database where PR 7
-- has run, or on CI's second pass, every statement is a no-op.
-- ============================================================================

-- ── 1. the triggers that write across, before any row is touched ───────────

-- DESTRUCTIVE: the trigger rewrote quote_request.status to CONVERTED_TO_OPPORTUNITY; status is dropped in 14593
DROP TRIGGER IF EXISTS trg_quote_request_sync_converted ON quote_request;
-- DESTRUCTIVE: the function served only the trigger above
DROP FUNCTION IF EXISTS quote_request_sync_converted();

-- DESTRUCTIVE: the trigger wrote back into opportunity, which 14592 drops
DROP TRIGGER IF EXISTS trg_quote_request_stamp_opportunity_source ON quote_request;
-- DESTRUCTIVE: the function served only the trigger above
DROP FUNCTION IF EXISTS opportunity_inherit_intake_source();

-- ── 2. every opportunity id is mapped to its request ────────────────────────

DO $$
DECLARE
  restored  integer := 0;
  unmapped  integer := 0;
BEGIN
  IF to_regclass('opportunity') IS NULL THEN
    RETURN;  -- already dropped: nothing left to prove
  END IF;

  -- (1) a request 14512 made from an opportunity, that has lost the id.
  WITH lost AS (
    SELECT DISTINCT ON (o.opportunity_id) o.opportunity_id, q.quote_request_id
      FROM opportunity o
      JOIN quote_request q
        ON q.converted_opportunity_id IS NULL
       AND q.intake_channel = 'MANUAL'
       AND q.title = o.name
       AND q.created_at = o.created_at
     WHERE NOT EXISTS (SELECT 1 FROM quote_request x WHERE x.converted_opportunity_id = o.opportunity_id)
     ORDER BY o.opportunity_id, q.quote_request_id
  )
  UPDATE quote_request q
     SET converted_opportunity_id = lost.opportunity_id
    FROM lost
   WHERE q.quote_request_id = lost.quote_request_id;
  GET DIAGNOSTICS restored = ROW_COUNT;
  RAISE NOTICE '14590: % request(s) given back the opportunity id they were made from', restored;

  -- (2) the proof.
  SELECT count(*) INTO unmapped
    FROM opportunity o
   WHERE NOT EXISTS (SELECT 1 FROM quote_request q WHERE q.converted_opportunity_id = o.opportunity_id);
  IF unmapped > 0 THEN
    RAISE EXCEPTION '14590: % opportunit(y/ies) map to no request, so dropping the table would break their old links. '
      'List them with: SELECT o.* FROM opportunity o WHERE NOT EXISTS (SELECT 1 FROM quote_request q '
      'WHERE q.converted_opportunity_id = o.opportunity_id); make each a request as 14512 step 4 does, then re-run.', unmapped;
  END IF;
  RAISE NOTICE '14590: every opportunity id maps to a request';
END $$;

-- ── 3. the foreign keys into opportunity ───────────────────────────────────

-- DESTRUCTIVE: the column stays as the old-link map; the table it pointed at is dropped in 14592
ALTER TABLE IF EXISTS quote_request DROP CONSTRAINT IF EXISTS fk_quote_request_converted_opportunity;

-- DESTRUCTIVE: quotation.opportunity_id and opportunity are both dropped in 14592
ALTER TABLE IF EXISTS quotation DROP CONSTRAINT IF EXISTS fk_quote_opportunity;

-- DESTRUCTIVE: proposal is dropped in 14591 and opportunity in 14592
ALTER TABLE IF EXISTS proposal DROP CONSTRAINT IF EXISTS fk_proposal_opportunity;

-- ── 4. what the column is now ──────────────────────────────────────────────

COMMENT ON COLUMN quote_request.converted_opportunity_id IS
  'The id of the retired opportunity this request was made from (14512), kept only so an old opportunity link or notification resolves to this request. No foreign key: the opportunity table was dropped in 14592. Nothing writes it.';

-- DOWN
-- IRREVERSIBLE: the triggers and foreign keys pointed at tables PR 7 drops
-- (14591, 14592), so they cannot come back without those tables. The way back
-- is the pre-deploy dump. To restore only the SHAPES, so the code of an earlier
-- release could boot, re-run 0683's quote_request_sync_converted trigger, 0686's
-- opportunity_inherit_intake_source trigger, 10700, and 0350's two
-- ALTER TABLE ... ADD CONSTRAINT lines, after the tables are back.
