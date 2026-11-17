-- ============================================================================
-- TENANT DB — 14514 Sales lean revamp, PR 2: a meeting is on the calendar, and
-- may be about one request (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §4.5, §3.2
-- "Meetings"; gap 5).
--
--   calendar_event_id  the My Workspace event Schedule Meeting writes with it,
--                      with a reminder and the staff attendees invited (its
--                      start and end are the meeting's time and duration). A
--                      meeting scheduled before this has none; nothing is
--                      back-filled, because an old meeting already happened.
--   quote_request_id   the request it is about. Scheduling one on a request
--                      moves that request to MEETING (never backwards).
--
-- The discovery tables are unchanged.
--
-- Plain columns, no foreign key: a constraint added to an existing table above
-- 13791 aborts provisioning a fresh tenant (see 14510). The meeting service is
-- their only writer, from the event it has just created and a request it has
-- just read; a deleted event reads as none (calendar events are soft-deleted).
-- ============================================================================

ALTER TABLE meeting ADD COLUMN IF NOT EXISTS calendar_event_id uuid;
ALTER TABLE meeting ADD COLUMN IF NOT EXISTS quote_request_id uuid;

CREATE INDEX IF NOT EXISTS ix_meeting_calendar_event ON meeting (calendar_event_id) WHERE calendar_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_meeting_quote_request ON meeting (quote_request_id) WHERE quote_request_id IS NOT NULL;

-- DOWN
-- DROP INDEX IF EXISTS ix_meeting_quote_request;
-- DROP INDEX IF EXISTS ix_meeting_calendar_event;
-- ALTER TABLE meeting DROP COLUMN IF EXISTS quote_request_id;
-- ALTER TABLE meeting DROP COLUMN IF EXISTS calendar_event_id;
