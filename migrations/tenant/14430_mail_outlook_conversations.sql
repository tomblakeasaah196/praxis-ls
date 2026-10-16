-- ============================================================================
-- TENANT DB — 14430 Outlook mail is grouped into its conversations.
--
-- The engine keyed every Microsoft message on its own id, because it never
-- read Graph's `conversationId`: each Outlook message was a conversation of
-- one. Once Sent synced (14420), a reply sent from Outlook sat apart from the
-- message it answered. New Outlook mail now joins its conversation, and a
-- one-time pass groups the mail already stored (owner decision, 15 Oct 2026).
--
-- ── email_connection.conversation_pass ──────────────────────────────────────
--
-- Where that one-time pass is, for one mailbox, so it resumes across syncs on
-- a large mailbox rather than starting again:
--
--   NULL                                   not started
--   {"folders": {"<folder id>": "<link>"}}  part way; "done" for a finished folder
--   {"done": true}                         finished, never runs again
--
-- No backfill and no CHECK (see 13794): NULL is the honest state of every row,
-- and the sync engine is the only writer.
-- ============================================================================

ALTER TABLE email_connection ADD COLUMN IF NOT EXISTS conversation_pass jsonb;

-- DOWN
-- ALTER TABLE email_connection DROP COLUMN IF EXISTS conversation_pass;
