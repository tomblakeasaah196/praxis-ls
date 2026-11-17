-- ============================================================================
-- TENANT DB — 14512 Sales lean revamp, PR 2: every request sits on ONE company
-- row, and a client has exactly one (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §4.1,
-- §4.2; owner decisions D2 and D11).
--
-- In order, because each step needs the one before it:
--
--   1. The source vocabulary is redrawn (PR 1 left it to this PR): CAMPAIGN
--      leaves with Campaigns, PORTAL and EMAIL arrive because a row can now be
--      created by a portal request or a converted mail. A row that said
--      CAMPAIGN becomes MANUAL and keeps the old word in details_json.
--   2. A client that a request or an opportunity names, and that has no row,
--      gets one (as a Client: client_id set, its account manager the owner).
--   3. A request with neither a row nor a client is filed on the row whose
--      email, phone or company matches (the same three keys as the duplicate
--      check, 14510), or on a new prospect row made from what the requester
--      typed. Oldest request first, so the second request from one address
--      lands on the row the first one made.
--   4. An opportunity that no request points at becomes a request (channel
--      MANUAL, titled with its name) on its lead, its client's row, or a new
--      prospect row named after it. `converted_opportunity_id` is set on the
--      new request, so an old opportunity link or notification resolves to it.
--   5. A client with several rows keeps the OLDEST. Everything that pointed at
--      the others (requests, meetings, proposals, opportunities, enquiries,
--      workspace tasks and events, bound mail threads) moves to it; the others
--      are archived with merged_into_lead_id set and their client cleared.
--   6. One row per client becomes a unique index.
--   7. `quote_request.lead_id` becomes NOT NULL: every request has its row.
--   8. A quotation reached only through an opportunity gets that opportunity's
--      request in `quote_request_id` (§4.2), the one link from here on.
--   9. A prospect row this migration made whose every request is already won
--      or lost is archived: nobody is working it, and an open row owes a next
--      step (14515).
-- ============================================================================

-- ── 1. the source vocabulary ───────────────────────────────────────────────

UPDATE lead
   SET details_json = COALESCE(details_json, '{}'::jsonb) || jsonb_build_object('source_before_14512', 'CAMPAIGN'),
       source = 'MANUAL'
 WHERE source = 'CAMPAIGN';
UPDATE lead SET intake_channel = 'MANUAL' WHERE intake_channel = 'CAMPAIGN';
UPDATE quote_request SET intake_channel = 'MANUAL' WHERE intake_channel = 'CAMPAIGN';

-- DESTRUCTIVE: CAMPAIGN leaves the lead source vocabulary with Campaigns (D10); ck_lead_source below replaces the check
ALTER TABLE lead DROP CONSTRAINT IF EXISTS lead_source_check;
-- DESTRUCTIVE: CAMPAIGN leaves the lead channel vocabulary with Campaigns (D10); the check is re-added below with PORTAL and EMAIL
ALTER TABLE lead DROP CONSTRAINT IF EXISTS ck_lead_intake_channel;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t     ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE c.conname = 'ck_lead_source' AND t.relname = 'lead' AND n.nspname = current_schema()
  ) THEN
    ALTER TABLE lead ADD CONSTRAINT ck_lead_source
      CHECK (source IN ('MANUAL', 'WEBSITE', 'PORTAL', 'EMAIL', 'REFERRAL'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t     ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE c.conname = 'ck_lead_intake_channel' AND t.relname = 'lead' AND n.nspname = current_schema()
  ) THEN
    ALTER TABLE lead ADD CONSTRAINT ck_lead_intake_channel
      CHECK (intake_channel IN ('MANUAL', 'WEBSITE', 'PORTAL', 'EMAIL', 'REFERRAL'));
  END IF;
END $$;

-- ── 2. a row for every client a request or an opportunity names ────────────

INSERT INTO lead (
  company_name, email, phone, country, address, niu, rccm, source, intake_channel,
  status, owner_user_id, client_id, entity_id, details_json
)
SELECT cm.name, cm.email, cm.phone, cm.country_code, cm.address, cm.niu, cm.rccm,
       'MANUAL', 'MANUAL', 'OPEN', cm.relationship_manager_user_id, cm.client_id, cm.entity_id,
       jsonb_build_object('created_by_migration', '14512')
  FROM client_master cm
 WHERE cm.client_id IN (
         SELECT q.client_id FROM quote_request q
          WHERE q.lead_id IS NULL AND q.client_id IS NOT NULL
         UNION
         SELECT o.client_id FROM opportunity o
          WHERE o.lead_id IS NULL AND o.client_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM quote_request q2 WHERE q2.converted_opportunity_id = o.opportunity_id)
       )
   AND NOT EXISTS (SELECT 1 FROM lead l WHERE l.client_id = cm.client_id)
