/**
 * The shared answer cache (platform 0119) — every SQL statement against it.
 *
 * Platform DB, shared by every tenant: one tenant's grounded call answers the
 * next tenant's question for free. Rows hold our structured classification
 * only (see 0119 for what Google's terms forbid storing).
 *
 * Reads and writes go through `platformDb.query` (the serving pool) and are
 * single, indexed statements — nothing here holds a connection across the
 * model call; the cross-instance single-flight is a CLAIM ROW, not a lock.
 */
"use strict";

const platformDb = require("../../platform/db");

/** An entry is fresh for about twelve months, and only for the current model. */
const FRESH_SQL = "answered_at > now() - interval '365 days' AND model = $MODEL";

const ENTRY_COLS = "cache_entry_id, cache_key, normalised_label, category, direction, answer, model, answered_at, hits";

/**
 * The exact hit for a key. An entry asked without a direction ('*') also
 * answers a question WITH one when its own answer chose that direction.
 */
async function exact({ key, keyAny, direction, model }) {
  const { rows } = await platformDb.query(
    `SELECT ${ENTRY_COLS}
       FROM platform.ai_posting_cache
      WHERE ${FRESH_SQL.replace("$MODEL", "$3")}
        AND (cache_key = $1 OR (cache_key = $2 AND ($4::text IS NULL OR answer->>'direction' = $4)))
      ORDER BY (cache_key = $1) DESC
      LIMIT 1`,
    [key, keyAny, model, direction || null],
  );
  return rows[0] || null;
}

/**
 * The nearest entry by embedding: same category, the chosen direction (or
 * any), cosine similarity at or above `threshold`. `vector` is a JS array.
 */
async function near({ vector, category, direction, model, threshold }) {
  if (!Array.isArray(vector) || !vector.length) return null;
  const { rows } = await platformDb.query(
    `SELECT ${ENTRY_COLS}, 1 - (embedding <=> $1::vector) AS similarity
       FROM platform.ai_posting_cache
      WHERE embedding IS NOT NULL
        AND category = $2
        AND ${FRESH_SQL.replace("$MODEL", "$3")}
        AND ($4::text IS NULL OR answer->>'direction' = $4)
      ORDER BY embedding <=> $1::vector
      LIMIT 1`,
    [`[${vector.join(",")}]`, category, model, direction || null],
  );
  const hit = rows[0];
  return hit && Number(hit.similarity) >= threshold ? hit : null;
}

async function touch(id) {
  await platformDb.query(
    "UPDATE platform.ai_posting_cache SET hits = hits + 1, last_hit_at = now() WHERE cache_entry_id = $1",
    [id],
  );
}

async function upsert({ key, normalisedLabel, category, direction, answer, model, vector }) {
  const { rows } = await platformDb.query(
    `INSERT INTO platform.ai_posting_cache (cache_key, normalised_label, category, direction, answer, model, embedding)
     VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
     ON CONFLICT (cache_key) DO UPDATE
       SET answer = EXCLUDED.answer, model = EXCLUDED.model, answered_at = now(),
           embedding = COALESCE(EXCLUDED.embedding, platform.ai_posting_cache.embedding)
     RETURNING ${ENTRY_COLS}`,
    [key, normalisedLabel, category, direction || "*", JSON.stringify(answer), model, Array.isArray(vector) && vector.length ? `[${vector.join(",")}]` : null],
  );
  return rows[0];
}

/** Take the key's claim; true when this caller is the one that must call. */
async function claim(key) {
  const { rows } = await platformDb.query(
    `INSERT INTO platform.ai_posting_cache_claim (cache_key, claimed_at) VALUES ($1, now())
     ON CONFLICT (cache_key) DO UPDATE SET claimed_at = now()
       WHERE platform.ai_posting_cache_claim.claimed_at < now() - interval '90 seconds'
     RETURNING cache_key`,
    [key],
  );
  return rows.length === 1;
}

async function release(key) {
  await platformDb.query("DELETE FROM platform.ai_posting_cache_claim WHERE cache_key = $1", [key]);
}

/** The price list for this feature's calls (0119). */
async function prices() {
  const { rows } = await platformDb.query(
    "SELECT model_prefix, input_per_1m, output_per_1m, search_fee, search_fee_per, search_unit, currency, source, as_of::text AS as_of FROM platform.ai_model_price",
  );
  return rows;
}

module.exports = { exact, near, touch, upsert, claim, release, prices };
