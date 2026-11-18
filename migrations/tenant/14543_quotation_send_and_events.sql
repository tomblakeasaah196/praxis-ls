-- ============================================================================
-- TENANT DB — 14543 Sales lean revamp, PR 4: a quotation is sent through the
-- mail engine, and what happens to it afterwards is an event
-- (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.4 "Send", "The link", "Revise").
--
-- `quotation.sent` has been in the send-point registry since 10726, declared
-- and never sent from. The quotation's Send now mails through it
-- (quotation.send.js passes `sendPoint: "quotation.sent"` with the quotation's
-- corporate entity), so the claim becomes true and a tenant who routes
-- quotations from sales@ is obeyed.
--
-- `proposal.shared` stays declared and unwired: nothing shares a proposal any
-- more (proposals became quotations in 14542), and PR 7 retires the row with
-- the proposal tables.
--
-- The events are registered so the workflow designer and the notification
-- settings can offer them (the 9030 rule). quotation.rejected and
-- quotation.converted were emitted since 0345 and never registered.
-- ============================================================================

UPDATE mail_send_point SET is_wired = true WHERE send_point_key = 'quotation.sent';

INSERT INTO event_type (key, module_key, name, is_security_critical, is_approvable) VALUES
 ('quotation.viewed',        'MOD-27', 'A client opened a quotation',      false, false),
 ('quotation.revised',       'MOD-27', 'Quotation revised',                false, false),
 ('quotation.expired',       'MOD-27', 'Quotation expired',                false, false),
 ('quotation.rejected',      'MOD-27', 'Quotation declined',               false, false),
 ('quotation.converted',     'MOD-27', 'Quotation turned into an invoice', false, false),
 ('quotation.share_revoked', 'MOD-27', 'Quotation link revoked',           false, false)
ON CONFLICT (key) DO NOTHING;

-- DOWN
-- DELETE FROM event_type WHERE key IN ('quotation.viewed', 'quotation.revised', 'quotation.expired',
--   'quotation.rejected', 'quotation.converted', 'quotation.share_revoked');
-- UPDATE mail_send_point SET is_wired = false WHERE send_point_key = 'quotation.sent';