ON CONFLICT DO NOTHING;

-- A client's requests go onto the client's row (the oldest, before step 5
-- merges any others into it).
UPDATE quote_request q
   SET lead_id = (SELECT l.lead_id FROM lead l
                   WHERE l.client_id = q.client_id AND l.merged_into_lead_id IS NULL
                   ORDER BY l.created_at, l.lead_id LIMIT 1)
 WHERE q.lead_id IS NULL
   AND q.client_id IS NOT NULL;

-- ── 3. a prospect's requests go onto the row its contact details match ──────

DO $$
DECLARE
  r     record;
  found uuid;
  ekey  text;
  pkey  text;
  ckey  text;
  digits text;
BEGIN
  FOR r IN
    SELECT q.quote_request_id, q.requester_name, q.requester_company, q.requester_email::text AS requester_email,
           q.requester_phone, q.public_ref, q.intake_channel, q.owner_user_id, q.entity_id
      FROM quote_request q
     WHERE q.lead_id IS NULL
     ORDER BY q.created_at, q.quote_request_id
  LOOP
    ekey   := NULLIF(search_fold(r.requester_email), '');
    digits := regexp_replace(COALESCE(r.requester_phone, ''), '[^0-9]', '', 'g');
    pkey   := CASE WHEN length(digits) >= 7 THEN right(digits, 9) END;
    ckey   := NULLIF(regexp_replace(search_fold(r.requester_company), '[^a-z0-9]+', '', 'g'), '');
    found  := NULL;

    IF ekey IS NOT NULL THEN
      SELECT l.lead_id INTO found FROM lead l
       WHERE l.merged_into_lead_id IS NULL AND l.email IS NOT NULL AND search_fold(l.email::text) = ekey
       ORDER BY (l.client_id IS NOT NULL) DESC, (l.status = 'OPEN') DESC, l.created_at, l.lead_id
       LIMIT 1;
    END IF;
    IF found IS NULL AND pkey IS NOT NULL THEN
      SELECT l.lead_id INTO found FROM lead l
       WHERE l.merged_into_lead_id IS NULL AND l.phone IS NOT NULL
         AND length(regexp_replace(l.phone, '[^0-9]', '', 'g')) >= 7
         AND right(regexp_replace(l.phone, '[^0-9]', '', 'g'), 9) = pkey
       ORDER BY (l.client_id IS NOT NULL) DESC, (l.status = 'OPEN') DESC, l.created_at, l.lead_id
       LIMIT 1;
    END IF;
    IF found IS NULL AND ckey IS NOT NULL THEN
      SELECT l.lead_id INTO found FROM lead l
       WHERE l.merged_into_lead_id IS NULL
         AND regexp_replace(search_fold(l.company_name), '[^a-z0-9]+', '', 'g') = ckey
       ORDER BY (l.client_id IS NOT NULL) DESC, (l.status = 'OPEN') DESC, l.created_at, l.lead_id
       LIMIT 1;
    END IF;

    IF found IS NULL THEN
      INSERT INTO lead (
        company_name, contact_name, email, phone, source, intake_channel, status,
        owner_user_id, entity_id, details_json
      ) VALUES (
        COALESCE(NULLIF(btrim(r.requester_company), ''), NULLIF(btrim(r.requester_name), ''),
                 NULLIF(btrim(r.requester_email), ''), r.public_ref, 'Request'),
        NULLIF(btrim(r.requester_name), ''),
        NULLIF(btrim(r.requester_email), ''),
        NULLIF(btrim(r.requester_phone), ''),
        CASE WHEN r.intake_channel IN ('MANUAL', 'WEBSITE', 'PORTAL', 'EMAIL', 'REFERRAL') THEN r.intake_channel ELSE 'MANUAL' END,
        CASE WHEN r.intake_channel IN ('MANUAL', 'WEBSITE', 'PORTAL', 'EMAIL', 'REFERRAL') THEN r.intake_channel ELSE 'MANUAL' END,
        'OPEN', r.owner_user_id, r.entity_id,
        jsonb_build_object('created_by_migration', '14512')
      )
      RETURNING lead_id INTO found;
    END IF;

    UPDATE quote_request SET lead_id = found WHERE quote_request_id = r.quote_request_id;
  END LOOP;
