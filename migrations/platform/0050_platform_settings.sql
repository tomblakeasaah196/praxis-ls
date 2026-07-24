-- ============================================================================
-- PLATFORM DB — 0050 platform settings (deploy-wide integrations)
-- Root-admin-managed infrastructure credentials shared by ALL tenants: object
-- storage (S3), geocoding (Geoapify) and Web-Push (VAPID). These are NOT
-- per-tenant — they are one-per-deployment, set + tested in the Platform Console.
--
-- Secrets are AES-256-GCM at rest (same ENCRYPTION_KEY as tenant secrets, via
-- encryption.service) in `secret_enc`; non-secret config lives in `value`. Reads
-- over HTTP return presence + last4 only — the ciphertext never leaves the API.
-- ============================================================================

CREATE TABLE platform.platform_setting (
  section     text NOT NULL,                          -- 'storage' | 'geocoding' | 'push'
  key         text NOT NULL,                          -- 's3' | 'geoapify' | 'vapid'
  value       jsonb NOT NULL DEFAULT '{}'::jsonb,      -- non-secret config
  secret_enc  text,                                    -- AES-256-GCM ciphertext (nullable)
  last4       text,                                    -- last 4 of the plaintext secret
  version     integer NOT NULL DEFAULT 1,
  updated_by  uuid REFERENCES platform.platform_user(platform_user_id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (section, key)
);

CREATE TRIGGER trg_platform_setting_updated
  BEFORE UPDATE ON platform.platform_setting
  FOR EACH ROW EXECUTE FUNCTION platform.set_updated_at();
