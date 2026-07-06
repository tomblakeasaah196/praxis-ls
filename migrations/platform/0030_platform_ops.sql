-- ============================================================================
-- PLATFORM DB — 0030 platform users, provisioning, audit, support
-- ============================================================================

-- Praxis-side staff. NEVER granted tenant business access (PRD §5.3 [RULE]).
CREATE TABLE platform.platform_user (
  platform_user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            citext UNIQUE NOT NULL,
  full_name        text NOT NULL,
  role             text NOT NULL DEFAULT 'PLATFORM_ROOT_ADMIN'
                     CHECK (role IN ('PLATFORM_ROOT_ADMIN','PLATFORM_SUPPORT','PLATFORM_BILLING')),
  password_hash    text NOT NULL,                    -- Argon2id
  totp_secret_enc  text,                             -- 2FA (encrypted)
  is_active        boolean NOT NULL DEFAULT true,
  last_login_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Async onboarding pipeline: create DB -> migrate -> seed -> project features.
CREATE TABLE platform.provisioning_job (
  job_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES platform.tenant(tenant_id) ON DELETE CASCADE,
  kind             text NOT NULL DEFAULT 'CREATE'
                     CHECK (kind IN ('CREATE','MIGRATE','SEED','PROJECT_FEATURES','SANDBOX_WIPE','SUSPEND','DELETE')),
  status           text NOT NULL DEFAULT 'QUEUED'
                     CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED')),
  requested_by     uuid REFERENCES platform.platform_user(platform_user_id),
  log              jsonb NOT NULL DEFAULT '[]'::jsonb,   -- step-by-step trace
  error            text,
  started_at       timestamptz,
  finished_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_provjob_tenant ON platform.provisioning_job(tenant_id, created_at DESC);

-- Watch-the-Watcher at platform level: every provisioning/feature/suspend action.
CREATE TABLE platform.platform_audit (
  audit_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id         uuid REFERENCES platform.platform_user(platform_user_id),
  tenant_id        uuid REFERENCES platform.tenant(tenant_id),
  action           text NOT NULL,                    -- 'tenant.created' | 'feature.toggled' ...
  entity_ref       text,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip               inet,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_platform_audit_tenant ON platform.platform_audit(tenant_id, created_at DESC);

-- Append-only guard: block UPDATE/DELETE on the platform audit log.
CREATE OR REPLACE FUNCTION platform.forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only table: % not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_platform_audit_ro
  BEFORE UPDATE OR DELETE ON platform.platform_audit
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();

-- Tenant -> Praxis support & feedback (PRD §11.2), feeds the roadmap.
CREATE TABLE platform.support_ticket (
  ticket_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES platform.tenant(tenant_id) ON DELETE CASCADE,
  raised_by_email  citext,
  kind             text NOT NULL DEFAULT 'SUPPORT' CHECK (kind IN ('SUPPORT','BUG','FEATURE')),
  title            text NOT NULL,
  body             text,
  context          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- hub/area/page/action/screenshot ref
  status           text NOT NULL DEFAULT 'NEW'
                     CHECK (status IN ('NEW','TRIAGED','IN_PROGRESS','SHIPPED','DECLINED')),
  csat             smallint CHECK (csat BETWEEN 1 AND 5),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_ticket_tenant ON platform.support_ticket(tenant_id, status);

CREATE TRIGGER trg_platuser_updated BEFORE UPDATE ON platform.platform_user  FOR EACH ROW EXECUTE FUNCTION platform.set_updated_at();
CREATE TRIGGER trg_ticket_updated   BEFORE UPDATE ON platform.support_ticket FOR EACH ROW EXECUTE FUNCTION platform.set_updated_at();
