-- ============================================================================
-- TENANT DB — 14511 Sales lean revamp, PR 2: the request IS the deal
-- (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §4.2, owner decisions D3 and D11).
--
-- A request was a quote request (six intake statuses) that was then
-- "converted" into an opportunity (OPEN, WON, LOST plus configurable stages).
-- One job, two records, and the screen a salesperson opened depended on which
-- half of the job they were doing. The request now carries the deal itself:
--
--   stage             NEW, CONTACTED, MEETING, QUOTED, WON, LOST — fixed
--   title             what a request typed by hand is called
--   estimated_value   the deal's value, and its currency
--   currency
--   lost_reason_code  PRICE, TIMING, COMPETITOR, NO_RESPONSE, OTHER, and a line
--   lost_reason
--   settled_at        when it was won or lost
--   dossier_id        the operations file a win opened
--
-- `incoterm` becomes nullable: a request typed by hand on the phone may not
-- know one yet. The shared validator still requires it for WEBSITE and PORTAL.
--
-- `status`, `converted_opportunity_id` and the trigger that keeps them in step
-- STAY until PR 7: the Quote Requests and Opportunities screens read them until
-- PR 3 replaces those screens, and the request service keeps `status` in step
-- with `stage` so they keep telling the truth.
--
-- THE BACKFILL, from `status`:
--
--   RECEIVED                              NEW
--   UNDER_REVIEW, CLARIFICATION_REQUIRED  CONTACTED
--   QUOTED                                QUOTED
--   CLOSED_NO_ACTION                      LOST, reason NO_RESPONSE "No response"
--   CONVERTED_TO_OPPORTUNITY              from the opportunity it became:
--        WON   WON
--        LOST  LOST, reason OTHER "Lost in the pipeline"
--        OPEN  QUOTED when anything priced answers it (a quotation, or a
--              proposal that was sent), CONTACTED otherwise
--     and the opportunity's value, currency, owner, file and settle date are
--     copied across.
--
-- Opportunities that no request points at become requests in 14512, once every
-- request has a company row to sit on.
-- ============================================================================

-- ── 1. the columns ─────────────────────────────────────────────────────────

ALTER TABLE quote_request ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'NEW';
ALTER TABLE quote_request ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE quote_request ADD COLUMN IF NOT EXISTS estimated_value numeric(18,2);
ALTER TABLE quote_request ADD COLUMN IF NOT EXISTS currency char(3) REFERENCES currency(code);
ALTER TABLE quote_request ADD COLUMN IF NOT EXISTS lost_reason_code text;
ALTER TABLE quote_request ADD COLUMN IF NOT EXISTS lost_reason text;
ALTER TABLE quote_request ADD COLUMN IF NOT EXISTS settled_at timestamptz;
ALTER TABLE quote_request ADD COLUMN IF NOT EXISTS dossier_id uuid REFERENCES dossier(dossier_id);

-- A phone request may not know its Incoterm yet (the validator still demands
-- one from the website and the portal, whose wizards ask).
ALTER TABLE quote_request ALTER COLUMN incoterm DROP NOT NULL;

-- ── 2. the backfill ────────────────────────────────────────────────────────
--
-- Only rows still at the column default are touched, so a re-run after a
-- partial apply never overwrites a stage the service has since moved.

UPDATE quote_request q
   SET stage = 'CONTACTED'
 WHERE q.stage = 'NEW'
   AND q.status IN ('UNDER_REVIEW', 'CLARIFICATION_REQUIRED');

UPDATE quote_request q
   SET stage = 'QUOTED'
 WHERE q.stage = 'NEW'
   AND q.status = 'QUOTED';

UPDATE quote_request q
   SET stage            = 'LOST',
       lost_reason_code = 'NO_RESPONSE',
       lost_reason      = 'No response',
       settled_at       = COALESCE(q.settled_at, q.updated_at)
 WHERE q.stage = 'NEW'
   AND q.status = 'CLOSED_NO_ACTION';

-- Converted requests take the deal from the opportunity they became.
UPDATE quote_request q
   SET stage = CASE
                 WHEN o.status = 'WON' THEN 'WON'
                 WHEN o.status = 'LOST' THEN 'LOST'
                 WHEN EXISTS (SELECT 1 FROM quotation qt
                               WHERE qt.quote_request_id = q.quote_request_id
                                  OR qt.opportunity_id = o.opportunity_id)
                   OR EXISTS (SELECT 1 FROM proposal p
                               WHERE p.opportunity_id = o.opportunity_id
                                 AND p.status IN ('SENT', 'ACCEPTED', 'REJECTED'))
                   THEN 'QUOTED'
                 ELSE 'CONTACTED'
               END,
       lost_reason_code = CASE WHEN o.status = 'LOST' THEN 'OTHER' ELSE q.lost_reason_code END,
       lost_reason      = CASE WHEN o.status = 'LOST' THEN 'Lost in the pipeline' ELSE q.lost_reason END,
       settled_at       = CASE WHEN o.status IN ('WON', 'LOST')
                               THEN COALESCE(o.settled_at, o.updated_at) ELSE NULL END,
       estimated_value  = COALESCE(q.estimated_value, o.estimated_value),
       currency         = COALESCE(q.currency, o.currency),
       owner_user_id    = COALESCE(q.owner_user_id, o.owner_user_id),
       dossier_id       = COALESCE(q.dossier_id, o.dossier_id),
       title            = COALESCE(q.title, o.name)
  FROM opportunity o
 WHERE o.opportunity_id = q.converted_opportunity_id
   AND q.stage = 'NEW'
   AND q.status = 'CONVERTED_TO_OPPORTUNITY';

