-- ============================================================================
-- PLATFORM DB — 0020 module & feature catalogue (the on/off switchboard)
-- The company dashboard flips modules/features per tenant here; the
-- provisioning/sync worker PROJECTS the resolved state into each tenant DB's
-- `feature_state` table. Removing a feature = state 'off', never a DROP.
-- doc/DB_ARCHITECTURE.md §2, §3.
-- ============================================================================

-- The 70 modules (MOD-xx), grouped ------------------------------------------
CREATE TABLE platform.module_catalogue (
  module_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_key       citext UNIQUE NOT NULL,           -- 'MOD-29' | 'MOD-51'
  group_key        text NOT NULL,                    -- 'operations' | 'finance' | 'wms' ...
  name             text NOT NULL,
  description      text,
  sort_order       integer NOT NULL DEFAULT 0,
  is_core          boolean NOT NULL DEFAULT false,   -- core modules can't be disabled
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Finer-grained switchable capabilities -------------------------------------
CREATE TABLE platform.feature_catalogue (
  feature_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key      citext UNIQUE NOT NULL,           -- 'ai.assistant' | 'fleet' | 'wms.cycle_count'
  module_key       citext REFERENCES platform.module_catalogue(module_key),
  name             text NOT NULL,
  description      text,
  default_state    text NOT NULL DEFAULT 'off' CHECK (default_state IN ('on','off')),
  -- Feature dependencies: enabling A requires B already on (array of feature_key).
  depends_on       citext[] NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Which features a plan includes --------------------------------------------
CREATE TABLE platform.plan_feature (
  plan_id          uuid NOT NULL REFERENCES platform.plan(plan_id) ON DELETE CASCADE,
  feature_key      citext NOT NULL REFERENCES platform.feature_catalogue(feature_key) ON DELETE CASCADE,
  included         boolean NOT NULL DEFAULT true,
  PRIMARY KEY (plan_id, feature_key)
);

-- Per-tenant override of the plan default (the dashboard toggle) -------------
CREATE TABLE platform.tenant_feature_override (
  tenant_id        uuid NOT NULL REFERENCES platform.tenant(tenant_id) ON DELETE CASCADE,
  feature_key      citext NOT NULL REFERENCES platform.feature_catalogue(feature_key) ON DELETE CASCADE,
  state            text NOT NULL CHECK (state IN ('on','off')),
  reason           text,
  changed_by       uuid,                             -- platform_user
  changed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, feature_key)
);

CREATE INDEX ix_feature_module ON platform.feature_catalogue(module_key);
