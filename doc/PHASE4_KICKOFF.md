# Praxis LS — Phase 4 Kickoff (Intelligence & reach)

Entry audit for Phase 4, done against `AI_ARCHITECTURE.md`, `AI_KNOWLEDGE.md`,
`AI_READINESS.md` and the module catalogue. Records what already exists, the
scaffold debt that was cleared on entry, and the dependency-ordered build plan.

## 1. What already exists (reusable)

The AI service layer is substantially scaffolded under `src/services/ai/`:
`orchestrator.service`, `retrieval.service`, `ingest.service`, `llm.service`,
`embeddings.service`, `redact`, `chunker`, `action-registry`, plus a `knowledge/`
walker and `scripts/ai/reindex.js`. The tenant AI schema (`migrations/tenant/
0400_ai.sql`) is complete: `ai_feature_flag`, `ai_access_grant`,
`ai_vendor_credential`, `ai_budget_period`, `ai_usage_ledger`,
`ai_action_catalogue`, `ai_document`/`ai_chunk` (pgvector), `ai_conversation`/
`ai_message`, `ai_action_run`. The `ai/assistant` HTTP module (`/api/tenant/ai`,
feature `ai.assistant.backend`) is a thin, correct wrapper over the orchestrator.

Per the AI-readiness rule, **every module now ships a `<module>.ai.js` manifest**
— 32 manifests total (15 added this sprint for the modules built in the Phase-1/2
gap-closure). Each declares `reads` (auto-approved) and `writes` (Zod-gated + RBAC
+ confirm), so the auto-derived tool catalogue equals app capability with no drift.

## 2. Scaffold debt cleared on entry

`ai/governance` and `ai/insights` were **foreign code** (same contamination class
Phase 0 removed): they queried NGN-currency columns (`hard_cap_ngn`,
`cost_price_ngn`), a `config/brands.t(brand, "invoices")` brand-table
architecture, and non-existent business tables (`service_jobs`, `crm_deals`,
`production_runs`, `sales_orders`). None of that matches Praxis LS (XAF/centimes,
schema-per-tenant, `dossier`/`invoice`/…). They were the two modules the loader
had been silently skipping.

Actions taken:
- **Removed** both foreign modules entirely.
- **Rebuilt `ai/governance` real** against the actual `ai_*` schema: the EMV
  feature toggle (`ai_feature_flag`), per-user access grants (`ai_access_grant`),
  spend caps (`ai_budget_period` + `ai_usage_ledger`, soft→WARN / hard→BLOCK), and
  vendor credentials (`ai_vendor_credential`, API keys AES-256-GCM encrypted via
  `encryption.service`, never returned by read APIs). Exposes the runtime guard
  `canUseFeature(user, feature)` and `recordUsage(...)` the orchestrator needs,
  plus `getVendorConfig` (internal, decrypted). Pure rules
  (`estimateCostXaf`/`capState`/`canUse`) are unit-tested.
- Fixed a stale relative-path bug in the remaining AI files
  (`../../config` → `../../../config`).

Result: the loader now discovers and mounts **87/87** modules with zero skips;
`eslint src --quiet` is clean.

## 3. Phase 4 build plan (dependency-ordered)

1. **Action registrar sync** — a boot/CLI step (`scripts/ai/sync-actions.js`)
   that walks the 32 `*.ai.js` manifests → upserts `ai_action_catalogue`
   (`payload_schema` from Zod, `is_write`, `required_permission`,
   `requires_confirmation`) and builds the executor map. (`action-registry.js`
   exists; wire the sync + a test.)
2. **Assistant pipeline hardening** — confirm the orchestrator's
   propose→Zod-validate→RBAC→confirm→execute→log loop end to end; add the
   `ai_action_run.batch_id` migration for multi-write plans; gate every entry on
   `governance.canUseFeature` + `recordUsage`.
3. **worker-ai** (`src/workers/ai/`) — voice-to-text (Groq/Whisper) and
   document-vision (Gemini) jobs feeding the same propose→confirm pipeline;
   event-driven re-embed handler for grounding freshness.
4. **MOD-63 Reporting & Insights** — rebuild `insights` real against Praxis LS
   tables (dossier P&L, receivables ageing, procurement spend, cash position),
   with chat-on-dashboards.
5. **MOD-27 Pricing Variance Index** — the Sales-facing R/Y/G view over
   `pricing_variance` (quote vs actual cost; never exposes raw cost to Sales).
6. **MOD-65 Compliance Checker** — proof-required rules over `cost_entry`/vault.
7. **Portals + Smart Comms** — Client Portal (↔ dossier), Investor/Board terminal
   (↔ statements), Audit data room (↔ vault); WebSocket messaging + certified
   export.

## 4. Test ledger delta

New this entry: `ai-governance` (3), `tax-jurisdiction` (3); `ai-readiness` now
covers all 32 manifests (38 assertions). Full suite remains green.
