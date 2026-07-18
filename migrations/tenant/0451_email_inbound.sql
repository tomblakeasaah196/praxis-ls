-- Inbound mail store — replies/messages received into a sender identity's mailbox.
-- Fed by an inbound webhook/IMAP intake (wired later); read by Comms → Mail → Inbox.
CREATE TABLE IF NOT EXISTS email_inbound (
  email_inbound_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_identity_id uuid REFERENCES email_identity(email_identity_id),
  from_address      citext NOT NULL,
  to_address        citext,
  subject           text,
  body_preview      text,
  entity_ref        text,
  is_read           boolean NOT NULL DEFAULT false,
  received_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_email_inbound_recent ON email_inbound(received_at DESC);
