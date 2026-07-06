-- ============================================================================
-- TENANT DB — 0110 RBAC as data (MOD-67). Roles/capabilities/scopes/permissions
-- and field-level visibility are ROWS the Tenant Super Admin edits — never enums
-- or code. Fixes the legacy "permissions modelled three ways" flaw.
-- Access = Role × Capability × Scope × CRUD-per-module × field visibility.
-- ============================================================================

-- Job-area role (configurable; not an enum) ---------------------------------
CREATE TABLE role (
  role_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             citext UNIQUE NOT NULL,           -- 'FINANCE' | 'OPERATIONS' | custom
  name             text NOT NULL,
  description      text,
  is_system        boolean NOT NULL DEFAULT false,   -- seeded defaults vs tenant-created
  is_line_manager  boolean NOT NULL DEFAULT false,   -- Line Manager is a capability-like flag layered on a role
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- The authority overlay on documents (segregation of duties) -----------------
CREATE TABLE capability (
  capability_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text UNIQUE NOT NULL CHECK (code IN ('ISSUER','VALIDATOR','APPROVER','LINE_MANAGER')),
  name             text NOT NULL
);

-- Scope = the entity / branch / department a user belongs to -----------------
CREATE TABLE scope (
  scope_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid REFERENCES corporate_entity(entity_id) ON DELETE CASCADE,
  code             citext NOT NULL,                  -- 'HQ' | 'CUSTOMS_DESK' | 'DLA_BRANCH'
  name             text NOT NULL,
  parent_scope_id  uuid REFERENCES scope(scope_id),  -- the organigramme tree
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, code)
);

-- Explicit CRUD per role per module -----------------------------------------
CREATE TABLE permission (
  permission_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id          uuid NOT NULL REFERENCES role(role_id) ON DELETE CASCADE,
  module_key       citext NOT NULL,                  -- 'MOD-51' (mirrors platform.module_catalogue)
  can_create       boolean NOT NULL DEFAULT false,
  can_read         boolean NOT NULL DEFAULT false,
  can_update       boolean NOT NULL DEFAULT false,
  can_delete       boolean NOT NULL DEFAULT false,
  can_approve      boolean NOT NULL DEFAULT false,
  UNIQUE (role_id, module_key)
);

-- Field-level confidentiality (PRD §7.3): margins, salaries, cost rates, GL ---
CREATE TABLE field_visibility (
  field_visibility_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id          uuid REFERENCES role(role_id) ON DELETE CASCADE,
  field_key        text NOT NULL,                    -- 'dossier.margin' | 'employee.salary' | 'supplier.cost_rate'
  visibility       text NOT NULL DEFAULT 'masked' CHECK (visibility IN ('visible','masked','hidden')),
  UNIQUE (role_id, field_key)
);

-- Assignments ---------------------------------------------------------------
CREATE TABLE user_role (
  user_id          uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  role_id          uuid NOT NULL REFERENCES role(role_id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
CREATE TABLE user_capability (
  user_id          uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  capability_id    uuid NOT NULL REFERENCES capability(capability_id) ON DELETE CASCADE,
  -- Optional per-document-type + amount-threshold routing of the authority.
  document_type    text,
  min_amount_xaf   numeric(18,2),
  max_amount_xaf   numeric(18,2),
  PRIMARY KEY (user_id, capability_id, document_type)
);
CREATE TABLE user_scope (
  user_id          uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  scope_id         uuid NOT NULL REFERENCES scope(scope_id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, scope_id)
);

CREATE TRIGGER trg_role_updated BEFORE UPDATE ON role FOR EACH ROW EXECUTE FUNCTION set_updated_at();
