/**
 * ⌘K's record search — one term, every module that answers for it, and only
 * what this person may open (tenant review, meeting 6, PR 4 — G5).
 *
 * ── WHO MAY SEE WHAT ────────────────────────────────────────────────────────
 *
 * `allowedModules` asks the SAME question `requirePermission(module, "view")`
 * asks, through the same cached grant read (identity-cache `getGrants`, the
 * `can_read` column), for every provider's module — before any provider runs.
 * A provider whose module the person cannot view is never queried, so its
 * rows cannot leak through a count, a timing or an error. The CEO bypass is
 * rbac.js's, and only that.
 *
 * ── LIVE / TEST ─────────────────────────────────────────────────────────────
 *
 * Providers run on the request's tenant connection (`req.tenantDb`), which is
 * already pinned to the LIVE or the sandbox schema by tenant-context. A TEST
 * search reads TEST rows and nothing else; there is no environment argument to
 * get wrong.
 *
 * ── BOUNDED ─────────────────────────────────────────────────────────────────
 *
 * Every group is LIMITed (default 5, at most 10), the whole search runs under
 * a 2-second statement timeout, and each provider sits in its own SAVEPOINT: a
 * provider that fails (a column renamed under it, pg_trgm absent) costs its
 * own group, never the others — the palette still answers. The route is rate
 * limited per user (search.routes.js).
 */
"use strict";

const { search: shared } = require("@praxis/shared");
const { atomically } = require("../../shared/db/tx");
const identityCache = require("../../shared/cache/identity-cache");
const { logger } = require("../../config/logger");
const registry = require("./registry");

const DEFAULT_LIMIT = 5;

/** Which of these modules the person may view — rbac.js's answer, per module. */
async function allowedModules(identityClient, user, modules) {
  const wanted = [...new Set(modules)];
  if (!user) return new Set();
  if (user.is_ceo === true) return new Set(wanted);
  const out = new Set();
  for (const module of wanted) {
    const grants = await identityCache.getGrants(identityClient, { role_ids: user.role_ids, module });
    if (grants.some((g) => g.can_read === true)) out.add(module);
  }
  return out;
}

/**
 * "facture 0042", "0042 facture", "client acme": a synonym-list word at either
 * end of the term that names a record type narrows the search to that type
 * and searches the rest. A term that is ONLY a type word ("factures") is not a
 * hint — it is a search for the page, which the palette answers itself.
 */
function typeHint(term, known) {
  const words = term.split(/\s+/);
  if (words.length < 2) return null;
  const tryEnd = (head, rest) => {
    const key = shared.conceptOf(head);
    if (!key || !known.has(key)) return null;
    const remainder = rest.join(" ").trim();
    return remainder.length >= 2 ? { type: key, term: remainder } : null;
  };
  // Two-word phrases first ("bon de commande 12" is three words of hint).
  for (let n = Math.min(4, words.length - 1); n >= 1; n -= 1) {
    const front = tryEnd(words.slice(0, n).join(" "), words.slice(n));
    if (front) return front;
    const back = tryEnd(words.slice(-n).join(" "), words.slice(0, -n));
    if (back) return back;
  }
  return null;
}

/** Is pg_trgm usable on this connection's search_path? Decides the typo pass. */
async function trigramReady(c) {
  const { rows } = await c.query(
    `SELECT EXISTS (
       SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname = 'pg_trgm' AND n.nspname = ANY (current_schemas(true))
     ) AS ok`,
  );
  return rows[0] ? rows[0].ok === true : false;
}

/**
 * @param c          the request's tenant connection (LIVE or TEST, pinned)
 * @param q          the term, as typed
 * @param types      record types asked for (null = all)
 * @param limit      rows per group
 * @param allowed    Set of module keys this person may view (allowedModules)
 */
async function search(c, { q, types = null, limit = DEFAULT_LIMIT, allowed }) {
  let term = String(q || "").replace(/\s+/g, " ").trim().slice(0, 80);
  const all = registry.providers();
  const known = new Set(all.map((p) => p.type));
  let wanted = types && types.length ? new Set(types) : null;

  const hint = !wanted ? typeHint(term, known) : null;
  if (hint) {
    wanted = new Set([hint.type]);
    term = hint.term;
  }
  const out = { q: term, hint: hint ? hint.type : null, groups: [] };
  if (term.length < 2) return out;

  const run = all.filter((p) => allowed.has(p.module) && (!wanted || wanted.has(p.type)));
  if (!run.length) return out;

  const folded = shared.fold(term);
  const fuzzy = await trigramReady(c);
  const max = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), 10);

  await atomically(c, async () => {
    // Transaction-local: the timeout and the typo threshold end with this search.
    await c.query(
      "SELECT set_config('statement_timeout', '2000', true), set_config('pg_trgm.word_similarity_threshold', '0.4', true)",
    );
    for (const p of run) {
      await c.query("SAVEPOINT praxis_search");
      try {
        const items = await p.search(c, { term, folded, limit: max, fuzzy });
        await c.query("RELEASE SAVEPOINT praxis_search");
        if (items.length) out.groups.push({ type: p.type, module: p.module, label: p.label, route: p.route, items });
      } catch (err) {
        await c.query("ROLLBACK TO SAVEPOINT praxis_search");
        // taxonomy: degraded-optional — one module's search failing costs its
        // own group; the palette still answers from every other module.
        logger.warn({ err, type: p.type }, "search provider failed");
      }
    }
  });
  return out;
}

module.exports = { search, allowedModules, typeHint, trigramReady, DEFAULT_LIMIT };
