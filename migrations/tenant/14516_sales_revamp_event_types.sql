-- ============================================================================
-- TENANT DB — 14516 Sales lean revamp, PR 2: the events the company row and
-- the request now raise (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §5.1, §5.2).
--
-- Registered so the workflow designer and the notification settings can offer
-- them. `quote_request.won` is the one the operations hand-off follows;
-- `quotation.accepted` (already registered) is what triggers it.
-- ============================================================================

INSERT INTO event_type (key, module_key, name, is_security_critical, is_approvable) VALUES
 ('lead.archived',              'MOD-20', 'Lead archived',                     false, false),
 ('lead.reopened',              'MOD-20', 'Lead reopened',                     false, false),
 ('lead.activity_logged',       'MOD-20', 'Activity logged on a lead',         false, false),
 ('lead.next_step_set',         'MOD-20', 'Next step set on a lead',           false, false),
 ('quote_request.stage_moved',  'MOD-20', 'Request moved to another stage',    false, false),
 ('quote_request.won',          'MOD-20', 'Request won',                       false, false),
 ('quote_request.lost',         'MOD-20', 'Request lost',                      false, false)
ON CONFLICT (key) DO NOTHING;

-- DOWN
-- DELETE FROM event_type WHERE key IN (
--   'lead.archived', 'lead.reopened', 'lead.activity_logged', 'lead.next_step_set',
--   'quote_request.stage_moved', 'quote_request.won', 'quote_request.lost'
-- );
