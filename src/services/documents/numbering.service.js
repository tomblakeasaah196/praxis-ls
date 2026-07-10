/**
 * Tenant-native document numbering (doc/BUILD_CONVENTIONS.md §3/§6).
 *
 * Allocates the next human-readable number for a document type from the tenant's
 * `doc_sequence` counter, formatted by the tenant's own numbering scheme (stored
 * in `setting` section='numbering', key=<module_key>) — tenants CRUD the scheme
 * from Settings; there is no hard-coded format. Sequences are physically per
 * schema (live vs sandbox) so a sandbox run never burns a live number.
 *
 * MUST run inside the caller's transaction so the number and the row commit
 * together (the UPSERT ... RETURNING locks the sequence row, serialising
 * concurrent allocations — gap-free per module/year/entity, KB §23.9 spirit).
 *
 * Replaces the storefront `services/numbering.service.js`, which read
 * `shared.document_numbering` / `shared.business_config` (Pixie Girl), not the
 * tenant `doc_sequence`.
 */
"use strict";

const { AppError } = require("../../utils/errors");

const DEFAULTS = { prefix: "DOC", padding: 4, reset: "yearly", separator: "-" };

/** Pure formatter — tenant scheme + { year, seq } -> string. */
function formatNumber(cfg, { year, seq }) {
  const c = { ...DEFAULTS, ...cfg };
  const parts = [];
  if (c.prefix) parts.push(c.prefix);
  if (c.code) parts.push(c.code);
  if (c.reset === "yearly" && year) parts.push(String(year));
  parts.push(String(seq).padStart(c.padding, "0"));
  return parts.join(c.separator);
}

/** Read the tenant's numbering scheme for a module, merged over defaults. */
async function schemeFor(client, moduleKey) {
  const code = String(moduleKey).replace(/^MOD-/i, "");
  const { rows } = await client.query(
    "SELECT value FROM setting WHERE section = 'numbering' AND key = $1",
    [moduleKey],
  );
  const override = rows[0] ? rows[0].value : {};
  return { ...DEFAULTS, code, ...override };
}

/**
 * Allocate the next number for { moduleKey, entityId, date }. Atomic upsert on
 * doc_sequence. Returns { number, seq, year }.
 */
async function allocate(client, { moduleKey, entityId, date }) {
  if (!moduleKey) throw new AppError("NO_MODULE", "moduleKey is required", 422);
  if (!entityId) throw new AppError("NO_ENTITY", "entityId is required for numbering", 422);
  const cfg = await schemeFor(client, moduleKey);
  const y = date
    ? new Date(String(date).slice(0, 10) + "T00:00:00Z").getUTCFullYear()
    : new Date().getUTCFullYear();
  const year = cfg.reset === "never" ? 0 : y;

  const { rows } = await client.query(
    "INSERT INTO doc_sequence (module_key, year, entity_id, seq) VALUES ($1, $2, $3, 1) " +
      "ON CONFLICT (module_key, year, entity_id) DO UPDATE SET seq = doc_sequence.seq + 1 RETURNING seq",
    [moduleKey, year, entityId],
  );
  const seq = rows[0].seq;
  return { number: formatNumber(cfg, { year, seq }), seq, year };
}

module.exports = { formatNumber, schemeFor, allocate, DEFAULTS };
