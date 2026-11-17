-- ============================================================================
-- TENANT DB — 14513 Sales lean revamp, PR 2: what happened with a company
-- (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §4.3, §3.2 "The loop that makes it used").
--
-- A call, an email, a WhatsApp, a visit or a note, logged against the company
-- row and, when it was about one, a request. "Done" on a next step writes one
-- of these and the new next step in the same transaction.
--
-- Mail threads, quotation events and stage moves are NOT copied in here: the
-- lead's timeline reads them where they already live (email_thread, quotation,
-- the audit ledger). A second copy would be a second place to disagree.
-- ============================================================================

CREATE TABLE IF NOT EXISTS lead_activity (
  lead_activity_id uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          uuid        NOT NULL REFERENCES lead(lead_id) ON DELETE CASCADE,
  quote_request_id uuid        REFERENCES quote_request(quote_request_id) ON DELETE SET NULL,
  kind             text        NOT NULL CHECK (kind IN ('CALL', 'EMAIL', 'WHATSAPP', 'VISIT', 'NOTE')),
  body             text        NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  -- SET NULL, not CASCADE: a person leaving does not erase what they did with
  -- a client. The name is resolved when it is read.
  author_user_id   uuid        REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_lead_activity_lead ON lead_activity (lead_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_lead_activity_request ON lead_activity (quote_request_id) WHERE quote_request_id IS NOT NULL;

COMMENT ON TABLE lead_activity IS
  'What happened with a company: CALL, EMAIL, WHATSAPP, VISIT or NOTE, 1 to 2,000 characters (14513). Mail, quotation events and stage moves are read where they live, never copied here.';

-- DOWN
-- DROP INDEX IF EXISTS ix_lead_activity_request;
-- DROP INDEX IF EXISTS ix_lead_activity_lead;
-- DROP TABLE IF EXISTS lead_activity;
