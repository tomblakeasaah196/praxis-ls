-- ============================================================================
-- TENANT DB — 14620 Website messages: a reference, attachments, and a record of
-- the emails each message caused (SmartLS website v2, PR 2).
--
-- A website message (the floating message button, or the contact form) was a
-- `contact_enquiry` row and an in-app notification, and nothing else: no email
-- reached anybody, a visitor could not attach a file, and the "reference" shown
-- on screen was the row's UUID. This migration adds what the new path writes.
--
--   contact_enquiry.public_ref        MSG-XXXXXXXX, eight random Crockford
--                                     characters from crypto.randomBytes
--                                     (inbound_intake.reference.js). The thing
--                                     a visitor quotes on the phone and the
--                                     inbox email carries in its subject. It
--                                     opens nothing: it is a name, not a key.
--   contact_enquiry.origin_page       the website path the message was written
--                                     on, so the desk knows what they were
--                                     reading.
--   contact_enquiry.inbox_notified_at when the message reached the tenant's
--                                     website inbox by email
--   contact_enquiry.visitor_acked_at  when the visitor's acknowledgement left
--   contact_enquiry.mail_error        the last delivery failure, for the desk
--                                     (a message is never lost to a mail
--                                     failure: the row is the record)
--
--   contact_enquiry_attachment        one row per file the visitor attached,
--                                     each a vault document (doc_type
--                                     ENQUIRY_ATTACHMENT), in the order sent.
--
-- And two send points, so a tenant with no website sender mailbox can still
-- route these two emails in Settings › Email like any other:
--   site.enquiry.notify   the copy of a website message sent to the inbox
--   site.enquiry.ack      the acknowledgement sent to the visitor
-- ============================================================================

ALTER TABLE contact_enquiry ADD COLUMN IF NOT EXISTS public_ref        text;
ALTER TABLE contact_enquiry ADD COLUMN IF NOT EXISTS origin_page       text;
ALTER TABLE contact_enquiry ADD COLUMN IF NOT EXISTS inbox_notified_at timestamptz;
ALTER TABLE contact_enquiry ADD COLUMN IF NOT EXISTS visitor_acked_at  timestamptz;
ALTER TABLE contact_enquiry ADD COLUMN IF NOT EXISTS mail_error        text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_contact_enquiry_public_ref
  ON contact_enquiry (public_ref) WHERE public_ref IS NOT NULL;

-- No CHECK on the two new text columns: a constraint added to a table this
-- migration did not create aborts provisioning a new tenant at 13791 (see
-- tests/unit/migration-constraint-ordering.test.js). The bounds live in the
-- code instead: origin_page is validated to 300 characters by the public
-- schema, and mail_error is cut to 2,000 by inbound_intake.repo.markDelivery.

CREATE TABLE IF NOT EXISTS contact_enquiry_attachment (
  contact_enquiry_attachment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_enquiry_id uuid NOT NULL REFERENCES contact_enquiry(contact_enquiry_id) ON DELETE CASCADE,
  doc_id             uuid NOT NULL REFERENCES document_vault(doc_id),
  original_name      text,
  content_type       text NOT NULL,
  byte_size          integer NOT NULL CHECK (byte_size > 0),
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_contact_enquiry_attachment_doc UNIQUE (contact_enquiry_id, doc_id)
);

CREATE INDEX IF NOT EXISTS ix_contact_enquiry_attachment_enquiry
  ON contact_enquiry_attachment (contact_enquiry_id, sort_order);
CREATE INDEX IF NOT EXISTS ix_contact_enquiry_attachment_doc
  ON contact_enquiry_attachment (doc_id);

INSERT INTO mail_send_point
  (send_point_key, module_key, group_key, label_en, label_fr, description_en, description_fr, legacy_purpose, default_catalogue_key, is_wired, sort_order)
VALUES
  ('site.enquiry.notify', 'MOD-25', 'SALES', 'Website message to the inbox', 'Message du site vers la boîte',
   'A copy of every website message, sent to the website inbox.', 'Une copie de chaque message du site, envoyée à la boîte du site.',
   'SUPPORT', 'INFO', true, 72),
  ('site.enquiry.ack', 'MOD-25', 'SALES', 'Website message acknowledgement', 'Accusé de réception du site',
   'The note a visitor receives with their reference.', 'Le message que reçoit le visiteur avec sa référence.',
   'SUPPORT', 'INFO', true, 74)
ON CONFLICT (send_point_key) DO NOTHING;

-- DOWN
-- DELETE FROM mail_send_point WHERE send_point_key IN ('site.enquiry.notify', 'site.enquiry.ack');
-- DROP TABLE IF EXISTS contact_enquiry_attachment;
-- DROP INDEX IF EXISTS ux_contact_enquiry_public_ref;
-- ALTER TABLE contact_enquiry DROP COLUMN IF EXISTS mail_error;
-- ALTER TABLE contact_enquiry DROP COLUMN IF EXISTS visitor_acked_at;
-- ALTER TABLE contact_enquiry DROP COLUMN IF EXISTS inbox_notified_at;
-- ALTER TABLE contact_enquiry DROP COLUMN IF EXISTS origin_page;
-- ALTER TABLE contact_enquiry DROP COLUMN IF EXISTS public_ref;
