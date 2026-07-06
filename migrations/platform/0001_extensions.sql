-- ============================================================================
-- PLATFORM DB — 0001 extensions & conventions
-- Runs ONCE against the shared `platform` database (the Praxis company console).
-- Tenants never connect here. See doc/DB_ARCHITECTURE.md §3.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;      -- gen_random_uuid(), digest()
CREATE EXTENSION IF NOT EXISTS citext;        -- case-insensitive slugs / emails

-- Everything platform-side lives in the `platform` schema.
CREATE SCHEMA IF NOT EXISTS platform;

-- Shared updated_at trigger.
CREATE OR REPLACE FUNCTION platform.set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
