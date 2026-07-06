#!/usr/bin/env node
/**
 * Create (if needed) and migrate the PLATFORM database — the tenant registry the
 * company dashboard drives. Idempotent-friendly: migrations use IF NOT EXISTS
 * where practical; re-running after a partial failure may need a clean DB.
 *
 * Usage: npm run db:migrate:platform
 */
"use strict";

const { config } = require("../../src/config/env");
const { files, client, ensureDatabase, applyFiles, log } = require("./lib");

async function main() {
  const dbName = config.DB_NAME;
  await ensureDatabase(dbName);

  const cli = client(dbName, { superuser: true });
  await cli.connect();
  try {
    log(`migrating platform db "${dbName}"`);
    await applyFiles(cli, files.platform());
    log("seeding platform catalogue (modules, features, plans)");
    await applyFiles(cli, files.platformSeeds());
    log("platform migration complete ✓");
  } finally {
    await cli.end();
  }
}

main().catch((err) => {
  console.error("[praxis-db] platform migration FAILED:", err.message); // eslint-disable-line no-console
  process.exit(1);
});
