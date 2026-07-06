-- ============================================================================
-- PLATFORM DB — 0010 tenant registry & connection registry
-- The heart of the company dashboard: who exists, where their DB is, which
-- subdomain resolves to them. DB-per-tenant (doc/DB_ARCHITECTURE.md §1).
-- ============================================================================

-- Commercial plans a tenant can be on ---------------------------------------
CREATE TABLE platform.plan (
  plan_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             citext UNIQUE NOT NULL,           -- 'starter' | 'full' | 'enterprise'
  name             text NOT NULL,
  description      text,
  price_setup_xaf  numeric(18,2) DEFAULT 0,
  price_yearly_xaf numeric(18,2) DEFAULT 0,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- One row per client company -------------------------------------------------
CREATE TABLE platform.tenant (
  tenant_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             citext UNIQUE NOT NULL,           -- 'smartls' (also the schema-name stem)
  legal_name       text NOT NULL,
  display_name     text NOT NULL,
  country_code     char(2) NOT NULL DEFAULT 'CM',
  plan_id          uuid REFERENCES platform.plan(plan_id),
  status           text NOT NULL DEFAULT 'PROVISIONING'
                     CHECK (status IN ('PROVISIONING','LIVE','SUSPENDED','ARCHIVED')),
  -- When true the Test/Live toggle is hidden from the tenant's users (go-live).
  is_live          boolean NOT NULL DEFAULT false,
  -- Sandbox auto-wipe interval (days); default 14 per kickoff §6.
  sandbox_wipe_days integer NOT NULL DEFAULT 14 CHECK (sandbox_wipe_days > 0),
  onboarded_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Physical database connection registry (secret is referenced, never stored) --
CREATE TABLE platform.tenant_database (
  tenant_database_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES platform.tenant(tenant_id) ON DELETE CASCADE,
  db_host          text NOT NULL,
  db_port          integer NOT NULL DEFAULT 5432,
  db_name          text NOT NULL,                    -- e.g. 'tenant_smartls'
  app_role         text NOT NULL,                    -- least-priv role the API connects as
  -- Reference into the secret store (Vault path / env key). NEVER the raw password.
  secret_ref       text NOT NULL,
  live_schema      text NOT NULL DEFAULT 'live',
  sandbox_schema   text NOT NULL DEFAULT 'sandbox',
  region           text,                             -- 'cm-dla' | 'eu-hel' ...
  capacity_tier    text NOT NULL DEFAULT 'S',        -- S/M/L box size for the scaling ladder
  pool_max         integer NOT NULL DEFAULT 10,
  -- Set true when the tenant has been sold direct access to their own Postgres.
  tenant_owned     boolean NOT NULL DEFAULT false,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (db_host, db_port, db_name)
);
CREATE INDEX ix_tenant_database_tenant ON platform.tenant_database(tenant_id);

-- Subdomains + future custom domains ----------------------------------------
CREATE TABLE platform.subdomain (
  subdomain_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES platform.tenant(tenant_id) ON DELETE CASCADE,
  host             citext UNIQUE NOT NULL,           -- 'smartls.praxisls.com' | 'app.smartls.cm'
  is_primary       boolean NOT NULL DEFAULT true,
  is_custom_domain boolean NOT NULL DEFAULT false,
  verified_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_subdomain_tenant ON platform.subdomain(tenant_id);

CREATE TRIGGER trg_plan_updated       BEFORE UPDATE ON platform.plan             FOR EACH ROW EXECUTE FUNCTION platform.set_updated_at();
CREATE TRIGGER trg_tenant_updated     BEFORE UPDATE ON platform.tenant           FOR EACH ROW EXECUTE FUNCTION platform.set_updated_at();
CREATE TRIGGER trg_tenantdb_updated   BEFORE UPDATE ON platform.tenant_database  FOR EACH ROW EXECUTE FUNCTION platform.set_updated_at();
