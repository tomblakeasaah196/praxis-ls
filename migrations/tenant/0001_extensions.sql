-- ============================================================================
-- TENANT DB — 0001 extensions & the live/sandbox schemas
-- Runs ONCE per tenant database. Every later tenant/ migration is UNQUALIFIED
-- DDL run TWICE by the provisioning tool: once with search_path=live, once with
-- search_path=sandbox. The two schemas are structurally identical; the sandbox
-- can be truncated/reseeded on the 14-day cron without ever touching live.
-- See doc/DB_ARCHITECTURE.md §1, §8.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid(), digest() for content hashes
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS vector;      -- pgvector — AI embeddings (kept, per product owner)

CREATE SCHEMA IF NOT EXISTS live;
CREATE SCHEMA IF NOT EXISTS sandbox;

-- The provisioning tool runs the remaining migrations per-schema, e.g.:
--   SET search_path = live;    \i 0100_identity.sql ... ;
--   SET search_path = sandbox; \i 0100_identity.sql ... ;
