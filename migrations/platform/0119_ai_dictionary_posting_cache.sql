-- ============================================================================
-- PLATFORM DB — 0119 The shared answer cache and the model price list for the
-- AI-suggested OHADA posting of a dictionary line (meeting 6, F3 / F7).
--
-- ── WHY ON THE PLATFORM, SHARED BY EVERY TENANT ────────────────────────────
--
-- Owner decision F7: "it caches for future uses to minimize cost to the max".
-- The question asked is GENERIC — the SYSCOHADA treatment of a kind of line
-- ("Gate-Pass Fee", category overhead, direction EXPENSE) — and carries no
-- tenant data at all, so the answer one tenant paid for serves the next for
-- free. A per-tenant cache would pay for the same answer once per tenant.
--
-- ── WHAT IS STORED, AND WHAT GOOGLE'S TERMS FORBID STORING ─────────────────
--
-- The answer comes from Gemini with Grounding with Google Search. The Gemini
-- API Additional Terms (read 2026-10-01) say the developer will not "store
-- (except as provided), cache, copy, frame, … syndicate, resell, analyze,
-- train on, or otherwise learn from Grounded Results or Search Suggestions",
-- that grounded results are displayed only "with the associated Search
-- Suggestion(s) to the end user who submitted the prompt", and the one storage
-- allowance (30 days, display evaluation) excludes Links.
--
-- So a row here holds ONLY our own structured classification — direction,
-- débours flag, VAT treatment in our vocabulary, SYSCOHADA account numbers per
-- posting context, a confidence level — validated by @praxis/shared
-- dictionaryPosting.answer. It holds NO Google text (the model's rationale),
-- NO Links (source titles / URLs) and NO Search Suggestions. Those are shown
-- once, to the person whose request produced them, and are not kept. The
-- brief asked for "the sources" on each entry; the terms do not allow it, and
-- the PR says so.
--
-- ── KEY ────────────────────────────────────────────────────────────────────
--
-- cache_key = normalised label | category | direction ('*' when the person has
-- not chosen one). The label is lower-cased, accents stripped, punctuation and
-- spaces collapsed, and the sibling suffixes ("— Client Account", "— Own
-- Cost", "— Deposit" and the French forms) removed — so every sibling of a
-- service shares the question, and a changed direction asks again.
--
-- `embedding` lets a NEAR hit (same category, high similarity) be found
-- through the embeddings service before any grounded call; NULL when no
-- embeddings vendor is configured. 1536 = the platform corpus dimension (0040).
--
-- An entry is refreshed only when the feature's model changes or it is about
-- twelve months old (`answered_at`).
--
-- ── ONE CALL PER KEY ───────────────────────────────────────────────────────
--
-- `ai_posting_cache_claim` is the cross-instance single-flight: whoever inserts
-- the claim row for a key makes the call; anyone else waits for the cache row.
-- A claim older than 90 s is stale (the caller died) and may be taken over.
--
-- ── PRICES ─────────────────────────────────────────────────────────────────
--
-- `ai_model_price` prices THIS feature's calls by the model actually used,
-- instead of the vendor row's single token price (governance.rules
-- estimateCostNative), which is the platform chat model's price — wrong for a
-- Pro model and blind to search fees. Matched by the LONGEST model_prefix; the
-- '*' row is the conservative price for a model nobody has priced yet.
-- Source and date are on each row. List prices: the monthly free search
-- allowance is not netted, so the ledger never under-states spend.
-- ============================================================================

CREATE TABLE IF NOT EXISTS platform.ai_posting_cache (
  cache_entry_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key        text NOT NULL UNIQUE,
  normalised_label text NOT NULL,
  category         text NOT NULL,
  direction        text NOT NULL DEFAULT '*',
  answer           jsonb NOT NULL,
  model            text NOT NULL,
  answered_at      timestamptz NOT NULL DEFAULT now(),
  hits             integer NOT NULL DEFAULT 0,
  last_hit_at      timestamptz,
  embedding        vector(1536)
);
CREATE INDEX IF NOT EXISTS ix_ai_posting_cache_category ON platform.ai_posting_cache (category, direction);

COMMENT ON TABLE platform.ai_posting_cache IS
  'Shared (all tenants) cache of the generic SYSCOHADA treatment of a kind of dictionary line. Our structured classification only — never Google text, Links or Search Suggestions (Gemini API Additional Terms). 0119.';

CREATE TABLE IF NOT EXISTS platform.ai_posting_cache_claim (
  cache_key   text PRIMARY KEY,
  claimed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.ai_model_price (
  model_prefix           text PRIMARY KEY,
  input_per_1m           numeric(12,6) NOT NULL,
  output_per_1m          numeric(12,6) NOT NULL,
  search_fee             numeric(12,6) NOT NULL DEFAULT 0,
  search_fee_per         integer NOT NULL DEFAULT 1000,
  search_unit            text NOT NULL DEFAULT 'query' CHECK (search_unit IN ('query', 'prompt')),
  currency               char(3) NOT NULL DEFAULT 'USD',
  source                 text NOT NULL,
  as_of                  date NOT NULL,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE platform.ai_model_price IS
  'Per-model list prices for calls priced by the model actually used (meeting 6 F7: the AI-suggested dictionary posting). Longest model_prefix wins; ''*'' is the conservative default. 0119.';

-- Gemini Developer API list prices, prompts ≤ 200k tokens (every call here is
-- a few hundred tokens). Thinking tokens bill as output and are counted so.
INSERT INTO platform.ai_model_price
  (model_prefix, input_per_1m, output_per_1m, search_fee, search_fee_per, search_unit, currency, source, as_of)
VALUES
  ('gemini-3', 2.00, 12.00, 14.00, 1000, 'query', 'USD',
   'Gemini Developer API pricing (ai.google.dev/gemini-api/docs/pricing): Gemini 3.x Pro $2.00 / $12.00 per 1M tokens up to 200k, and Grounding with Google Search on Gemini 3.x $14 per 1,000 search queries after the monthly free allowance', '2026-10-01'),
  ('gemini-2.5-pro', 1.25, 10.00, 35.00, 1000, 'prompt', 'USD',
   'Gemini Developer API pricing: Gemini 2.5 Pro $1.25 / $10.00 per 1M tokens up to 200k, and Grounding with Google Search on 2.5 models $35 per 1,000 grounded prompts after the daily free allowance', '2026-10-01'),
  ('gemini-2.5-flash', 0.30, 2.50, 35.00, 1000, 'prompt', 'USD',
   'Gemini Developer API pricing: Gemini 2.5 Flash $0.30 / $2.50 per 1M tokens, and grounding $35 per 1,000 grounded prompts (2.5 models)', '2026-10-01'),
  ('*', 2.00, 12.00, 14.00, 1000, 'query', 'USD',
   'Conservative default for a model not priced here: the Gemini 3.x Pro rates', '2026-10-01')
ON CONFLICT (model_prefix) DO NOTHING;

-- ============================================================================
-- VERIFY
--   SELECT model_prefix, input_per_1m, output_per_1m, search_fee, search_unit FROM platform.ai_model_price;
--
-- DOWN
--   -- DROP TABLE IF EXISTS platform.ai_model_price;
--   -- DROP TABLE IF EXISTS platform.ai_posting_cache_claim;
--   -- DROP TABLE IF EXISTS platform.ai_posting_cache;
-- ============================================================================
