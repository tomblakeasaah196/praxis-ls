-- ============================================================================
-- TENANT DB — 14622 Mark the one-per-email SLA alerts as read.
--
-- Connecting info@smartlsgroup.com as a shared mailbox (25 Nov 2026) imported
-- its history, and the SLA sweep raised a "First-response SLA missed"
-- notification for every imported conversation, to every Manager: 100+ unread
-- alerts in minutes, for mail nobody had promised to answer. From this release
-- the sweep clocks only mail from people received after a mailbox is connected,
-- and tells people once a day (mail/triage/sla.service.js, header).
--
-- The alerts already raised are marked READ so the bell is usable again. They
-- are not deleted: each one still opens its conversation from the
-- notifications list.
-- ============================================================================

UPDATE notification
   SET read_at = now()
 WHERE event_type_key = 'mail.sla.breached'
   AND read_at IS NULL;

-- DOWN
-- IRREVERSIBLE: which alerts were unread before this ran is not kept. Nothing
-- was deleted, so the notifications themselves are all still there.
