/**
 * Shared helpers for the DB setup/provisioning scripts.
 * Plain `pg` (no ORM). DDL is run as multi-statement simple queries.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { config } = require("../../src/config/env");

const MIGRATIONS = path.resolve(__dirname, "../../migrations");

// ── migration file sets (ordered) ───────────────────────────────────────────
const sorted = (dir, filter = () => true) =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && filter(f))
    .sort()
    .map((f) => path.join(dir, f));

const files = {
  platform: () => sorted(path.join(MIGRATIONS, "platform")),
  tenantBootstrap: () => [
    path.join(MIGRATIONS, "tenant", "0001_extensions.sql"),
  ],
  tenantSchema: () =>
    sorted(path.join(MIGRATIONS, "tenant"), (f) => !f.startsWith("0001_")),
  tenantSeeds: () =>
    sorted(path.join(MIGRATIONS, "seeds"), (f) => /^90/.test(f)),
  platformSeeds: () =>
    sorted(path.join(MIGRATIONS, "seeds"), (f) => /^91/.test(f)),
};

// ── connections ─────────────────────────────────────────────────────────────
function client(database, { superuser = false } = {}) {
  return new Client({
    host: config.TENANT_DB_HOST_DEFAULT,
    port: config.TENANT_DB_PORT_DEFAULT,
    database,
    user: superuser ? config.TENANT_DB_SUPERUSER : config.DB_USER,
    password: superuser
      ? config.TENANT_DB_SUPERUSER_PASSWORD
      : config.DB_PASSWORD,
    ssl: config.DB_SSL ? { rejectUnauthorized: false } : false,
  });
}

/** Create a database if it does not exist (uses a maintenance connection). */
async function ensureDatabase(dbName) {
  const admin = client("postgres", { superuser: true });
  await admin.connect();
  try {
    const { rows } = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname=$1",
      [dbName],
    );
    if (rows.length === 0) {
      // identifiers can't be parameterised — dbName is validated by the caller.
      await admin.query(`CREATE DATABASE "${dbName}"`);
      log(`created database ${dbName}`);
    } else {
      log(`database ${dbName} already exists`);
    }
  } finally {
    await admin.end();
  }
}

/** Apply an ordered list of .sql files on an open client, optional search_path. */
async function applyFiles(cli, fileList, { searchPath } = {}) {
  for (const f of fileList) {
    const sql = fs.readFileSync(f, "utf8");
    const prefixed = searchPath
      ? `SET search_path = ${searchPath};\n${sql}`
      : sql;
    try {
      await cli.query(prefixed);
      log(
        `  applied ${path.relative(MIGRATIONS, f)}${searchPath ? ` [${searchPath}]` : ""}`,
      );
    } catch (err) {
      throw new Error(
        `Failed applying ${f}${searchPath ? ` [${searchPath}]` : ""}: ${err.message}`,
      );
    }
  }
}

const slugOk = (s) => /^[a-z][a-z0-9_]{1,40}$/.test(s);
const log = (...a) => console.log("[praxis-db]", ...a); // eslint-disable-line no-console

module.exports = {
  files,
  client,
  ensureDatabase,
  applyFiles,
  slugOk,
  log,
  MIGRATIONS,
};
