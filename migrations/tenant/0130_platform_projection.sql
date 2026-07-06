-- ============================================================================
-- TENANT DB — 0130 feature projection, numbering, settings, immutable ledger,
-- God Mode. `feature_state` is the LOCAL projection of the platform console's
-- decisions (the tenant app reads this, never the platform DB).
-- ============================================================================

-- Resolved feature on/off, projected from platform.* by the sync worker.
-- Read-only to the tenant; only the projection worker writes it.
CREATE TABLE feature_state (
  feature_key      citext PRIMARY KEY,               -- 'ai.assistant' | 'fleet' | 'ai.assistant.backend'
  state            text NOT NULL DEFAULT 'off' CHECK (state IN ('on','off')),
  source           text NOT NULL DEFAULT 'plan' CHECK (source IN ('plan','override','default')),
  projected_at     timestamptz NOT NULL DEFAULT now()
);

-- Document numbering: {PREFIX}-{MODULE}-{YYYY}-{NNNN}. Numbers allocated only on
-- issue/lock, gap-audited. Sequences are PHYSICALLY separate per schema, so a
-- sandbox run never burns a live number.
CREATE TABLE doc_sequence (
  module_key       citext NOT NULL,
  year             smallint NOT NULL,
  entity_id        uuid REFERENCES corporate_entity(entity_id),
  seq              integer NOT NULL DEFAULT 0,
  PRIMARY KEY (module_key, year, entity_id)
);

-- Tenant Settings (MOD-70). Versioned; pushes to the running app, no redeploy.
CREATE TABLE setting (
  setting_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section          text NOT NULL,                    -- 'appearance' | 'legal' | 'finance' | 'comms' | 'workflow'
  key              text NOT NULL,
  value            jsonb NOT NULL DEFAULT '{}'::jsonb,
  version          integer NOT NULL DEFAULT 1,
  updated_by       uuid REFERENCES app_user(user_id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (section, key)
);

-- The immutable ledger / audit trail (MOD-69). Append-only; 10-year retention;
-- read-only to the Audit Terminal. NEVER hard-deleted — not even by God Mode.
CREATE TABLE immutable_ledger (
  ledger_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id    uuid REFERENCES app_user(user_id),
  actor_role       text,
  action           text NOT NULL,                    -- 'invoice.posted' | 'permission.changed' | 'godmode.purge'
  module_key       citext,
  entity_ref       text,
  before_hash      text,
  after_hash       text,
  before_json      jsonb,
  after_json       jsonb,                            -- full payload (God-Mode purge stores what was removed)
  ip               inet,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_ledger_actor  ON immutable_ledger(actor_user_id, created_at DESC);
CREATE INDEX ix_ledger_entity ON immutable_ledger(entity_ref);
CREATE INDEX ix_ledger_action ON immutable_ledger(action, created_at DESC);
CREATE TRIGGER trg_ledger_ro BEFORE UPDATE OR DELETE ON immutable_ledger FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Soft-delete registry (maker-checker restore) for non-accounting data. Every
-- delete/restore also writes to immutable_ledger.
CREATE TABLE soft_delete (
  soft_delete_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_ref       text NOT NULL,
  payload_json     jsonb NOT NULL,                   -- full record for one-click restore
  deleted_by       uuid REFERENCES app_user(user_id),
  deleted_at       timestamptz NOT NULL DEFAULT now(),
  restore_requested_by uuid REFERENCES app_user(user_id),
  restored_by      uuid REFERENCES app_user(user_id), -- must differ from deleted_by (maker-checker)
  restored_at      timestamptz,
  CHECK (restored_by IS NULL OR restored_by <> deleted_by)
);
CREATE INDEX ix_softdelete_open ON soft_delete(entity_ref) WHERE restored_at IS NULL;

CREATE TRIGGER trg_setting_updated BEFORE UPDATE ON setting FOR EACH ROW EXECUTE FUNCTION set_updated_at();