END $$;

-- ── 4. an opportunity no request points at becomes a request ───────────────
--
-- The new request names the opportunity it came from, which makes the
-- trigger that stamps an opportunity's source (0683) rewrite that
-- opportunity's history. It is switched off for these inserts only; the
-- statement and the switch roll back together if anything fails.

ALTER TABLE quote_request DISABLE TRIGGER trg_quote_request_stamp_opportunity_source;

DO $$
DECLARE
  o      record;
  target uuid;
BEGIN
  FOR o IN
    SELECT op.* FROM opportunity op
     WHERE NOT EXISTS (SELECT 1 FROM quote_request q WHERE q.converted_opportunity_id = op.opportunity_id)
     ORDER BY op.created_at, op.opportunity_id
  LOOP
    target := o.lead_id;
    IF target IS NULL AND o.client_id IS NOT NULL THEN
      SELECT l.lead_id INTO target FROM lead l
       WHERE l.client_id = o.client_id AND l.merged_into_lead_id IS NULL
       ORDER BY l.created_at, l.lead_id LIMIT 1;
    END IF;
    IF target IS NULL THEN
      INSERT INTO lead (company_name, source, intake_channel, status, owner_user_id, details_json)
      VALUES (o.name, 'MANUAL', 'MANUAL', 'OPEN', o.owner_user_id,
              jsonb_build_object('created_by_migration', '14512', 'from_opportunity', o.opportunity_id))
      RETURNING lead_id INTO target;
    END IF;

    INSERT INTO quote_request (
      lead_id, client_id, entity_id, intake_channel, requester_company, title,
      stage, estimated_value, currency, owner_user_id, dossier_id, settled_at,
      lost_reason_code, lost_reason, cargo_description, converted_opportunity_id, created_at
    )
    SELECT target, o.client_id, l.entity_id, 'MANUAL', l.company_name, o.name,
           CASE
             WHEN o.status = 'WON' THEN 'WON'
             WHEN o.status = 'LOST' THEN 'LOST'
             WHEN EXISTS (SELECT 1 FROM quotation qt WHERE qt.opportunity_id = o.opportunity_id)
               OR EXISTS (SELECT 1 FROM proposal p WHERE p.opportunity_id = o.opportunity_id
                                                     AND p.status IN ('SENT', 'ACCEPTED', 'REJECTED'))
               THEN 'QUOTED'
             ELSE 'CONTACTED'
           END,
           o.estimated_value, o.currency, o.owner_user_id, o.dossier_id,
           CASE WHEN o.status IN ('WON', 'LOST') THEN COALESCE(o.settled_at, o.updated_at) END,
           CASE WHEN o.status = 'LOST' THEN 'OTHER' END,
           CASE WHEN o.status = 'LOST' THEN 'Lost in the pipeline' END,
           o.scope_summary, o.opportunity_id, o.created_at
      FROM lead l
     WHERE l.lead_id = target;
  END LOOP;
END $$;

ALTER TABLE quote_request ENABLE TRIGGER trg_quote_request_stamp_opportunity_source;

-- ── 5. a client keeps ONE row: the oldest ──────────────────────────────────

DO $$
DECLARE
  c      record;
  keeper uuid;
  others uuid[];
  any_open boolean;
