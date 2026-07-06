-- ============================================================================
-- TENANT DB — 0120 Universal Event System + no-code workflow/approval designer
-- (MOD-67 / §11.14). Modules register event types; the Super Admin builds
-- validate->approve chains per event as DATA. The same layer gates AI actions.
-- ============================================================================

-- Standardised `entity.action` events; modules register theirs so new modules
-- auto-appear in the workflow/notification config.
CREATE TABLE event_type (
  event_type_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key              citext UNIQUE NOT NULL,           -- 'invoice.issued' | 'costing.approved' | 'permission.changed'
  module_key       citext NOT NULL,
  name             text NOT NULL,
  description      text,
  is_security_critical boolean NOT NULL DEFAULT false, -- permission/role/God-Mode changes → high priority + CEO notify
  is_approvable    boolean NOT NULL DEFAULT false,   -- can carry a validate/approve workflow
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- A per-tenant workflow bound to an approvable event -------------------------
CREATE TABLE workflow (
  workflow_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type_id    uuid NOT NULL REFERENCES event_type(event_type_id) ON DELETE CASCADE,
  name             text NOT NULL,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Ordered validate/approve steps — the dynamic chain (add steps to lengthen it)
CREATE TABLE workflow_step (
  workflow_step_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id      uuid NOT NULL REFERENCES workflow(workflow_id) ON DELETE CASCADE,
  step_seq         integer NOT NULL,                 -- 1,2,3...
  step_kind        text NOT NULL CHECK (step_kind IN ('VALIDATE','APPROVE')),
  -- Who acts: bound to a role and/or a specific capability, within a scope.
  role_id          uuid REFERENCES role(role_id),
  capability_code  text CHECK (capability_code IN ('VALIDATOR','APPROVER')),
  scope_id         uuid REFERENCES scope(scope_id),
  -- Amount-threshold routing (approver by value).
  min_amount_xaf   numeric(18,2),
  max_amount_xaf   numeric(18,2),
  UNIQUE (workflow_id, step_seq)
);

-- Append-only event stream → notifications, compliance, live updates, ledger.
CREATE TABLE event_log (
  event_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type_key   citext NOT NULL,
  module_key       citext,
  entity_ref       text,                             -- 'invoice:UUID' | 'dossier:SLAS-2026-0001'
  actor_user_id    uuid REFERENCES app_user(user_id),
  priority         text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL','HIGH')),
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip               inet,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_eventlog_type ON event_log(event_type_key, created_at DESC);
CREATE INDEX ix_eventlog_entity ON event_log(entity_ref);
CREATE TRIGGER trg_eventlog_ro BEFORE UPDATE OR DELETE ON event_log FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Runtime approval instances ("approvals waiting on me", My Workspace) --------
CREATE TABLE approval_task (
  approval_task_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id      uuid REFERENCES workflow(workflow_id),
  workflow_step_id uuid REFERENCES workflow_step(workflow_step_id),
  entity_ref       text NOT NULL,
  amount_xaf       numeric(18,2),
  assigned_role_id uuid REFERENCES role(role_id),
  assigned_user_id uuid REFERENCES app_user(user_id),
  status           text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','VALIDATED','APPROVED','REJECTED','SKIPPED')),
  acted_by         uuid REFERENCES app_user(user_id),
  acted_at         timestamptz,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_approval_pending ON approval_task(assigned_role_id, status) WHERE status = 'PENDING';

CREATE TRIGGER trg_workflow_updated BEFORE UPDATE ON workflow FOR EACH ROW EXECUTE FUNCTION set_updated_at();