-- ── 3. the rules, now that every row satisfies them ────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t     ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE c.conname = 'ck_quote_request_stage' AND t.relname = 'quote_request' AND n.nspname = current_schema()
  ) THEN
    ALTER TABLE quote_request ADD CONSTRAINT ck_quote_request_stage
      CHECK (stage IN ('NEW', 'CONTACTED', 'MEETING', 'QUOTED', 'WON', 'LOST'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t     ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE c.conname = 'ck_quote_request_lost_reason' AND t.relname = 'quote_request' AND n.nspname = current_schema()
  ) THEN
    -- A lost deal says why. The code is one of five; the line is optional.
    ALTER TABLE quote_request ADD CONSTRAINT ck_quote_request_lost_reason
      CHECK (
        (lost_reason_code IS NULL OR lost_reason_code IN ('PRICE', 'TIMING', 'COMPETITOR', 'NO_RESPONSE', 'OTHER'))
        AND (stage <> 'LOST' OR lost_reason_code IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t     ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE c.conname = 'ck_quote_request_settled' AND t.relname = 'quote_request' AND n.nspname = current_schema()
  ) THEN
    -- Won and lost are dated; an open stage is not.
    ALTER TABLE quote_request ADD CONSTRAINT ck_quote_request_settled
      CHECK ((stage IN ('WON', 'LOST')) = (settled_at IS NOT NULL));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t     ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE c.conname = 'ck_quote_request_value' AND t.relname = 'quote_request' AND n.nspname = current_schema()
  ) THEN
    ALTER TABLE quote_request ADD CONSTRAINT ck_quote_request_value
      CHECK (estimated_value IS NULL OR estimated_value >= 0);
  END IF;
END $$;

COMMENT ON COLUMN quote_request.stage IS
  'The deal''s stage (14511): NEW, CONTACTED, MEETING, QUOTED, WON, LOST. Fixed, never configurable. WON comes from an accepted quotation or Mark Won, which opens the operations file.';
COMMENT ON COLUMN quote_request.status IS
  'The pre-revamp intake status. Kept in step with stage by the request service until PR 7 drops it (14511).';

-- ── 4. the board's and the KPI's indexes ───────────────────────────────────

CREATE INDEX IF NOT EXISTS ix_quote_request_stage ON quote_request (stage);
CREATE INDEX IF NOT EXISTS ix_quote_request_lead_stage ON quote_request (lead_id, stage);
CREATE INDEX IF NOT EXISTS ix_quote_request_settled_won ON quote_request (settled_at DESC) WHERE stage = 'WON';
CREATE INDEX IF NOT EXISTS ix_quote_request_dossier ON quote_request (dossier_id) WHERE dossier_id IS NOT NULL;

-- DOWN
-- DROP INDEX IF EXISTS ix_quote_request_dossier;
-- DROP INDEX IF EXISTS ix_quote_request_settled_won;
-- DROP INDEX IF EXISTS ix_quote_request_lead_stage;
-- DROP INDEX IF EXISTS ix_quote_request_stage;
-- ALTER TABLE quote_request DROP CONSTRAINT IF EXISTS ck_quote_request_value;
-- ALTER TABLE quote_request DROP CONSTRAINT IF EXISTS ck_quote_request_settled;
-- ALTER TABLE quote_request DROP CONSTRAINT IF EXISTS ck_quote_request_lost_reason;
-- ALTER TABLE quote_request DROP CONSTRAINT IF EXISTS ck_quote_request_stage;
-- UPDATE quote_request SET incoterm = 'TBD' WHERE incoterm IS NULL;
-- ALTER TABLE quote_request ALTER COLUMN incoterm SET NOT NULL;
-- ALTER TABLE quote_request DROP COLUMN IF EXISTS dossier_id;
-- ALTER TABLE quote_request DROP COLUMN IF EXISTS settled_at;
-- ALTER TABLE quote_request DROP COLUMN IF EXISTS lost_reason;
-- ALTER TABLE quote_request DROP COLUMN IF EXISTS lost_reason_code;
-- ALTER TABLE quote_request DROP COLUMN IF EXISTS currency;
-- ALTER TABLE quote_request DROP COLUMN IF EXISTS estimated_value;
-- ALTER TABLE quote_request DROP COLUMN IF EXISTS title;
-- ALTER TABLE quote_request DROP COLUMN IF EXISTS stage;
-- `status` and the opportunity were never changed by the UP, so dropping the
-- new columns returns the pre-revamp shape exactly.
