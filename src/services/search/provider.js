/**
 * A search provider — how one module answers ⌘K (tenant review, meeting 6,
 * PR 4 — G5).
 *
 * ── DECLARED NEXT TO THE MODULE ─────────────────────────────────────────────
 *
 * A module that has records people look up by number or by name ships a
 * `<module>.search.js` beside its `<module>.ai.js`, exporting one provider (or
 * an array of them) built with `recordProvider` below. `registry.js` discovers
 * them the way the AI action registrar discovers manifests: a module that is
 * not declared is invisible to search. `scripts/check-search-registry.js`
 * fails the build on a module with records and neither a provider nor a
 * written `// search:none <reason>` in its controller.
 *
 * ── WHAT A PROVIDER MAY NOT DO ──────────────────────────────────────────────
 *
 *   · decide who may see it. The search service checks the provider's
 *     `module` with the same `view` grant `requirePermission` checks, BEFORE
 *     the query runs, and a provider without a module key is refused at load;
 *   · choose the environment. It is handed the request's connection, which is
 *     already pinned to LIVE or TEST (`req.tenantDb`), so a TEST search reads
 *     the sandbox schema and nothing else;
 *   · return unbounded rows. `limit` is the service's, and it is applied here.
 *
 * ── HOW IT MATCHES ──────────────────────────────────────────────────────────
 *
 * Every column is compared FOLDED (`search_fold`, 14382: lower-case, no
 * accents) — as a prefix (ranked first), as a substring, and, for a term of
 * four letters or more where pg_trgm is installed, by trigram WORD similarity,
 * which tolerates a one-letter typo ("Ngeuma" finds "Nguema"). The 14382
 * indexes are on exactly these expressions.
 */
"use strict";

/** `%` and `_` typed by a person are letters, not wildcards. */
const escapeLike = (s) => String(s).replace(/[\\%_]/g, (m) => `\\${m}`);

/**
 * @param {object} spec
 * @param {string} spec.type          record type key ("client", "quotation", …)
 * @param {string} spec.module        the MOD-xx whose `view` grant gates it
 * @param {{en: string, fr: string}} spec.label   the group heading
 * @param {string} spec.route         the screen a result opens on (registry route)
 * @param {string} spec.from          FROM clause, aliased
 * @param {string[]} spec.columns     the text columns matched (aliased)
 * @param {string} spec.select        the SELECT list: yields id, ref, title, and
 *                                    optionally title_fr, sub, status, amount,
 *                                    currency, date
 * @param {string} [spec.where]       an extra condition (soft-deleted, merged…)
 * @param {string} [spec.order]       a tie-break after the match rank
 * @param {(row: object) => string} spec.url   where the result opens
 */
function recordProvider(spec) {
  for (const k of ["type", "module", "label", "route", "from", "columns", "select", "url"]) {
    if (!spec[k]) throw new Error(`search provider ${spec.type || "?"}: ${k} is required`);
  }
  if (!/^MOD-/.test(spec.module)) throw new Error(`search provider ${spec.type}: module must be a MOD-xx key`);

  const folded = spec.columns.map((col) => `search_fold(${col}::text)`);

  async function search(c, { folded: q, limit, fuzzy }) {
    const like = `%${escapeLike(q)}%`;
    const prefix = `${escapeLike(q)}%`;
    const fuzzyOn = fuzzy && q.length >= 4;
    const matches = folded.map((f) => `${f} LIKE $1`);
    if (fuzzyOn) matches.push(...folded.map((f) => `$3 <% ${f}`));
    const rank = folded
      .map((f) => `CASE WHEN ${f} LIKE $2 THEN 3 WHEN ${f} LIKE $1 THEN 2 ELSE 0 END`)
      .concat(fuzzyOn ? folded.map((f) => `word_similarity($3, ${f})`) : []);
    const sql = `
      SELECT ${spec.select}, GREATEST(${rank.join(", ")}) AS search_rank
        FROM ${spec.from}
       WHERE (${matches.join(" OR ")})${spec.where ? ` AND (${spec.where})` : ""}
       ORDER BY search_rank DESC${spec.order ? `, ${spec.order}` : ""}
       LIMIT $4`;
    const { rows } = await c.query(sql, [like, prefix, q, limit]);
    // Amounts, dates and statuses travel as data, not as words: the palette
    // formats them in the reader's language (lib/format.ts, day-first).
    return rows.map((r) => ({
      id: String(r.id),
      type: spec.type,
      ref: r.ref || null,
      title: r.title || r.ref || null,
      title_fr: r.title_fr || null,
      sub: r.sub || null,
      status: r.status || null,
      amount: r.amount === null || r.amount === undefined ? null : Number(r.amount),
      currency: r.currency || null,
      date: r.date || null,
      url: spec.url(r),
    }));
  }

  return {
    type: spec.type,
    module: spec.module,
    label: spec.label,
    route: spec.route,
    search,
    // For tests and the gate: what it reads.
    columns: spec.columns,
  };
}

module.exports = { recordProvider, escapeLike };