BEGIN
  FOR c IN
    SELECT l.client_id FROM lead l
     WHERE l.client_id IS NOT NULL AND l.merged_into_lead_id IS NULL
     GROUP BY l.client_id HAVING count(*) > 1
  LOOP
    SELECT l.lead_id INTO keeper FROM lead l
     WHERE l.client_id = c.client_id AND l.merged_into_lead_id IS NULL
     ORDER BY l.created_at, l.lead_id LIMIT 1;
    SELECT array_agg(l.lead_id), bool_or(l.status = 'OPEN') INTO others, any_open FROM lead l
     WHERE l.client_id = c.client_id AND l.merged_into_lead_id IS NULL AND l.lead_id <> keeper;

    UPDATE quote_request   SET lead_id = keeper WHERE lead_id = ANY (others);
    UPDATE meeting         SET lead_id = keeper WHERE lead_id = ANY (others);
    UPDATE proposal        SET lead_id = keeper WHERE lead_id = ANY (others);
    UPDATE opportunity     SET lead_id = keeper WHERE lead_id = ANY (others);
    UPDATE contact_enquiry SET lead_id = keeper WHERE lead_id = ANY (others);
    UPDATE task            SET entity_id = keeper WHERE entity_type = 'lead' AND entity_id = ANY (others);
    UPDATE calendar_event  SET entity_id = keeper WHERE entity_type = 'lead' AND entity_id = ANY (others);
    UPDATE email_thread    SET entity_ref = 'lead:' || keeper
     WHERE entity_ref IN (SELECT 'lead:' || x FROM unnest(others) AS x);

    -- The rows that were folded in. Their client is cleared so the unique
    -- index below holds; merged_into_lead_id keeps the way back.
    UPDATE lead
       SET status = 'ARCHIVED',
           archived_reason = 'Merged into the company''s main row',
           archived_at = COALESCE(archived_at, now()),
           merged_into_lead_id = keeper,
           client_id = NULL,
           next_step_task_id = NULL
     WHERE lead_id = ANY (others);

    IF any_open THEN
      UPDATE lead SET status = 'OPEN', archived_reason = NULL, archived_at = NULL WHERE lead_id = keeper;
    END IF;
  END LOOP;
END $$;

-- ── 6. one row per client ──────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS ux_lead_client ON lead (client_id) WHERE client_id IS NOT NULL;

-- ── 7. every request has its row ───────────────────────────────────────────

-- DESTRUCTIVE: steps 2 to 4 above gave every request a company row, so no existing row is null; a request can no longer be filed without one (§4.2)
ALTER TABLE quote_request ALTER COLUMN lead_id SET NOT NULL;

-- ── 8. a quotation's one link is its request ───────────────────────────────

UPDATE quotation qt
   SET quote_request_id = q.quote_request_id
  FROM quote_request q
 WHERE qt.quote_request_id IS NULL
   AND qt.opportunity_id IS NOT NULL
   AND q.converted_opportunity_id = qt.opportunity_id;

-- ── 9. a prospect row made here with nothing open is archived ──────────────

UPDATE lead l
   SET status = 'ARCHIVED',
       archived_reason = 'Closed before the revamp',
       archived_at = COALESCE(l.archived_at, now())
 WHERE l.details_json ->> 'created_by_migration' = '14512'
   AND l.client_id IS NULL
   AND l.status = 'OPEN'
   AND NOT EXISTS (SELECT 1 FROM quote_request q
                    WHERE q.lead_id = l.lead_id AND q.stage NOT IN ('WON', 'LOST'));

-- DOWN
-- DROP INDEX IF EXISTS ux_lead_client;
-- ALTER TABLE quote_request ALTER COLUMN lead_id DROP NOT NULL;
-- ALTER TABLE lead DROP CONSTRAINT IF EXISTS ck_lead_intake_channel;
-- ALTER TABLE lead DROP CONSTRAINT IF EXISTS ck_lead_source;
-- ALTER TABLE lead ADD CONSTRAINT lead_source_check
--   CHECK (source IN ('MANUAL', 'WEBSITE', 'REFERRAL', 'CAMPAIGN'));
-- ALTER TABLE lead ADD CONSTRAINT ck_lead_intake_channel
--   CHECK (intake_channel IN ('WEBSITE', 'MANUAL', 'REFERRAL', 'CAMPAIGN'));
--   (after moving PORTAL and EMAIL rows back to MANUAL)
-- IRREVERSIBLE in part: the merges of step 5 and the rows made in steps 2 to
-- 4 are not undone by the statements above. A merged row still names its main
-- row (merged_into_lead_id) and every row made here carries
-- details_json.created_by_migration = '14512', so they can be found; moving
-- children back to the row they came from needs the pre-deploy dump.
