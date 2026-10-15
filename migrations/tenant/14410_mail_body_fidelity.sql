-- ============================================================================
-- TENANT DB — 14410 A received email looks the way its sender made it.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
--
-- The ingest sanitizer kept sanitize-html's DEFAULT allow-list, which has no
-- `style` attribute, no table attributes and no `<style>` block. Every message
-- was flattened before it was written, and the flattened copy was the only one
-- kept, so nothing could ever be put back. See `mail/body-html.js`.
--
-- ── email_message.body_html_original ────────────────────────────────────────
--
-- The sender's HTML exactly as it arrived. NEVER rendered and never returned
-- by a list or a thread read: `body_html` is what the reading pane draws, and
-- `body_html` is what passes the sanitizer. This column exists so that the
-- next change to the sanitizer is a re-run over stored data rather than a
-- re-fetch of every message from Gmail, Microsoft and IMAP, which is what this
-- change has to do for the mail stored before it.
--
-- ── email_message.body_policy ───────────────────────────────────────────────
--
-- Which version of the sanitizer produced `body_html`. NULL means "before
-- 14410": flattened, with no original. Opening such a message re-fetches it
-- from the provider once (repair on open, owner decision 15 Oct 2026). A row
-- stamped LOWER than the current version is re-cleaned from its original.
--
-- No backfill. A data UPDATE over every message in every tenant would rewrite
-- the largest table in the product to mark rows that are already identifiable
-- by their NULL, and repair on open touches only the mail somebody reads.
--
-- ── email_message.body_repair_failed_at ─────────────────────────────────────
--
-- The provider no longer has the message (deleted, moved out of reach, a
-- revoked token). Recorded so a thread of forty legacy messages does not ask
-- the provider forty times on every open; the service waits a day between
-- attempts.
--
-- ── email_image_trust ───────────────────────────────────────────────────────
--
-- §5.6.3: "a per-sender 'always show' that is stored per user". Per USER,
-- because a remote image is a read receipt for the person who opens it, and one
-- colleague's choice to let a supplier see when they read its mail is not a
-- choice for the whole mailbox. Lowercased on write and checked here, because
-- `Client@Maersk.CM` and `client@maersk.cm` are one sender (see knownParty).
-- ============================================================================

ALTER TABLE email_message ADD COLUMN IF NOT EXISTS body_html_original text;
ALTER TABLE email_message ADD COLUMN IF NOT EXISTS body_policy smallint;
ALTER TABLE email_message ADD COLUMN IF NOT EXISTS body_repair_failed_at timestamptz;

CREATE TABLE IF NOT EXISTS email_image_trust (
  email_image_trust_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  sender_address       text NOT NULL CHECK (sender_address = lower(sender_address)),
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, sender_address)
);

-- DOWN
-- DROP TABLE IF EXISTS email_image_trust;
-- ALTER TABLE email_message DROP COLUMN IF EXISTS body_repair_failed_at;
-- ALTER TABLE email_message DROP COLUMN IF EXISTS body_policy;
-- ALTER TABLE email_message DROP COLUMN IF EXISTS body_html_original;
