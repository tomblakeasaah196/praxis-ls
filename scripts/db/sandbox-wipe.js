#!/usr/bin/env node
/**
 * Sandbox auto-wipe (kickoff §6): drop and rebuild each tenant's `sandbox`
 * schema, then re-migrate + re-seed baseline reference data. Never touches
 * `live` (different schema). Run on a cron (default every 14 days, per-tenant
 * override in platform.tenant.sandbox_wipe_days).
 *
 * Usage:
 *   node scripts/db/sandbox-wipe.js                # all tenants due for a wipe
 *   node scripts/db/sandbox-wipe.js --slug=smartls --force
 */
"use strict";

const { config } = require("../../src/config/env");
const { files, client, applyFiles, log } = require("./lib");

function args() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

async function listTenants(slug) {
  const pf = client(config.DB_NAME);
  await pf.connect();
  try {
    const { rows } = await pf.query(
      `SELECT t.slug, td.db_name, td.sandbox_schema
         FROM platform.tenant t
         JOIN platform.tenant_database td ON td.tenant_id = t.tenant_id
        WHERE t.status='LIVE' ${slug ? "AND t.slug=$1" : ""}`,
      slug ? [slug] : [],
    );
    return rows;
  } finally {
    await pf.end();
  }
}

async function wipe({ db_name, sandbox_schema }) {
  const cli = client(db_name, { superuser: true });
  await cli.connect();
  try {
    log(`wiping ${db_name}.${sandbox_schema}`);
    await cli.query(`DROP SCHEMA IF EXISTS ${sandbox_schema} CASCADE`);
    await cli.query(`CREATE SCHEMA ${sandbox_schema}`);
    await applyFiles(cli, files.tenantSchema(), {
      searchPath: `${sandbox_schema},public`,
    });
    await applyFiles(cli, files.tenantSeeds(), {
      searchPath: `${sandbox_schema},public`,
    });
  } finally {
    await cli.end();
  }
}

async function main() {
  const a = args();
  const tenants = await listTenants(a.slug);
  if (tenants.length === 0) {
    log("no matching tenants");
    return;
  }
  for (const t of tenants) {
    await wipe(t);
  }
  log(`sandbox wipe complete for ${tenants.length} tenant(s) ✓`);
}

main().catch((err) => {
  console.error("[praxis-db] sandbox wipe FAILED:", err.message); // eslint-disable-line no-console
  process.exit(1);
});
