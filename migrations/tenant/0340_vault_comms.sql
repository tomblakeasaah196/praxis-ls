-- ============================================================================
-- TENANT DB — 0340 document vault (MOD-64), compliance checker (MOD-65),
-- QR verification (MOD-66), smart comms (MOD §11.16), portals.
-- ============================================================================

CREATE TABLE document_vault (
  doc_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_uuid         uuid NOT NULL DEFAULT gen_random_uuid(),
  file_context     text CHECK (file_context IN ('OPS','OVH')),
  folder_ref       text,
  doc_type         text,
  storage_path     text NOT NULL,                    -- storage-driver abstract path (local | s3)
  content_hash     text,                             -- SHA-256 (§8.4); QR resolves & re-checks
  version_no       integer NOT NULL DEFAULT 1,
  status           text NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING','VERIFIED','REJECTED','ARCHIVED')),
  entity_ref       text,                             -- source doc it belongs to
  dossier_id       uuid REFERENCES dossier(dossier_id),
  verified_by      uuid REFERENCES app_user(user_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_vault_dossier ON document_vault(dossier_id);
CREATE INDEX ix_vault_hash    ON document_vault(content_hash);

-- Compliance checker flags: missing evidence / unjustified régie aging, etc.
CREATE TABLE compliance_flag (
  flag_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key         text NOT NULL,                    -- 'dossier.missing_bl' | 'advance.aged_unjustified'
  entity_ref       text NOT NULL,
  severity         text NOT NULL DEFAULT 'WARN' CHECK (severity IN ('INFO','WARN','RED')),
  message          text,
  resolved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_flag_open ON compliance_flag(rule_key) WHERE resolved_at IS NULL;

-- Smart Comms (WhatsApp-style, websockets, auditable, exportable) -------------
CREATE TABLE comms_group (
  group_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  kind             text CHECK (kind IN ('DEPARTMENT','PROJECT','DOSSIER','DIRECT','CLIENT')),
  dossier_id       uuid REFERENCES dossier(dossier_id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE comms_message (
  message_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         uuid NOT NULL REFERENCES comms_group(group_id) ON DELETE CASCADE,
  sender_user_id   uuid REFERENCES app_user(user_id),
  body             text,
  media_vault_id   uuid REFERENCES document_vault(doc_id),  -- media < 10MB
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_msg_group ON comms_message(group_id, created_at);

-- External portal access grants (Client / Investor / Auditor), time-boxed ----
CREATE TABLE portal_access (
  portal_access_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal           text NOT NULL CHECK (portal IN ('CLIENT','INVESTOR','AUDITOR')),
  subject_email    citext NOT NULL,
  client_id        uuid REFERENCES client_master(client_id),  -- client portal scope
  starts_at        timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz,                      -- auditor time-box
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_vault_updated BEFORE UPDATE ON document_vault FOR EACH ROW EXECUTE FUNCTION set_updated_at();
