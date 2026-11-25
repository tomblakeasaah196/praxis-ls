-- ============================================================================
-- TENANT DB — 14623 Files on a reply to a website enquiry.
--
-- A reply from General Enquiries could carry text only. The desk answers a
-- quote question with a rate sheet, a booking question with a schedule, so a
-- reply now carries files too: each is uploaded first (staged in the vault
-- against the enquiry, `contact_enquiry:<id>:reply-staged`), then attached to
-- the email when the reply is sent, and recorded here on the reply attempt
-- that carried it: [{doc_id, original_name, content_type, byte_size}].
-- ============================================================================

ALTER TABLE contact_enquiry_response
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

-- DOWN
-- ALTER TABLE contact_enquiry_response DROP COLUMN IF EXISTS attachments;
