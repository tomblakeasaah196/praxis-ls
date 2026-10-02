-- ============================================================================
-- SEED (PLATFORM DB) — 9150 `ai.dictionary_posting`: ON for every tenant.
--
-- Meeting 6 (29 Sep 2026), owner decision F7, in the owner's words: "Seed a
-- stronger Gemini model JUST FOR THIS feature … This model works just here.
-- Every tenant should have it. … We don't need to manually configure anything.
-- It should be automated."
--
-- ── THE DELIBERATE EXCEPTION TO 9110 ───────────────────────────────────────
--
-- 9110's header explains why `ai.*` keys default to 'off': AI is opt-in by
-- design and the front-end AI gate fails safe. THIS key is the owner's
-- deliberate exception (F7) — its default_state is 'on', it is in EVERY plan
-- and it depends on nothing, so the AI-suggested OHADA posting of a dictionary
-- line works on a tenant whose assistant is off, with nothing for anyone to
-- configure.
--
-- The exception is recorded HERE rather than in 9110's own header because
-- 9110 is applied fleet-wide and frozen: scripts/db/migration-idempotency-
-- baseline.json pins it byte for byte, and the migrator's sha256 ledger would
-- flag an edited header as content drift on every tenant (WS-S4). A file that
-- cannot be edited is annotated by the file that makes the exception.
--
-- It is its own feature, gated by its own switch (governance.service
-- canUseFeature) — not by `ai.assistant.backend`. Turning the assistant off
-- does not turn this off, and the reverse. The per-user grant, the tenant's
-- own AI budget and the plan's AI spend limit still apply to it.
--
-- `migrateTenant` re-projects features after migrating, so existing and newly
-- provisioned tenants pick it up on the next deploy with no console or tenant
-- action.
--
-- Idempotent: upserts on conflict.
-- ============================================================================

INSERT INTO platform.feature_catalogue (feature_key, module_key, name, default_state, depends_on) VALUES
 ('ai.dictionary_posting', 'MOD-05', 'AI-suggested OHADA posting of dictionary lines', 'on', '{}')
ON CONFLICT (feature_key) DO UPDATE SET
  module_key    = EXCLUDED.module_key,
  name          = EXCLUDED.name,
  default_state = EXCLUDED.default_state,
  depends_on    = EXCLUDED.depends_on;

-- In EVERY plan that exists, the starter plan included. (A plan created later
-- in the console chooses its own features there, like every other key.)
INSERT INTO platform.plan_feature (plan_id, feature_key, included)
SELECT p.plan_id, 'ai.dictionary_posting', true FROM platform.plan p
ON CONFLICT (plan_id, feature_key) DO UPDATE SET included = true;

-- ============================================================================
-- DOWN
--   -- DELETE FROM platform.plan_feature WHERE feature_key = 'ai.dictionary_posting';
--   -- DELETE FROM platform.feature_catalogue WHERE feature_key = 'ai.dictionary_posting';
-- ============================================================================
