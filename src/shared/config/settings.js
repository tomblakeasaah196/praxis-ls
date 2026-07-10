/**
 * Tenant settings access (doc/BUILD_CONVENTIONS.md §6). Business rules, numbering
 * schemes, finance defaults etc. live in the `setting` table
 * (section, key, value jsonb) and are edited by the tenant via Settings (MOD-70).
 * Services MUST read rules through here at runtime — never hard-code a value a
 * tenant might reasonably want to change.
 *
 * All functions take the request's tenant client so reads/writes hit the caller's
 * schema (live vs sandbox).
 */
"use strict";

/** Read one setting's value (jsonb) or `fallback` if unset. */
async function getSetting(client, section, key, fallback = null) {
  const { rows } = await client.query(
    "SELECT value FROM setting WHERE section = $1 AND key = $2",
    [section, key],
  );
  return rows[0] ? rows[0].value : fallback;
}

/** Read one field out of a setting's jsonb value, with a default. */
async function getRule(client, section, key, field, fallback = null) {
  const value = await getSetting(client, section, key, null);
  if (value && Object.prototype.hasOwnProperty.call(value, field)) return value[field];
  return fallback;
}

/** All settings in a section as { key: value }. */
async function getSection(client, section) {
  const { rows } = await client.query(
    "SELECT key, value FROM setting WHERE section = $1 ORDER BY key",
    [section],
  );
  return rows.reduce((acc, r) => { acc[r.key] = r.value; return acc; }, {});
}

/** Upsert a setting (bumps version). Returns the row. */
async function putSetting(client, { section, key, value, actor = {} }) {
  const { rows } = await client.query(
    "INSERT INTO setting (section, key, value, updated_by) VALUES ($1, $2, $3::jsonb, $4) " +
      "ON CONFLICT (section, key) DO UPDATE SET value = EXCLUDED.value, " +
      "version = setting.version + 1, updated_by = EXCLUDED.updated_by, updated_at = now() RETURNING *",
    [section, key, JSON.stringify(value ?? {}), actor.user_id || null],
  );
  return rows[0];
}

module.exports = { getSetting, getRule, getSection, putSetting };
