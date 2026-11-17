-- ============================================================================
-- TENANT DB — 14510 Sales lean revamp, PR 2: the lead is the COMPANY ROW
-- (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §4.1, owner decisions D2 and D11).
--
-- One row per company. Searching "TotalEnergies" returns that company once,
-- whatever it has asked for; each thing it asks for is a request on that row
-- (14511). The lead's own five-step funnel (NEW, CONTACTED, QUALIFIED,
-- CONVERTED, LOST) is gone: the stage of a deal lives on its request now, and
-- the row only says whether it is still being worked.
--
--   status            OPEN | ARCHIVED. NEW, CONTACTED, QUALIFIED and
--                     CONVERTED become OPEN; LOST becomes ARCHIVED.
--   archived_reason   why it was archived, said by a person (a lost lead from
--                     before this migration says so).
--   archived_at       when.
--   merged_into_lead_id
--                     set on a row 14512 folded into its company's main row,
--                     so an old link to it still finds the company.
--   next_step_task_id the current next step: an ordinary workspace task
--                     (§4.4). The lead service is its only writer.
--
-- Prospect or Client is not a column: it is `client_id IS NULL`.
--
-- THE DUPLICATE KEYS (§3.2, "duplicate check as you type"). Three expression
-- indexes, one per key, each written exactly as the lead repo queries it:
--
--   email    search_fold(email)                            exact
--   phone    the last nine digits of the number            exact, so "+237 6 99
--            (only when it has at least seven)             00 11 22" and
--                                                           "699001122" meet
--   company  search_fold(company_name) with everything     exact, so "Total
--            but letters and digits removed                 Energies" and
--                                                           "TOTALENERGIES" meet
--
-- search_fold is 14382's, the same fold ⌘K searches with.
--
-- NO CHECK AND NO FOREIGN KEY ON THESE COLUMNS. A constraint added to an
-- existing table above 13791 aborts provisioning a fresh tenant (13791's
-- sandbox repair mirrors live's constraints before sandbox has the columns;
-- tests/unit/migration-constraint-ordering.test.js, 13794 and 14310 explain).
-- So the old five-value CHECK is dropped and not replaced, and the rules are
-- held where every write already passes:
--
--   status OPEN | ARCHIVED     @praxis/shared lead.STATUSES, lead.rules, and the
--                              lead service, the only writer of `status`
--   an archive has a reason    lead.archive validator (required) and service
--   next_step_task_id          written only by the lead service, from a task it
--                              has just created; a deleted task reads as no
--                              next step (every read joins on a live task)
--   merged_into_lead_id        written only by 14512, from a row it has just read
-- ============================================================================

-- ── 1. status: OPEN or ARCHIVED ────────────────────────────────────────────

ALTER TABLE lead ADD COLUMN IF NOT EXISTS archived_reason text;
ALTER TABLE lead ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE lead ADD COLUMN IF NOT EXISTS merged_into_lead_id uuid;
ALTER TABLE lead ADD COLUMN IF NOT EXISTS next_step_task_id uuid;

-- The old five-value CHECK goes first, or the backfill below cannot write OPEN.
-- DESTRUCTIVE: the five-step lead funnel is retired (D3); the lead service holds OPEN | ARCHIVED from here, and the backfill keeps LOST as ARCHIVED
ALTER TABLE lead DROP CONSTRAINT IF EXISTS lead_status_check;

UPDATE lead
   SET archived_reason = COALESCE(archived_reason, 'Lost'),
       archived_at     = COALESCE(archived_at, updated_at)
 WHERE status = 'LOST';
UPDATE lead SET status = 'ARCHIVED' WHERE status = 'LOST';
UPDATE lead SET status = 'OPEN' WHERE status IN ('NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED');

ALTER TABLE lead ALTER COLUMN status SET DEFAULT 'OPEN';

COMMENT ON COLUMN lead.status IS
  'OPEN or ARCHIVED (14510), held by the lead service (no CHECK above 13791). The stage of a deal lives on its request (quote_request.stage); Prospect or Client is client_id IS NULL.';
COMMENT ON COLUMN lead.next_step_task_id IS
  'The current next step: a workspace task (entity_type lead). Written only by the lead service, which refuses an OPEN lead without one unless it is a client with no open request (14510, guide §4.4).';
COMMENT ON COLUMN lead.merged_into_lead_id IS
  'Set when this row was folded into its company''s main row (14512). An old link to it opens the main row.';

-- ── 2. the lists' indexes ──────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS ix_lead_status_owner ON lead (status, owner_user_id);
CREATE INDEX IF NOT EXISTS ix_lead_next_step ON lead (next_step_task_id) WHERE next_step_task_id IS NOT NULL;

-- ── 3. the duplicate keys ──────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS ix_lead_dup_email
  ON lead (search_fold(email::text))
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_lead_dup_phone
  ON lead (right(regexp_replace(phone, '[^0-9]', '', 'g'), 9))
  WHERE phone IS NOT NULL AND length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 7;

CREATE INDEX IF NOT EXISTS ix_lead_dup_company
  ON lead (regexp_replace(search_fold(company_name), '[^a-z0-9]+', '', 'g'));

-- DOWN
-- DROP INDEX IF EXISTS ix_lead_dup_company;
-- DROP INDEX IF EXISTS ix_lead_dup_phone;
-- DROP INDEX IF EXISTS ix_lead_dup_email;
-- DROP INDEX IF EXISTS ix_lead_next_step;
-- DROP INDEX IF EXISTS ix_lead_status_owner;
-- UPDATE lead SET status = 'LOST' WHERE status = 'ARCHIVED';
-- UPDATE lead SET status = CASE WHEN client_id IS NOT NULL THEN 'CONVERTED' ELSE 'NEW' END WHERE status = 'OPEN';
-- ALTER TABLE lead ALTER COLUMN status SET DEFAULT 'NEW';
-- ALTER TABLE lead ADD CONSTRAINT lead_status_check
--   CHECK (status IN ('NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST'));
-- ALTER TABLE lead DROP COLUMN IF EXISTS next_step_task_id;
-- ALTER TABLE lead DROP COLUMN IF EXISTS merged_into_lead_id;
-- ALTER TABLE lead DROP COLUMN IF EXISTS archived_at;
-- ALTER TABLE lead DROP COLUMN IF EXISTS archived_reason;
-- The down loses which open leads were CONTACTED or QUALIFIED: that
-- distinction is not kept anywhere after the UP. Restore the dump for it.
