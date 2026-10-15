-- ============================================================================
-- TENANT DB — 14420 Microsoft and Google mailboxes sync every folder, and a
-- failed sync says why after it has recovered.
--
-- ── email_connection.last_failure_at / last_failure_reason ──────────────────
--
-- `last_error` is the CURRENT error and is cleared by the next good sync, which
-- is right for the health pill and wrong for the question a person asks an hour
-- later: "why did Compose say no mailbox at 17:36?". By then the evidence had
-- gone. These two keep the most recent failure after the mailbox recovers, so
-- My Mailbox can say when it last failed and with what, and nobody has to catch
-- the error while it is still on screen.
--
-- ── email_connection.provider_id_scheme ─────────────────────────────────────
--
-- Which kind of message id the stored `external_message_id`s are. NULL is the
-- provider's default. Microsoft's default id CHANGES when a message moves
-- folder, so a message archived in Outlook came back as a second copy, and a
-- message sent from Praxis never matched its own Sent Items copy. Graph now asks
-- for immutable ids on every call; 'immutable' records that a mailbox's stored
-- ids were translated once (translateExchangeIds) before its first sync that
-- way, so the translation never runs twice and never runs half.
--
-- No backfill: NULL is the honest state of every existing row, and the sync
-- engine moves each Microsoft mailbox forward the first time it runs.
-- ============================================================================

ALTER TABLE email_connection ADD COLUMN IF NOT EXISTS last_failure_at timestamptz;
ALTER TABLE email_connection ADD COLUMN IF NOT EXISTS last_failure_reason text;
ALTER TABLE email_connection ADD COLUMN IF NOT EXISTS provider_id_scheme text;

-- No CHECK on provider_id_scheme: a constraint added to a table an earlier
-- migration created aborts provisioning a new tenant (see 13794 and
-- migration-constraint-ordering.test.js). The sync engine is its only writer,
-- and writes exactly NULL or 'immutable'.

-- DOWN
-- ALTER TABLE email_connection DROP COLUMN IF EXISTS provider_id_scheme;
-- ALTER TABLE email_connection DROP COLUMN IF EXISTS last_failure_reason;
-- ALTER TABLE email_connection DROP COLUMN IF EXISTS last_failure_at;
