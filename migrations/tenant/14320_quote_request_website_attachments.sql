-- ============================================================================
-- TENANT DB — 14320 A website enquiry's file appears where staff look for it
-- (tenant review, meeting 6, item 2.7).
--
-- ── THE FILE NOBODY SAW ────────────────────────────────────────────────────
--
-- The public quote form stored its one attachment in the vault under
-- `entity_ref = 'quote_request:intake'` and kept the id ONLY in
-- `quote_request.attachment_doc_id` (12756). Every staff surface reads
-- `quote_request_attachment`: the request's Attachments tab, its 360, the
-- form's attachments panel, the KPI that says "primary on file". So a prospect
-- who attached their commercial invoice was told the desk had it, and the desk
-- saw "Nothing was attached to this request".
--
-- From PR 2 on, public_intake writes every website file as a
-- quote_request_attachment row under the request's own entity ref (the first
-- one PRIMARY). This file does the same for the files already received:
--
--   · one link per request whose attachment_doc_id is not linked yet —
--     PRIMARY when the request has no primary document, ADDITIONAL otherwise,
--     dated when the request arrived;
--   · the vault row re-filed from `quote_request:intake` to
--     `quote_request:<id>`, so the vault's own "what is this for" answers.
--
-- `attachment_doc_id` is left as it is: it is still the truthful record of what
-- the form sent, and nothing reads it for display any more.
--
-- Idempotent by predicate: a request whose document is already linked is not
-- matched again, and a vault row already re-filed no longer says `:intake`.
-- (The ON CONFLICT is the gate's belt; the NOT EXISTS is the braces — there is
-- no unique key on (request, document) for it to catch.)
-- ============================================================================

INSERT INTO quote_request_attachment (quote_request_id, vault_id, kind, created_at)
SELECT q.quote_request_id,
       q.attachment_doc_id,
       CASE
         WHEN EXISTS (
           SELECT 1 FROM quote_request_attachment p
            WHERE p.quote_request_id = q.quote_request_id AND p.kind = 'PRIMARY'
         ) THEN 'ADDITIONAL'
         ELSE 'PRIMARY'
       END,
       q.created_at
  FROM quote_request q
  JOIN document_vault v ON v.doc_id = q.attachment_doc_id
 WHERE q.attachment_doc_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM quote_request_attachment a
      WHERE a.quote_request_id = q.quote_request_id
        AND a.vault_id = q.attachment_doc_id
   )
ON CONFLICT DO NOTHING;

UPDATE document_vault v
   SET entity_ref = 'quote_request:' || q.quote_request_id::text
  FROM quote_request q
 WHERE v.doc_id = q.attachment_doc_id
   AND v.entity_ref = 'quote_request:intake';

-- ============================================================================
-- VERIFY
--   SELECT count(*) FROM quote_request q
--    WHERE q.attachment_doc_id IS NOT NULL
--      AND NOT EXISTS (SELECT 1 FROM quote_request_attachment a
--                       WHERE a.quote_request_id = q.quote_request_id
--                         AND a.vault_id = q.attachment_doc_id);
--   -- expect 0
--   SELECT count(*) FROM document_vault WHERE entity_ref = 'quote_request:intake';
--   -- expect 0 (every website file is filed under its request)
--
-- DOWN
--   DELETE FROM quote_request_attachment a
--    USING quote_request q
--    WHERE a.quote_request_id = q.quote_request_id
--      AND a.vault_id = q.attachment_doc_id
--      AND a.uploaded_by_user_id IS NULL;
--   UPDATE document_vault v SET entity_ref = 'quote_request:intake'
--     FROM quote_request q
--    WHERE v.doc_id = q.attachment_doc_id
--      AND v.entity_ref = 'quote_request:' || q.quote_request_id::text;
--   -- Only for a rollback of PR 2 as a whole: from PR 2 on the website writes
--   -- these links itself, and the DELETE above would remove those too.
-- ============================================================================
