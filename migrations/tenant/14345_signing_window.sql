-- ============================================================================
-- TENANT DB — 14345 The 5-minute signing window.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- Meeting 6 (29 Sep 2026), register 3.7 / owner decision F6. On a computer
-- without fingerprint or face, every signature meant a new proof — an emailed
-- code each time. One confirmation (a passkey, usually the phone's via a QR
-- code, or the emailed code) now opens a signing WINDOW for that person on
-- that session: their next signatures on the same session for 5 minutes need
-- no new proof.
--
-- ── WHAT A WINDOW IS, AND IS NOT ───────────────────────────────────────────
--
--   · 5 minutes from the proof that opened it (`expires_at`), never extended
--     by use;
--   · bound to ONE person and ONE session (`user_id`, `session_id` — the `sid`
--     of the access token). Another device, another session, the AI assistant
--     and an API token have no session the window names, so they cannot use
--     it (signing-proof.service enforces this; see that header);
--   · ended by "End now", sign-out and the lock screen (both end the session,
--     and the logout path closes its windows), or by its own clock;
--   · each signature under it is still bound to its own document's content
--     hash at the moment of signing (document_signature.content_hash, as
--     always), and records the window it was made under and the proof that
--     opened it — so the verification page says "within a 5-minute signing
--     window" rather than implying a fresh fingerprint per document.
--
-- Opened, used and closed are each an audit entry (signing.window.*).
--
-- ── SHAPE ──────────────────────────────────────────────────────────────────
--
-- `signing_window` is new. Its references are intent-only plain columns:
-- `user_id` → app_user, `otp_challenge_id` → signature_otp; `session_id` and
-- `passkey_credential_id` name identity rows (user_session,
-- webauthn_credential) that live in the LIVE identity schema, which a sandbox
-- FK must not reach (check-schema-parity.js), so no FK can name them.
--
-- `document_signature` gains plain columns only — the 13791 rule
-- (tests/unit/migration-constraint-ordering.test.js), exactly as 14210 did.
-- The two new assurance levels (AES_PASSKEY_WINDOW, AES_OTP_WINDOW) are
-- enforced in document_signature.service (ASSURANCE_LEVELS), not by a CHECK.
-- ============================================================================

CREATE TABLE IF NOT EXISTS signing_window (
  window_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL,
  session_id             uuid NOT NULL,
  -- PASSKEY | OTP — the proof that opened it (service-enforced vocabulary).
  proof_method           text NOT NULL,
  passkey_credential_id  text,
  otp_challenge_id       uuid,
  -- The document whose signature opened it.
  opened_for_entity_ref  text,
  opened_at              timestamptz NOT NULL DEFAULT now(),
  expires_at             timestamptz NOT NULL,
  closed_at              timestamptz,
  -- END_NOW | SESSION_ENDED | EXPIRED | REPLACED (service-enforced vocabulary).
  close_reason           text,
  signature_count        integer NOT NULL DEFAULT 0
);

-- The one lookup on every signature: this person's open window on this session.
CREATE INDEX IF NOT EXISTS ix_signing_window_open
  ON signing_window (user_id, session_id)
  WHERE closed_at IS NULL;

COMMENT ON TABLE signing_window IS
  'One confirmation covers the same person''s further signatures on the same session for 5 minutes (meeting 6, F6). Never extended; closed by End now, sign-out / lock, or expiry. 14345.';

ALTER TABLE document_signature ADD COLUMN IF NOT EXISTS signing_window_id uuid;
ALTER TABLE document_signature ADD COLUMN IF NOT EXISTS window_opened_at timestamptz;

COMMENT ON COLUMN document_signature.signing_window_id IS
  'The 5-minute signing window this signature was made under, or opened (its first signature). Intent: REFERENCES signing_window(window_id) — plain column per the 13791 rule. 14345.';
COMMENT ON COLUMN document_signature.window_opened_at IS
  'When that window was opened by its proof (passkey_credential_id / otp_challenge_id on this row name the proof). 14345.';

-- ============================================================================
-- VERIFY
--   SELECT window_id, proof_method, opened_at, expires_at, closed_at, close_reason, signature_count
--     FROM signing_window ORDER BY opened_at DESC LIMIT 10;
--   SELECT assurance_level, count(*) FROM document_signature GROUP BY 1;
--
-- DOWN
--   -- ALTER TABLE document_signature DROP COLUMN IF EXISTS window_opened_at;
--   -- ALTER TABLE document_signature DROP COLUMN IF EXISTS signing_window_id;
--   -- DROP INDEX IF EXISTS ix_signing_window_open;
--   -- DROP TABLE IF EXISTS signing_window;
-- ============================================================================
