# Praxis LS — Local Setup

Backend is **Node 20 (CommonJS) + Express + PostgreSQL 16 (pgvector) + Redis**. Tenancy is **one Postgres database per tenant** plus a shared **platform** database (see `doc/DB_ARCHITECTURE.md`).

## Prerequisites
- Node 20 (`.nvmrc` → `nvm use`)
- PostgreSQL 16 with the `pgcrypto`, `citext`, and `vector` (pgvector) extensions available
- Redis 6+
- (PDF worker) Chromium — installed by the Docker image; locally set `PUPPETEER_EXECUTABLE_PATH`

## 1. Install & configure
```bash
npm install
cp .env.example .env      # then edit — see src/config/env.js for every var + default
```
Key vars: `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD` (the **platform** DB the app boots against), `TENANT_DB_SUPERUSER[_PASSWORD]` (used by provisioning to `CREATE DATABASE`), `REDIS_URL`, `JWT_*`, AI keys (`DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY` for embeddings), `EMBEDDINGS_DIM` (must match `ai_chunk.embedding vector(N)` = 1536).

> Rotate every AI/FX key shared during discovery before first use.

## 2. Create & migrate the platform database
```bash
npm run db:migrate:platform
```
Creates the platform DB if missing, applies `migrations/platform/*`, and seeds the module/feature/plan catalogue (all 70 modules).

## 3. Provision a tenant (the onboarding tool)
```bash
npm run db:provision -- --slug=smartls --name="Smart Logistics" --plan=full
# optional: --subdomain=smartls.praxisls.com   (defaults to <slug>.<APP_BASE_DOMAIN>)
```
This single command:
1. creates the tenant's own database `tenant_smartls`,
2. runs the full tenant migration set into **both** `live` and `sandbox` schemas,
3. seeds OHADA chart of accounts, Cameroon tax codes, RBAC, events, currencies,
4. registers the tenant + DB connection + subdomain in the platform DB,
5. projects the plan's resolved feature flags into `feature_state`.

No hand-editing of any tenant database is ever required — everything is driven from here / the company console.

## 4. Run
```bash
npm run dev            # API (nodemon)
npm run dev:worker     # background worker (BullMQ)
# or: docker compose up
```

## Scheduled jobs
- **Sandbox wipe** (kickoff §6, default every 14 days): `npm run db:sandbox:wipe` — drops+rebuilds each tenant's `sandbox` schema and re-seeds; never touches `live`. Wire to cron: `0 3 */14 * *`.
- **FX sync** (daily midnight): `FX_SYNC_CRON` drives the exchangerate-api pull into `fx_rate_daily`.

## Handy scripts (package.json)
| Script | Does |
|---|---|
| `npm run setup` | install + migrate platform |
| `npm run db:migrate:platform` | create/migrate platform DB + catalogue seed |
| `npm run db:provision -- --slug=… --name="…"` | provision a tenant (live+sandbox) |
| `npm run db:sandbox:wipe [-- --slug=…]` | rebuild sandbox schema(s) |
| `npm run db:reset:local` | migrate platform + provision a `smartls` demo tenant |
| `npm run dev` / `dev:worker` | API / worker with reload |
| `npm run lint` / `format` / `test` | eslint / prettier / jest |

## Verification done
The migration set has been applied against a real PostgreSQL 16: **151 tenant tables** in both `live` and `sandbox`, **12 platform tables**, seeds loaded (COA, 20 tax codes, 47 event types, 11 roles, 5 currencies, 72 modules, 32 features). The KB §23 accounting invariants are enforced by DB triggers and were tested to reject unbalanced entries, débours in class 6/7, non-postable/analytic violations, edits to validated entries, and mutations of the immutable ledger.

## Note on the AI layer (next phase)
The schema already includes the per-tenant AI corpus (`ai_document`/`ai_chunk` with pgvector), assistant sessions, the Zod-gated `ai_action_run`, and governance/usage tables — all inside each tenant DB so embeddings never cross tenants. The next build is the ingestion/self-learning pipeline that indexes the tenant DB + platform + codebase into those tables and wires function-calling + vector recall.
