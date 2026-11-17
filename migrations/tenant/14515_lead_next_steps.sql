-- ============================================================================
-- TENANT DB — 14515 Sales lean revamp, PR 2: every open lead has a dated next
-- step (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §4.4, owner decision D4).
--
-- A next step is an ordinary My Workspace task (entity_type 'lead'), so it is
-- on its owner's Today with a reminder, and `lead.next_step_task_id` points at
-- it. From here on the lead service writes them; this gives the rows that
-- existed before the revamp theirs, so the invariant holds from the first day:
--
--   an OPEN lead has a next step, unless it is a client with no open request.
--
-- Each one is "Follow up", due tomorrow at 09:00 on the tenant's clock
-- (hr.timezone, Africa/Douala when unset or unreadable), with a reminder 15
-- minutes before, on the lead's owner. A lead with no owner is given one:
-- the default sales owner (setting sales.default_owner), else the first
-- active CEO-role user (the MD), else the oldest active user. A schema with no
-- active user at all (a freshly wiped TEST) gets no task, and the lead service
-- asks for one on that lead's next write.
-- ============================================================================

WITH tz AS (
  SELECT COALESCE(
           (SELECT z.name FROM pg_timezone_names z
             WHERE z.name = (SELECT s.value #>> '{}' FROM setting s WHERE s.section = 'hr' AND s.key = 'timezone')
             LIMIT 1),
           'Africa/Douala') AS name
),
fallback AS (
  SELECT COALESCE(
    (SELECT u.user_id FROM app_user u
      WHERE u.status = 'ACTIVE'
        AND u.user_id::text = (SELECT s.value ->> 'user_id' FROM setting s WHERE s.section = 'sales' AND s.key = 'default_owner')
      LIMIT 1),
    (SELECT u.user_id FROM app_user u
       JOIN user_role ur ON ur.user_id = u.user_id
       JOIN role r ON r.role_id = ur.role_id
      WHERE r.code = 'CEO' AND u.status = 'ACTIVE'
      ORDER BY u.created_at, u.user_id LIMIT 1),
    (SELECT u.user_id FROM app_user u WHERE u.status = 'ACTIVE' ORDER BY u.created_at, u.user_id LIMIT 1)
  ) AS user_id
),
needing AS (
  SELECT l.lead_id,
         COALESCE(
           (SELECT u.user_id FROM app_user u WHERE u.user_id = l.owner_user_id AND u.status = 'ACTIVE'),
           (SELECT f.user_id FROM fallback f)
         ) AS owner_id,
         ((current_date + 1) + time '09:00') AT TIME ZONE (SELECT name FROM tz) AS due_at
    FROM lead l
   WHERE l.status = 'OPEN'
     AND l.next_step_task_id IS NULL
     AND l.merged_into_lead_id IS NULL
     AND (l.client_id IS NULL
          OR EXISTS (SELECT 1 FROM quote_request q
                      WHERE q.lead_id = l.lead_id AND q.stage NOT IN ('WON', 'LOST')))
),
made AS (
  INSERT INTO task (
    title, status, priority, assigned_to, created_by, due_at, entity_type, entity_id,
    reminder_minutes, remind_at
  )
  SELECT 'Follow up', 'TO_DO', 'NORMAL', n.owner_id, n.owner_id, n.due_at, 'lead', n.lead_id,
         15, n.due_at - interval '15 minutes'
    FROM needing n
   WHERE n.owner_id IS NOT NULL
  ON CONFLICT DO NOTHING
  RETURNING task_id, entity_id, assigned_to
),
reminded AS (
  INSERT INTO workspace_reminder (owner_type, owner_id, reminder_minutes, ordinal, created_by, updated_by)
  SELECT 'task', m.task_id, 15, 1, m.assigned_to, m.assigned_to FROM made m
  ON CONFLICT DO NOTHING
  RETURNING owner_id
)
UPDATE lead l
   SET next_step_task_id = m.task_id,
       owner_user_id = COALESCE(l.owner_user_id, m.assigned_to)
  FROM made m
 WHERE l.lead_id = m.entity_id;

-- DOWN
-- UPDATE lead SET next_step_task_id = NULL
--  WHERE next_step_task_id IN (SELECT task_id FROM task WHERE entity_type = 'lead' AND title = 'Follow up');
-- The tasks themselves are left in My Workspace: a person may already have
-- worked or rescheduled one, and deleting their to-do list is not a rollback.
