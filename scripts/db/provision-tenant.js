#!/usr/bin/env node
/**
 * Provision a new tenant — the first-class onboarding tool (WORK_TO_BE_DONE):
 *   1. create the tenant's own Postgres database  (DB-per-tenant, §1)
 *   2. run the full tenant migration set into BOTH schemas (live + sandbox)
 *   3. seed reference data (OHADA COA, Cameroon tax codes, RBAC, events, currencies)
 *   4. register the tenant + its DB connection + subdomain in the platform DB
 *   5. project the plan's resolved feature flags into the tenant's feature_state
 *
 * Usage:
 *   npm run db:provision -- --slug=smartls --name="Smart Logistics" [--plan=full] [--subdomain=smartls.praxisls.com]
 */
"use strict";

const { config } = require("../../src/config/env");
const {
  files,
  client,
  ensureDatabase,
  applyFiles,
  slugOk,
  log,
} = require("./lib");

function args() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function migrateTenantDb(dbName) {
  const cli = client(dbName, { superuser: true });
  await cli.connect();
  try {
    log(`bootstrapping ${dbName} (extensions + live/sandbox schemas)`);
    await applyFiles(cli, files.tenantBootstrap());
    for (const schema of ["live", "sandbox"]) {
      log(`migrating schema ${schema}`);
      await applyFiles(cli, files.tenantSchema(), {
        searchPath: `${schema},public`,
      });
      await applyFiles(cli, files.tenantSeeds(), {
        searchPath: `${schema},public`,
      });
    }
  } finally {
    await cli.end();
  }
}

async function registerAndProject({ slug, name, subdomain, planCode, dbName }) {
  const pf = client(config.DB_NAME); // platform DB (app role is fine here)
  await pf.connect();
  let features;
  try {
    const plan = await pf.query(
      "SELECT plan_id FROM platform.plan WHERE code=$1",
      [planCode],
    );
    if (plan.rows.length === 0) throw new Error(`unknown plan '${planCode}'`);
    const planId = plan.rows[0].plan_id;

    const t = await pf.query(
      `INSERT INTO platform.tenant (slug, legal_name, display_name, plan_id, status)
       VALUES ($1,$2,$2,$3,'PROVISIONING')
       ON CONFLICT (slug) DO UPDATE SET legal_name=EXCLUDED.legal_name, plan_id=EXCLUDED.plan_id
       RETURNING tenant_id`,
      [slug, name, planId],
    );
    const tenantId = t.rows[0].tenant_id;

    await pf.query(
      `INSERT INTO platform.tenant_database
         (tenant_id, db_host, db_port, db_name, app_role, secret_ref, region, capacity_tier)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'S')
       ON CONFLICT (db_host, db_port, db_name) DO NOTHING`,
      [
        tenantId,
        config.TENANT_DB_HOST_DEFAULT,
        config.TENANT_DB_PORT_DEFAULT,
        dbName,
        config.TENANT_DB_APP_ROLE,
        `vault:tenant/${slug}/db-password`,
      ],
    );

    await pf.query(
      `INSERT INTO platform.subdomain (tenant_id, host, is_primary)
       VALUES ($1,$2,true) ON CONFLICT (host) DO NOTHING`,
      [tenantId, subdomain],
    );

    // Resolve feature state = override > (plan includes ? default_state : off).
    const res = await pf.query(
      `SELECT fc.feature_key,
              CASE
                WHEN ov.state IS NOT NULL THEN ov.state
                WHEN pf.included THEN fc.default_state
                ELSE 'off'
              END AS state,
              CASE
                WHEN ov.state IS NOT NULL THEN 'override'
                WHEN pf.included THEN 'plan'
                ELSE 'default'
              END AS source
         FROM platform.feature_catalogue fc
         LEFT JOIN platform.plan_feature pf
                ON pf.feature_key = fc.feature_key AND pf.plan_id = $1
         LEFT JOIN platform.tenant_feature_override ov
                ON ov.feature_key = fc.feature_key AND ov.tenant_id = $2`,
      [planId, tenantId],
    );
    features = res.rows;
    await pf.query(
      "UPDATE platform.tenant SET status='LIVE' WHERE tenant_id=$1",
      [tenantId],
    );
  } finally {
    await pf.end();
  }

  // Write the projection into the tenant DB (both schemas read a local table).
  const cli = client(`tenant_${slug}`, { superuser: true });
  await cli.connect();
  try {
    for (const schema of ["live", "sandbox"]) {
      for (const f of features) {
        await cli.query(
          `INSERT INTO ${schema}.feature_state (feature_key, state, source)
           VALUES ($1,$2,$3)
           ON CONFLICT (feature_key) DO UPDATE SET state=EXCLUDED.state, source=EXCLUDED.source, projected_at=now()`,
          [f.feature_key, f.state, f.source],
        );
      }
    }
    log(`projected ${features.length} feature flags into feature_state`);
  } finally {
    await cli.end();
  }
}

async function main() {
  const a = args();
  const slug = a.slug;
  const name = a.name;
  const planCode = a.plan || "full";
  if (!slug || !slugOk(slug))
    throw new Error(
      "--slug is required (lowercase, [a-z0-9_], starts with a letter)",
    );
  if (!name)
    throw new Error('--name is required (e.g. --name="Smart Logistics")');
  const subdomain = a.subdomain || `${slug}.${config.APP_BASE_DOMAIN}`;
  const dbName = `tenant_${slug}`;

  log(
    `provisioning tenant '${slug}' → db '${dbName}', subdomain '${subdomain}', plan '${planCode}'`,
  );
  await ensureDatabase(dbName);
  await migrateTenantDb(dbName);
  await registerAndProject({ slug, name, subdomain, planCode, dbName });
  log(`tenant '${slug}' provisioned ✓  (Live + Sandbox ready)`);
}

main().catch((err) => {
  console.error("[praxis-db] provisioning FAILED:", err.message); // eslint-disable-line no-console
  process.exit(1);
});
