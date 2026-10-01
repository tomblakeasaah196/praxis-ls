-- ============================================================================
-- TENANT DB — 14261 Who is told about a client, and what the client was sent
-- (tenant review of 29 Sep 2026, PR 1, register items 1.4, 1.5, 1.13, owner
-- decisions D3, D7, D8).
--
-- ── "ALSO NOTIFY" ──────────────────────────────────────────────────────────
--
-- The people told when a client writes, sends a document, reports a payment
-- or asks for a quote are: the client's account manager (14200), the CEO-role
-- users (as today), and — new — any extra people picked for that client.
-- `client_notify_person` is that third list: one row per client and login.
--
-- It references the LOGIN (`app_user`), not the employee, because a login is
-- what an alert reaches; the routing reads only ACTIVE logins, so a person who
-- leaves drops out of every list on their own, with nothing to clean up. Every
-- change is audited by the service (account_manager.service setAlsoNotify).
--
-- ── A QUOTE TOPIC FOR THE CLIENT'S SWITCHES ────────────────────────────────
--
-- A client who asked for a quote in the portal is now told it arrived, and
-- told when it needs clarification or is quoted. That is a sixth topic,
-- QUOTES, beside MESSAGES, REQUESTS, BILLING, PROPOSALS and SHIPMENTS.
--
-- The three 14180 tables spelled the five topics in a CHECK. A CHECK cannot be
-- widened in place, and one may not be ADDED to a pre-existing table above
-- 13791 (it aborts provisioning a new tenant — tests/unit/
-- migration-constraint-ordering.test.js), so the three are dropped and the
-- topic list is enforced where it is read and written: `TOPICS` in
-- portal_notify.service.js (the outbox writer only queues a known topic, the
-- sender refuses an unknown one) and `NOTIFY_TOPICS` in the portal validator
-- (the client's own switches). The channel CHECK on portal_notify_sent stays.
--
-- ── WHAT A CLIENT WAS SENT ─────────────────────────────────────────────────
--
-- Staff can now send any team message by email at once ("Send by email", D8),
-- and every team message shows whether it was emailed. Both read the ONE log
-- the portal sender already keeps, `portal_notify_sent`, rather than a second
-- one: a deliberate send is a claim there like any other, with two plain
-- columns saying which message it was and who sent it. Those rows are kept
-- when the thirty-day sweep runs — they are the record shown on the message.
-- ============================================================================

-- ── 1. Also notify ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_notify_person (
  client_id   uuid NOT NULL REFERENCES client_master(client_id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  added_by    uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_client_notify_person PRIMARY KEY (client_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_client_notify_person_user ON client_notify_person (user_id);

COMMENT ON TABLE client_notify_person IS
  'Extra people told about a client (D7 "Also notify"), beside its account manager and the CEO-role users. Read through ACTIVE logins only.';

-- ── 2. The QUOTES topic ───────────────────────────────────────────────────
ALTER TABLE portal_notify_setting DROP CONSTRAINT IF EXISTS ck_portal_notify_setting_email_off;
ALTER TABLE portal_notify_setting DROP CONSTRAINT IF EXISTS ck_portal_notify_setting_push_off;
ALTER TABLE portal_notify_outbox  DROP CONSTRAINT IF EXISTS ck_portal_notify_outbox_topic;
ALTER TABLE portal_notify_sent    DROP CONSTRAINT IF EXISTS ck_portal_notify_sent_topic;

-- ── 3. A deliberate send, recorded where every send is ────────────────────
ALTER TABLE portal_notify_sent
  ADD COLUMN IF NOT EXISTS message_id uuid,
  ADD COLUMN IF NOT EXISTS sent_by uuid;

COMMENT ON COLUMN portal_notify_sent.message_id IS
  'Set on a deliberate "Send by email" of one team message (14261): the client_message it carried. Kept by the thirty-day sweep. Plain column (13791 rule).';
COMMENT ON COLUMN portal_notify_sent.sent_by IS
  'The staff login that pressed "Send by email" (14261). NULL for an automatic send.';

CREATE INDEX IF NOT EXISTS ix_portal_notify_sent_message
  ON portal_notify_sent (message_id) WHERE message_id IS NOT NULL;

-- DOWN
-- The topic CHECKs come back only once no QUOTES row exists; deliberate sends
-- lose their message link (the audit ledger still records each one).
--
--   ALTER TABLE portal_notify_sent DROP COLUMN IF EXISTS sent_by;
--   ALTER TABLE portal_notify_sent DROP COLUMN IF EXISTS message_id;
--   DROP INDEX IF EXISTS ix_portal_notify_sent_message;
--   DELETE FROM portal_notify_outbox WHERE topic = 'QUOTES';
--   DELETE FROM portal_notify_sent WHERE topic = 'QUOTES';
--   UPDATE portal_notify_setting SET email_off = array_remove(email_off, 'QUOTES'), push_off = array_remove(push_off, 'QUOTES');
--   ALTER TABLE portal_notify_outbox ADD CONSTRAINT ck_portal_notify_outbox_topic
--     CHECK (topic IN ('MESSAGES','REQUESTS','BILLING','PROPOSALS','SHIPMENTS'));
--   ALTER TABLE portal_notify_sent ADD CONSTRAINT ck_portal_notify_sent_topic
--     CHECK (topic IN ('MESSAGES','REQUESTS','BILLING','PROPOSALS','SHIPMENTS','TEST'));
--   ALTER TABLE portal_notify_setting ADD CONSTRAINT ck_portal_notify_setting_email_off
--     CHECK (email_off <@ ARRAY['MESSAGES','REQUESTS','BILLING','PROPOSALS','SHIPMENTS']::text[]);
--   ALTER TABLE portal_notify_setting ADD CONSTRAINT ck_portal_notify_setting_push_off
--     CHECK (push_off <@ ARRAY['MESSAGES','REQUESTS','BILLING','PROPOSALS','SHIPMENTS']::text[]);
--   DROP TABLE IF EXISTS client_notify_person;
