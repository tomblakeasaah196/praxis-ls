-- ============================================================================
-- TENANT DB — 14343 The AI-suggested OHADA posting: its feature flag, and the
-- one-off review of the existing dictionary lines (meeting 6, F3 / F7 / F8).
--
-- ── THE FLAG ROW ───────────────────────────────────────────────────────────
--
-- Exactly as 10775 did for mail AI: `ai_usage_ledger.feature_key` names the
-- feature every call is metered under, and `ai_access_grant.feature_key` is a
-- FOREIGN KEY to `ai_feature_flag` — without this row a tenant could not grant
-- or revoke one user's access, and AI Control would show spend against a
-- feature it had never heard of. ON by default (the tenant's preference); the
-- platform `feature_state` projected from seed 9150 is the ceiling, and it is
-- 'on' for every plan (F7). `default_provider`/`default_model` describe what
-- the feature runs on: Gemini, with the model chosen automatically at runtime
-- (src/services/ai/dictionary-posting/model.service.js) — 'auto' says so.
--
-- ── THE REVIEW (F8) ────────────────────────────────────────────────────────
--
-- "One review of the existing lines": a person starts it from Financial
-- Dictionary settings, the worker compares every line's posting with the
-- suggestion, and lists the lines that differ — changing NOTHING. A person
-- applies a suggestion line by line through the ordinary edit.
--
-- One row per run, one row per line examined. A run RESUMES: the worker
-- skips lines already examined for that run, so a restarted job does not pay
-- twice, and the shared cache makes a second run (or another tenant's) nearly
-- free. `suggestion` holds our structured posting only — never Google text,
-- Links or Search Suggestions (see platform 0119 for the terms); the screen
-- offers a live search on the line for its sources.
--
-- New tables, so they may constrain themselves (the 13791 rule is about
-- pre-existing tables).
-- ============================================================================

INSERT INTO ai_feature_flag (feature_key, display_name, description, is_enabled, default_provider, default_model)
VALUES
  ('ai.dictionary_posting', 'AI-suggested OHADA posting',
   'Suggests the SYSCOHADA posting of a financial-dictionary line (Gemini with Google Search grounding, its own stronger model, shared cache). Nothing is saved without a person.',
   true, 'gemini', 'auto')
ON CONFLICT (feature_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS dictionary_posting_review (
  review_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status        text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'running', 'done', 'failed')),
  started_by    uuid REFERENCES app_user(user_id),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  total         integer NOT NULL DEFAULT 0,
  examined      integer NOT NULL DEFAULT 0,
  mismatches    integer NOT NULL DEFAULT 0,
  fresh_calls   integer NOT NULL DEFAULT 0,
  error         text
);
CREATE INDEX IF NOT EXISTS ix_dictionary_posting_review_started
  ON dictionary_posting_review (started_at DESC);

CREATE TABLE IF NOT EXISTS dictionary_posting_review_line (
  review_id           uuid NOT NULL REFERENCES dictionary_posting_review(review_id) ON DELETE CASCADE,
  dictionary_item_id  uuid NOT NULL REFERENCES dictionary_item(dictionary_item_id) ON DELETE CASCADE,
  outcome             text NOT NULL CHECK (outcome IN ('match', 'mismatch', 'no_suggestion')),
  reasons             text[] NOT NULL DEFAULT '{}',
  suggestion          jsonb,
  source              text,
  model               text,
  cache_entry_id      uuid,
  confidence          text,
  examined_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, dictionary_item_id)
);
CREATE INDEX IF NOT EXISTS ix_dictionary_posting_review_line_outcome
  ON dictionary_posting_review_line (review_id, outcome);

-- ============================================================================
-- VERIFY
--   SELECT feature_key, is_enabled FROM ai_feature_flag WHERE feature_key = 'ai.dictionary_posting';
--
-- DOWN
--   -- DROP TABLE IF EXISTS dictionary_posting_review_line;
--   -- DROP TABLE IF EXISTS dictionary_posting_review;
--   -- DELETE FROM ai_access_grant WHERE feature_key = 'ai.dictionary_posting';
--   -- DELETE FROM ai_feature_flag WHERE feature_key = 'ai.dictionary_posting';
-- ============================================================================
