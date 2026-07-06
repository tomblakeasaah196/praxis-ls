/**
 * Shared lazy connection pool to the PLATFORM database (tenant registry).
 * Used by per-request code (auth, controllers) where a pool beats a Client.
 */
"use strict";

const { Pool } = require("pg");
const { config } = require("../../config/env");

let pool = null;
function getPool() {
  if (!pool) {
    pool = new Pool({
      host: config.DB_HOST,
      port: config.DB_PORT,
      database: config.DB_NAME,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      ssl: config.DB_SSL ? { rejectUnauthorized: false } : false,
      max: config.DB_POOL_MAX,
    });
  }
  return pool;
}
const query = (text, params) => getPool().query(text, params);
async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { getPool, query, close };
