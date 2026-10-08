-- ============================================================================
-- TENANT DB — 14401 The authenticator, finished: how often it asks, the device
-- that may be trusted between asks, and a way back in when the phone is gone.
--
-- ── WHAT WAS MISSING ───────────────────────────────────────────────────────
--
-- 2FA shipped as a binary: on, and asked at every single sign-in, with the only
-- way back in being an administrator. Three gaps, all of them the reason people
-- turn the feature off instead of using it.
--
-- ── 1. app_user.mfa_frequency — HOW OFTEN IT ASKS ──────────────────────────
--
-- 'always' (every sign-in), 'daily' (once in 24h on a device), 'monthly' (once
-- in 30 days on a device). Owner decision, 8 Oct 2026: the person chooses, on
-- their own My Security card. DEFAULT 'always' so every account that already
-- has 2FA on keeps asking at every sign-in until its owner decides otherwise —
-- a migration must not quietly weaken a factor somebody already enabled.
--
-- ── 2. user_known_device.mfa_trusted_until — THE DEVICE, BETWEEN ASKS ──────
--
-- 'daily' and 'monthly' need somewhere to record "this browser already proved
-- the code at 09:14, do not ask again until tomorrow". It hangs off
-- user_known_device (14230) because that row IS the device: an HttpOnly,
-- SameSite=Strict, `__Host-` cookie whose SHA-256 is the key here, outside
-- script-written storage that Safari erases on its own schedule.
--
-- READ known-device.js's "WHY IT IS SAFE" NOTE BEFORE EXTENDING THIS. It says
-- the cookie "grants no session, skips no factor, unlocks nothing", and this
-- column is the first thing that makes the second clause less than absolute.
-- The property that remains, and that the service enforces, is narrower and
-- still worth stating plainly:
--
--   · the cookie ALONE still unlocks nothing. The trust is consumed only
--     AFTER the first factor has already passed — the right password, or the
--     right Quick PIN. It substitutes for the second factor, never the first;
--   · it is scoped to (device, person). A device trusted for one account says
--     nothing about another account signing in on it;
--   · it expires on a timestamp the person chose, and is NULLed the moment
--     2FA is turned off, reset by an administrator, or its frequency changes.
--
-- What this does buy an attacker: someone holding BOTH a stolen password and a
-- stolen device cookie skips the code until the timestamp passes. That is the
-- inherent cost of every "remember this device", it is why 'always' is the
-- default and stays one tap away, and it is why the trust is revoked from
-- every device whenever the factor itself is touched.
--
-- ── 3. user_mfa_recovery_code — THE WAY BACK IN ────────────────────────────
--
-- Ten single-use codes, minted when 2FA is enabled and shown exactly once.
-- Only the argon2id hash is stored, so this table cannot be read back into a
-- working code, and `used_at` burns one on use rather than deleting it: a
-- support question six months later is "was a recovery code used, and when",
-- and a deleted row cannot answer it.
--
-- They are checked on the SAME route and under the SAME rate limiter as a TOTP
-- code (/auth/2fa/verify, totpLimiter), so a recovery code is not a quieter
-- door into the account than the one it backs up.
-- ============================================================================

-- 1. How often the authenticator asks.
--
--    NO CHECK CONSTRAINT, deliberately, and this is not an oversight: app_user
--    predates 13791, and a constraint added to a pre-existing table above that
--    number aborts provisioning a fresh tenant (13791 mirrors live's
--    constraints into sandbox while sandbox is still at 13791, and fails on the
--    column it cannot yet see). tests/unit/migration-constraint-ordering.test.js
--    pins the rule: an existing table may only gain PLAIN columns.
--
--    The three legal values are enforced where every write passes anyway:
--    app_user.validator's `MFA_FREQUENCY` z.enum on the route, and
--    `MFA_FREQUENCIES` in app_user.service.setMfaFrequency, which refuses an
--    unknown value with VALIDATION_ERROR before anything is written. There is
--    no other writer: the column is set by that one service function and by
--    enableTotp, which passes a value the same validator already accepted.
ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS mfa_frequency text NOT NULL DEFAULT 'always';

COMMENT ON COLUMN app_user.mfa_frequency IS
  'How often the authenticator asks: always (every sign-in), daily (24h), monthly (30 days). Enforced in app_user.validator + app_user.service, NOT by a CHECK (see 13791 / migration-constraint-ordering). The person sets it in My Security; daily/monthly are remembered per device in user_known_device.mfa_trusted_until.';

-- 2. The device, between asks. NULL = ask for a code. Past = ask for a code.
ALTER TABLE user_known_device
  ADD COLUMN IF NOT EXISTS mfa_trusted_until timestamptz;

COMMENT ON COLUMN user_known_device.mfa_trusted_until IS
  'This (device, person) proved a TOTP code and need not prove another until this moment. NULLed when 2FA is disabled, reset, or its frequency changes. Consumed only after the password or Quick PIN has already passed: it replaces the second factor, never the first.';

-- 3. The way back in. One row per minted code, hashed, burned on use.
CREATE TABLE IF NOT EXISTS user_mfa_recovery_code (
  code_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  code_hash   text NOT NULL,                      -- argon2id(code); never returned
  created_at  timestamptz NOT NULL DEFAULT now(),
  used_at     timestamptz                         -- burned, not deleted: "was one used, and when"
);

COMMENT ON TABLE user_mfa_recovery_code IS
  'Single-use codes that stand in for the authenticator when the phone is gone (14401). Minted ten at a time when 2FA is enabled, shown once, replaced wholesale on re-enrolment. Verified on /auth/2fa/verify under the same rate limiter as a TOTP code.';

-- The hot read is "this person's unused codes", on a route that is already the
-- tightest-limited in the app. Partial, so burned codes stop costing index.
CREATE INDEX IF NOT EXISTS ix_user_mfa_recovery_code_live
  ON user_mfa_recovery_code (user_id) WHERE used_at IS NULL;

-- ============================================================================
-- VERIFY
--   SELECT mfa_frequency, count(*) FROM app_user GROUP BY 1;   -- expect all 'always'
--   SELECT count(*) FROM user_known_device WHERE mfa_trusted_until IS NOT NULL;  -- expect 0
--   SELECT count(*) FROM user_mfa_recovery_code;               -- expect 0
--
-- Not destructive: three additions, no column dropped, no row rewritten. Every
-- account keeps the posture it had (2FA on means a code at every sign-in) until
-- its owner changes it deliberately.
--
-- DOWN
--   -- DROP INDEX IF EXISTS ix_user_mfa_recovery_code_live;
--   -- DROP TABLE IF EXISTS user_mfa_recovery_code;
--   -- ALTER TABLE user_known_device DROP COLUMN IF EXISTS mfa_trusted_until;
--   -- ALTER TABLE app_user DROP COLUMN IF EXISTS mfa_frequency;
--   --   (dropping mfa_trusted_until makes every device ask for a code again,
--   --    which is the safe direction; dropping the codes table strands anyone
--   --    whose phone is already lost, so reset their 2FA first.)
-- ============================================================================
