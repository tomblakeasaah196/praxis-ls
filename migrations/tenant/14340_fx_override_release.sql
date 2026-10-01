-- ============================================================================
-- TENANT DB — 14340 A manual FX override stands until someone releases it.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- Meeting 6 (29 Sep 2026), register 3.1 / owner decision F1. The resolver
-- preferred a manual override only on the SAME date (`currency.rules.pickRate`
-- before this PR), so a treasurer's rate set on Monday was beaten by Tuesday's
-- 00:00 feed row: an override lasted until midnight. It now stands until a
-- newer override replaces it or someone presses "Follow the feed again".
--
-- A release has to be DATED, not a delete or a flag flip: resolving a past date
-- (a costing priced last week, a re-run report) must still find the override
-- that was in force then. `released_at` is that date; the resolver treats an
-- override as standing on any day before it.
--
-- ── SHAPE ──────────────────────────────────────────────────────────────────
--
-- Plain columns on an existing table — the 13791 rule
-- (tests/unit/migration-constraint-ordering.test.js): no FK or CHECK may be
-- added to a pre-existing table here. `released_by_user_id` is intent-only,
-- REFERENCES app_user(user_id), exactly as 13952 did for `set_by_user_id`.
-- Nothing is backfilled: every existing override starts out standing, which is
-- what the treasurer who set it meant.
-- ============================================================================

ALTER TABLE fx_rate_daily ADD COLUMN IF NOT EXISTS released_at timestamptz;
ALTER TABLE fx_rate_daily ADD COLUMN IF NOT EXISTS released_by_user_id uuid;

COMMENT ON COLUMN fx_rate_daily.released_at IS
  'Manual overrides only: when someone chose "Follow the feed again". Before this instant the override stands over every later feed row; from its UTC day the feed applies. NULL = still standing.';
COMMENT ON COLUMN fx_rate_daily.released_by_user_id IS
  'Who released the override. Intent: REFERENCES app_user(user_id) — plain column per the 13791 rule.';

-- The resolver reads standing overrides per pair on every rate lookup.
CREATE INDEX IF NOT EXISTS ix_fx_rate_daily_standing_override
  ON fx_rate_daily (base_code, quote_code, as_of_date DESC)
  WHERE is_override AND source = 'manual' AND released_at IS NULL;

-- ============================================================================
-- VERIFY
--   SELECT base_code, quote_code, rate, as_of_date FROM fx_rate_daily
--    WHERE is_override AND source = 'manual' AND released_at IS NULL;   -- standing
--
-- DOWN
--   -- DROP INDEX IF EXISTS ix_fx_rate_daily_standing_override;
--   -- ALTER TABLE fx_rate_daily DROP COLUMN IF EXISTS released_by_user_id;
--   -- ALTER TABLE fx_rate_daily DROP COLUMN IF EXISTS released_at;
-- ============================================================================
