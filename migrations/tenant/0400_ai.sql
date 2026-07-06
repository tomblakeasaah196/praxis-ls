-- ============================================================================
-- TENANT DB — 0400 AI: governance (re-homed from Pixie Girl shared.*, XAF not NGN),
-- vectorization (pgvector, kept per product owner), and the Zod-gated action runs.
-- Everything lives INSIDE the tenant DB, so embeddings never cross tenants.
-- Gated by the two-part EMV toggle resolved from feature_state
--   ('ai.assistant' front-end UI, 'ai.assistant.backend' server actions).
-- ============================================================================

-- ── Governance ─────────────────────────────────────────────────────────────
CREATE TABLE ai_feature_flag (
  feature_key      citext PRIMARY KEY,               -- 'assistant' | 'proposal' | 'doc_vision' | 'voice'
  display_name     text NOT NULL,
  description      text,
  is_enabled       boolean NOT NULL DEFAULT true,
  default_provider text NOT NULL DEFAULT 'deepseek', -- DeepSeek primary, Gemini fallback
  default_model    text NOT NULL DEFAULT 'deepseek-chat',
  est_cost_per_call_xaf numeric(18,2),
  last_changed_by  uuid REFERENCES app_user(user_id),
  last_changed_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_access_grant (
  grant_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  feature_key      citext NOT NULL REFERENCES ai_feature_flag(feature_key) ON DELETE CASCADE,
  monthly_cap_xaf  numeric(18,2),
  granted_by       uuid REFERENCES app_user(user_id),
  granted_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz,
  revoked_reason   text,
  UNIQUE (user_id, feature_key)
);

-- Vendor keys stored AES-256-GCM encrypted; read API never returns ciphertext.
CREATE TABLE ai_vendor_credential (
  credential_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor           citext UNIQUE NOT NULL,           -- 'deepseek' | 'gemini' | 'groq' | 'whisper'
  display_name     text,
  api_key_enc      text,
  endpoint_url     text,
  default_model    text,
  current_model    text,
  cost_per_1k_input_tokens  numeric(18,6) NOT NULL DEFAULT 0,
  cost_per_1k_output_tokens numeric(18,6) NOT NULL DEFAULT 0,
  cost_per_audio_minute     numeric(18,6) NOT NULL DEFAULT 0,
  cost_native_currency      char(3),
  per_vendor_monthly_cap_xaf numeric(18,2),
  is_active        boolean NOT NULL DEFAULT true,
  last_rotated_at  timestamptz,
  last_rotated_by  uuid REFERENCES app_user(user_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_budget_period (
  period_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start     date NOT NULL,
  period_end       date NOT NULL,
  soft_cap_xaf     numeric(18,2),
  hard_cap_xaf     numeric(18,2),
  is_active        boolean NOT NULL DEFAULT true,
  set_by           uuid REFERENCES app_user(user_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Append-only usage ledger (every AI call, logged to immutable_ledger too).
CREATE TABLE ai_usage_ledger (
  usage_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id          uuid REFERENCES app_user(user_id),
  feature_key      citext,
  conversation_id  uuid,
  period_id        uuid REFERENCES ai_budget_period(period_id),
  provider         text, model text, call_type text,
  audio_seconds    integer NOT NULL DEFAULT 0,
  input_tokens     integer NOT NULL DEFAULT 0,
  output_tokens    integer NOT NULL DEFAULT 0,
  total_tokens     integer NOT NULL DEFAULT 0,
  cost_native      numeric(18,6) NOT NULL DEFAULT 0,
  cost_native_currency char(3),
  cost_xaf         numeric(18,2) NOT NULL DEFAULT 0,
  latency_ms       integer,
  was_successful   boolean NOT NULL DEFAULT true,
  error_code       text, error_message text,
  occurred_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_aiusage_feature ON ai_usage_ledger(feature_key, occurred_at DESC);
CREATE TRIGGER trg_aiusage_ro BEFORE UPDATE OR DELETE ON ai_usage_ledger FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Whitelisted action catalogue (typed functions the assistant may call).
CREATE TABLE ai_action_catalogue (
  action_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_key       citext UNIQUE NOT NULL,           -- 'create_purchase_order' | 'get_operation_file'
  title            text NOT NULL,
  method           text, route text,
  description      text,
  module_key       citext,
  is_write         boolean NOT NULL DEFAULT false,
  payload_schema   jsonb NOT NULL DEFAULT '{}'::jsonb,   -- the Zod/JSON schema for validation (§10.3)
  required_permission text,
  ai_enabled       boolean NOT NULL DEFAULT false,
  min_confidence   numeric(4,2) NOT NULL DEFAULT 0.80,
  requires_confirmation boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ── Vectorization (pgvector) ────────────────────────────────────────────────
-- Per-tenant semantic corpus for AI recall. 1536-dim default (swap per model).
CREATE TABLE ai_document (
  ai_document_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind      text NOT NULL,                    -- 'dossier' | 'vault_doc' | 'dictionary' | 'message'
  source_ref       text NOT NULL,                    -- pointer back to the authoritative row
  title            text,
  language         char(2),
  dossier_id       uuid REFERENCES dossier(dossier_id),
  -- Field-level confidentiality tag so recall respects RBAC (PRD §7.3).
  confidentiality  text NOT NULL DEFAULT 'normal',
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ai_chunk (
  ai_chunk_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_document_id   uuid NOT NULL REFERENCES ai_document(ai_document_id) ON DELETE CASCADE,
  chunk_no         integer NOT NULL,
  content          text NOT NULL,
  embedding        vector(1536),                     -- pgvector; PII/financial redaction happens before embed
  token_count      integer,
  created_at       timestamptz NOT NULL DEFAULT now()
);
-- Approximate-NN index for cosine similarity search.
CREATE INDEX ix_aichunk_embedding ON ai_chunk
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX ix_aichunk_doc ON ai_chunk(ai_document_id);

-- ── Assistant sessions & the Zod-gated action runs ──────────────────────────
CREATE TABLE ai_conversation (
  conversation_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES app_user(user_id),
  title            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ai_message (
  ai_message_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES ai_conversation(conversation_id) ON DELETE CASCADE,
  role             text NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content          text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ai_action_run (
  action_run_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid REFERENCES ai_conversation(conversation_id),
  user_id          uuid REFERENCES app_user(user_id),
  action_key       citext REFERENCES ai_action_catalogue(action_key),
  proposed_payload jsonb,
  -- The Zod gate: proposed -> (validate, <=2 self-correct) -> confirmed -> executed | manual_fallback
  status           text NOT NULL DEFAULT 'PROPOSED'
                     CHECK (status IN ('PROPOSED','VALIDATION_FAILED','AWAITING_CONFIRM','CONFIRMED','EXECUTED','MANUAL_FALLBACK','REJECTED')),
  retry_count      integer NOT NULL DEFAULT 0,
  validation_error text,
  executed_entity_ref text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_aiflag_updated    BEFORE UPDATE ON ai_feature_flag      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_aivendor_updated  BEFORE UPDATE ON ai_vendor_credential FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_aibudget_updated  BEFORE UPDATE ON ai_budget_period     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_aiaction_updated  BEFORE UPDATE ON ai_action_catalogue  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
