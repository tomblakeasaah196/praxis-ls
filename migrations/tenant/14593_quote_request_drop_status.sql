-- ============================================================================
-- TENANT DB — 14593 Sales lean revamp, PR 7: a request has a stage, not a
-- status (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §4.2, §4.8; owner decision D3).
--
-- `quote_request.status` was the six intake statuses of 0683 (RECEIVED,
-- UNDER_REVIEW, CLARIFICATION_REQUIRED, QUOTED, CONVERTED_TO_OPPORTUNITY,
-- CLOSED_NO_ACTION). 14511 backfilled `stage` from it, and since then the
-- request service only kept it in step for the screens that still read it. PR 6
-- moved the last reader onto `stage`, and PR 7 removed the writes that kept it
-- in step, together with the old `POST /quote-requests/:id/transition` route.
--
--   quote_request_status_check   its CHECK (0683)
--   ix_quote_request_status      its index (0683)
--   quote_request.status         the column
--
-- The trigger that rewrote it (trg_quote_request_sync_converted) went in 14590.
-- ============================================================================

-- DESTRUCTIVE: the vocabulary goes with the column; stage has its own (14511)
ALTER TABLE IF EXISTS quote_request DROP CONSTRAINT IF EXISTS quote_request_status_check;

-- DESTRUCTIVE: the index served only the column dropped below
DROP INDEX IF EXISTS ix_quote_request_status;

-- DESTRUCTIVE: every request carries its stage (14511 backfilled it from this column); nothing reads or writes it since PR 7
ALTER TABLE IF EXISTS quote_request DROP COLUMN IF EXISTS status;

-- DOWN
-- IRREVERSIBLE: the column's values are gone; `stage` holds what each meant
-- (14511's mapping). Restoring them means restoring the pre-deploy dump. To
-- restore only the SHAPE, re-add the column, CHECK and index as 0683 declares
-- them; every row then reads RECEIVED, which is wrong for most of them.
