-- ============================================================================
-- TENANT DB — 0100 identity: entities, users, sessions   (UNQUALIFIED / per-schema)
-- ============================================================================

-- Generic helpers (created per-schema; reference no business tables) ---------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'append-only table: % not allowed on %', TG_OP, TG_TABLE_NAME; END;
$$ LANGUAGE plpgsql;

-- Multi-entity within a tenant (MOD-01). Each entity keeps its own books. -----
CREATE TABLE corporate_entity (
  entity_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             citext UNIQUE NOT NULL,           -- 'SLAS'
  legal_name       text NOT NULL,
  niu              text,                             -- Numéro Unique / tax ID
  rccm             text,                             -- trade register
  country_code     char(2) NOT NULL DEFAULT 'CM',
  address          text,
  logo_light_ref   text,
  logo_dark_ref    text,
  bank_block       jsonb NOT NULL DEFAULT '{}'::jsonb,
  doc_prefix       text NOT NULL DEFAULT 'SLS',
  default_language char(2) NOT NULL DEFAULT 'fr' CHECK (default_language IN ('fr','en')),
  fiscal_year_start_month smallint NOT NULL DEFAULT 1,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_user (
  user_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username         citext UNIQUE,
  email            citext UNIQUE NOT NULL,
  full_name        text NOT NULL,
  password_hash    text NOT NULL,                    -- Argon2id
  totp_secret_enc  text,                             -- 2FA (TOTP), encrypted
  is_2fa_enabled   boolean NOT NULL DEFAULT false,
  employee_id      uuid,                             -- FK added in 0300 (master data)
  -- God-Mode PIN (CEO only). Hash, never plaintext. Presence != authority; RBAC decides.
  godmode_pin_hash text,
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','LOCKED')),
  failed_logins    integer NOT NULL DEFAULT 0,
  last_login_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Server-side session state mirror (Redis is source of truth; this enables the
-- session monitor + remote kill, PRD §5.6 / MOD-68).
CREATE TABLE user_session (
  session_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  device_label     text,
  ip               inet,
  user_agent       text,
  environment      text NOT NULL DEFAULT 'live' CHECK (environment IN ('live','sandbox')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  killed_at        timestamptz,
  killed_by        uuid REFERENCES app_user(user_id)
);
CREATE INDEX ix_session_user ON user_session(user_id) WHERE killed_at IS NULL;

CREATE TRIGGER trg_entity_updated BEFORE UPDATE ON corporate_entity FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_user_updated   BEFORE UPDATE ON app_user         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
