# Praxis LS — Server Deployment (Docker)

Plug-and-play deployment for any Linux host with Docker (VPS / dedicated / DTR
hosting). The stack is four containers: **api** (Node 20 + built SPA, single
origin), **worker** (BullMQ jobs), **postgres** (pgvector/pg16), **redis**.

The image builds the frontend itself (`clientbuild` stage) — you do NOT build
the client on the server or commit `client/dist`.

---

## 0. Prerequisites (once per server)

1. A Linux server (Ubuntu 22+/Debian 12 assumed) with:
   ```bash
   curl -fsSL https://get.docker.com | sh        # Docker Engine + compose plugin
   docker --version && docker compose version
   ```
2. **DNS** — tenants resolve by subdomain (`<slug>.praxisls.com`), so point a
   **wildcard** A record at the server:
   ```
   *.praxisls.com   →  <server IP>
   praxisls.com     →  <server IP>
   ```
   (Replace with your real base domain and set the same value in
   `APP_BASE_DOMAIN` below. A single tenant works with one plain A record.)
3. **Reverse proxy + TLS** — nginx (or Caddy/Traefik). Section 5 has the nginx
   config. A wildcard certificate is required for multi-tenant TLS:
   `certbot -d "*.praxisls.com"` via a DNS-01 challenge.

## 1. Get the code

```bash
git clone <repo-url> praxis-ls && cd praxis-ls
```

## 2. Configure `.env`

```bash
cp .env.example .env
nano .env
```

The compose file overrides the host-specific vars (`DB_HOST=postgres`,
`REDIS_URL=redis://redis:6379`, `NODE_ENV=production`) — do NOT set docker
hostnames in `.env`. What you MUST change:

| Var | Set to |
|---|---|
| `APP_BASE_DOMAIN` | your real base domain (drives tenant-by-subdomain) |
| `DB_PASSWORD`, `TENANT_DB_SUPERUSER_PASSWORD` | one strong password (compose feeds it to Postgres as `POSTGRES_PASSWORD`) |
| `DB_USER`, `TENANT_DB_SUPERUSER` | must match compose's `POSTGRES_USER` (default `praxis-admin` — or set both to the same custom user) |
| `DB_NAME` | must match compose's `POSTGRES_DB` (default `praxislsdata`) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | `openssl rand -hex 32` each |
| `ENCRYPTION_KEY` | `openssl rand -hex 32` (exactly 64 hex chars) |
| `SMTP_HOST/PORT/USER/PASS` | your mail relay (invites, campaigns, dunning) |
| AI keys (`DEEPSEEK/GEMINI/GROQ/OPENAI_API_KEY`) | real keys, or leave `__rotate_me__` to run with AI off |
| `STORAGE_DRIVER` | `local` (default; persisted via the `./data` volume) or `s3` + the `S3_*` vars |

Leave `PORT=8080` and `PUPPETEER_EXECUTABLE_PATH` empty (the image sets it).

## 3. Build + start

```bash
docker compose build     # builds api (incl. the SPA) + worker
docker compose up -d     # starts postgres + redis, RUNS ALL MIGRATIONS
                         # (the one-shot `migrate` service), then api + worker
docker compose ps        # migrate should show "Exited (0)"
```

Migrations run automatically on **every** `up -d` — platform first, then every
tenant DB (live + sandbox). You never run them by hand.

## 4. Create your tenant + logins (first deploy only)

```bash
# create your tenant (its own database, live + sandbox schemas, config seeds)
docker compose run --rm api npm run db:provision -- --slug=smartls --name="Smart Logistics"

# tenant admin (the login you'll use)
docker compose run --rm api npm run tenant:create-admin -- --slug=smartls \
  --email=admin@example.com --password='<strong password>' --name="Admin" --role=CEO

# optional: platform (god-mode) admin
docker compose run --rm api npm run platform:create-admin -- \
  --email=owner@example.com --password='<strong password>'

# optional: sandbox demo dataset (TEST mode)
docker compose run --rm api node scripts/tenant/seed-sandbox.js --slug=smartls
```

## 5. Reverse proxy

```bash
curl -s http://localhost:3000/api/health   # expect {"ok":true,...}
```

nginx site (`/etc/nginx/sites-available/praxis`) — the two non-negotiables are
the **`Host` header passthrough** (tenant resolution + PWA manifest are
Host-based; a wrong/hardcoded Host = "unknown tenant") and the **WebSocket
upgrade** (Smart Comms real-time):

```nginx
server {
    listen 443 ssl http2;
    server_name *.praxisls.com praxisls.com;

    ssl_certificate     /etc/letsencrypt/live/praxisls.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/praxisls.com/privkey.pem;

    client_max_body_size 50m;            # document uploads

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;          # ← REQUIRED
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;  # ← websockets
        proxy_set_header Connection        "upgrade";
        proxy_read_timeout 120s;
    }
}
server {
    listen 80;
    server_name *.praxisls.com praxisls.com;
    return 301 https://$host$request_uri;
}
```

```bash
ln -s /etc/nginx/sites-available/praxis /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

Then open `https://smartls.praxisls.com` → the landing/login page (the SPA is
served by the api container itself; there is no separate frontend server).

## 6. Updating a running deployment

```bash
cd praxis-ls
git pull
docker compose build
docker compose up -d      # migrate runs again automatically, then api/worker recreate
```

Migrations are tracked per file — re-running is safe. If `migrate` exits
non-zero, api/worker keep running on the old schema; check
`docker compose logs migrate`.

## 7. Operations notes

- **Backups** — everything lives in the `praxis_pgdata` volume + `./data`
  (document vault) + `./media` + `./uploads`. Minimum viable backup:
  ```bash
  docker exec praxis_postgres pg_dumpall -U praxis-admin | gzip > backup-$(date +%F).sql.gz
  tar czf files-$(date +%F).tar.gz data media uploads
  ```
- **Logs** — `docker compose logs -f api` / `worker`; files also land in `./logs`.
- **Feature flags** — if a module 403s for everyone (even the CEO), diagnose with
  `docker compose run --rm api node scripts/tenant/feature-report.js --slug=<slug>`.
- **Sandbox reseed after admin re-creation** — if you re-provision an admin and
  TEST-mode writes start failing with "Referenced record not found", re-run
  `seed-sandbox.js` (it re-mirrors identity users; see `SANDBOX_TESTING.md`).
- Postgres/Redis are bound to **127.0.0.1 only** — do not change that on a
  public host.
- The api container runs with `ENABLE_WORKERS=false`; the worker container owns
  the queues. Don't run two workers against one Redis unless intended.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Blank page / JSON 404 at `/` | image built without the SPA — rebuild (`docker compose build api`); the `clientbuild` stage must run |
| "unknown tenant" | proxy not passing `Host`, or DNS/`APP_BASE_DOMAIN` mismatch |
| Login ok, everything else 401 | server clock skew (JWT) — enable NTP |
| `sharp`/`argon2` load error at boot | image built with `npm ci` against the Windows lockfile — the Dockerfile uses `npm install` on purpose; don't "fix" it back |
| Real-time chat not updating | WebSocket upgrade headers missing in the proxy |
| PDF render fails | Chromium is in the image at `/usr/bin/chromium` — ensure `PUPPETEER_EXECUTABLE_PATH` is empty or that path |
