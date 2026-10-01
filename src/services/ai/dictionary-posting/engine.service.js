/**
 * The AI-suggested OHADA posting of a dictionary line — the one engine the
 * create wizard, a direction change, the review job and spreadsheet imports
 * all go through (meeting 6, F3 / F7 / F8). Nothing here saves a dictionary
 * line: it returns a suggestion, and a person accepts it or not.
 *
 * ── THE ORDER, CHEAPEST FIRST (F7: "minimize cost to the max") ─────────────
 *
 *   1. an exact hit in the platform cache        free, shared by every tenant
 *   2. a near hit through the embeddings service free (one embedding call)
 *      — same category, similarity ≥ 0.92; skipped with no embeddings vendor
 *   3. a grounded call: Gemini (this feature's own model) + Google Search
 *   4. the labelled local suggestion             tenant lines / OHADA KB
 *
 * Step 3 is gated by this feature's OWN switch (governance canUseFeature
 * with `ai.dictionary_posting` — not the assistant's), the per-user grant,
 * the tenant's budget and the plan's AI spend limit. Blocked, no key, Google
 * down or an unparseable answer all land on step 4, labelled "Suggested
 * without a web search" — never a dead end, never a blocked save.
 *
 * Concurrent requests for the same key make ONE call: an in-process promise
 * per key, and across API instances a claim row (cache.repo.claim) — the
 * second caller waits for the first one's cache row.
 *
 * ── WHAT LEAVES THE TENANT ─────────────────────────────────────────────────
 *
 * The label, the category and the direction. Nothing else: no amounts, no
 * client or supplier, no file, no tenant account label. Mapping the generic
 * answer onto THIS tenant's chart is local (posting.rules.mapToTenant).
 */
"use strict";

const axios = require("axios");
const rules = require("./posting.rules");
const cache = require("./cache.repo");
const modelSvc = require("./model.service");
const governance = require("../../../modules/ai/governance/governance.service");
const embeddings = require("../embeddings.service");
const { resolveVendor } = require("../llm.service");
const { nativeBase } = require("../gemini-transcription.service");
const { logger } = require("../../../config/logger");

const FEATURE_KEY = "ai.dictionary_posting";
const NEAR_THRESHOLD = 0.92;
const CALL_TIMEOUT_MS = 60_000;
const WAIT_FOR_PEER_MS = 45_000;

const inflight = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Tenant context for the local half ───────────────────────────────────── */

async function tenantContext(client) {
  const { rows: accounts } = await client.query(
    "SELECT code::text AS code, label_fr, class, is_postable FROM chart_of_accounts WHERE is_active IS DISTINCT FROM false ORDER BY code",
  );
  const { rows: taxCodes } = await client.query("SELECT tax_code_id, code::text AS code, rate_percent FROM tax_code ORDER BY code");
  return { accounts, taxCodes };
}

/** The tenant's own audited lines most like this one, best first. */
async function similarLines(client, { label_fr, label_en, category, excludeId = null }) {
  const { rows } = await client.query(
    `SELECT di.dictionary_item_id, di.code::text AS code, COALESCE(di.label_en, di.label_fr) AS label,
            di.direction, di.is_disbursement,
            GREATEST(similarity(COALESCE(di.label_en, ''), $1), similarity(di.label_fr, $2)) AS similarity,
            bool_or(pr.tax_code_id IS NOT NULL) AS taxed,
            json_agg(json_build_object('applies_context', pr.applies_context,
                                       'debit_account', pr.debit_account,
                                       'credit_account', pr.credit_account) ORDER BY pr.applies_context) AS rules
       FROM dictionary_item di
       JOIN posting_rule pr ON pr.dictionary_item_id = di.dictionary_item_id
      WHERE di.is_active = true
        AND di.category = $3
        AND ($4::uuid IS NULL OR di.dictionary_item_id <> $4::uuid)
      GROUP BY di.dictionary_item_id
      ORDER BY similarity DESC
      LIMIT 5`,
    [label_en || label_fr, label_fr, category, excludeId],
  );
  return rows;
}

/* ── Wording the screen shows (ours, never Google's) ────────────────────── */

const accountName = (accounts, code) => {
  const a = accounts.find((x) => String(x.code) === String(code));
  return a ? `${a.code} ${a.label_fr || ""}`.trim() : String(code || "—");
};

/** A short rationale written from OUR structured answer and the tenant chart. */
function ourRationale(answer, accounts) {
  const lines = answer.postings.map(
    (p) => `${p.context}: debit ${accountName(accounts, p.debit)}, credit ${accountName(accounts, p.credit)}`,
  );
  const vat =
    answer.vat_treatment === "DISBURSEMENT"
      ? "A débours: re-billed at cost, no VAT of ours."
      : answer.vat_treatment === "EXEMPT"
        ? "No VAT."
        : "Standard VAT applies.";
  return `${lines.join("; ")}. ${vat}`;
}

/* ── The result shape ────────────────────────────────────────────────────── */

function shape({ source, answer, ctx, model = null, entry = null, extra = {} }) {
  const mapped = rules.mapToTenant(answer, ctx);
  return {
    source,
    model: model || (entry && entry.model) || null,
    cache_entry_id: entry ? entry.cache_entry_id : null,
    answered_at: entry ? entry.answered_at : null,
    direction: answer.direction,
    is_disbursement: answer.is_disbursement,
    vat_treatment: answer.vat_treatment,
    generic: answer.postings,
    rules: mapped.rules,
    needs_mint: mapped.needs_mint,
    confidence: mapped.confidence,
    // "Check this one" stays on a low-confidence posting until a person confirms it.
    check_needed: mapped.confidence === "low",
    rationale: extra.rationale || ourRationale(answer, ctx.accounts),
    sources: extra.sources || [],
    search_suggestion_html: extra.search_suggestion_html || null,
    matched_label: extra.matched_label || null,
    similarity: extra.similarity ?? null,
    fallback_reason: extra.fallback_reason || null,
    basis: extra.basis || null,
    cost: extra.cost || { native: 0, currency: null, search: 0, note: "no model call" },
  };
}

function local(ctx, q, similar, reason) {
  const { answer, basis } = rules.localSuggestion({ category: q.category, direction: q.direction, similar });
  const why =
    basis.kind === "tenant_line"
      ? `Posted like your line “${basis.label}” (${basis.code}).`
      : `The SYSCOHADA default for this direction (${basis.ref}).`;
  return shape({
    source: "local",
    answer,
    ctx,
    extra: {
      rationale: `${why} ${ourRationale(answer, ctx.accounts)}`,
      sources: basis.kind === "ohada_kb" ? [{ title: basis.ref, uri: null }] : [],
      fallback_reason: reason,
      basis,
    },
  });
}

/* ── The grounded call ───────────────────────────────────────────────────── */

async function groundedCall({ vendor, model, q }) {
  const url = `${nativeBase(vendor.endpoint_url)}/models/${encodeURIComponent(model)}:generateContent`;
  const started = Date.now();
  const { data } = await axios.post(
    url,
    {
      systemInstruction: { parts: [{ text: rules.SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: rules.buildPrompt(q) }] }],
      // Grounding with Google Search. JSON is asked for in the prompt and
      // parsed strictly: structured-output mode and the search tool are not
      // offered together on every model this may choose.
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
    },
    {
      headers: { "x-goog-api-key": vendor.api_key, "Content-Type": "application/json" },
      timeout: CALL_TIMEOUT_MS,
    },
  );
  return { data, latency_ms: Date.now() - started };
}

async function meter(client, { userId, model, parsed, latencyMs, ok = true, errorCode = null, errorMessage = null }) {
  let prices = [];
  try {
    prices = await cache.prices();
  } catch (err) {
    logger.warn({ err }, "dictionary posting: price list unavailable — metering at 0");
  }
  const price = rules.priceFor(prices, model);
  const cost = rules.priceCall(price, parsed ? { ...parsed.usage, queries: parsed.queries, grounded: parsed.grounded } : {});
  // One row for the model's tokens at ITS OWN price, one for the searches —
  // never the vendor row's single token price (governance.rules
  // estimateCostNative), which is the platform chat model's.
  await governance.recordUsage(client, {
    userId, featureKey: FEATURE_KEY, provider: "gemini", model, callType: "grounded_generate",
    inputTokens: parsed ? parsed.usage.input_tokens : 0,
    outputTokens: parsed ? parsed.usage.output_tokens : 0,
    costNative: cost.tokens, costNativeCurrency: cost.currency,
    latencyMs, wasSuccessful: ok, errorCode, errorMessage,
  });
  if (parsed && cost.search > 0) {
    await governance.recordUsage(client, {
      userId, featureKey: FEATURE_KEY, provider: "gemini", model, callType: "google_search",
      costNative: cost.search, costNativeCurrency: cost.currency, wasSuccessful: true,
    });
  }
  return { native: cost.tokens + cost.search, tokens: cost.tokens, search: cost.search, currency: cost.currency, search_units: cost.search_units, price_source: price ? price.source : null };
}

/* ── The engine ──────────────────────────────────────────────────────────── */

/**
 * suggest(client, q, opts) → the suggestion (see `shape`).
 *   q     { label_fr, label_en?, category, direction?, fresh? }
 *   opts  { userId, excludeId?, allowCall = true, callBudget? }
 *         `allowCall: false` skips step 3 (an import past its cap of fresh
 *         calls) and says so; `callBudget` is a { left } counter the caller
 *         shares across rows.
 */
async function suggest(client, q, { userId = null, excludeId = null, allowCall = true, callBudget = null } = {}) {
  const query = {
    label_fr: q.label_fr,
    label_en: q.label_en || null,
    category: q.category,
    direction: q.direction || null,
  };
  const key = rules.cacheKey(query);
  const keyAny = rules.cacheKey({ ...query, direction: null });
  const normalised = rules.normaliseLabel(rules.questionLabel(query));
  const ctx = await tenantContext(client);
  const modelInfo = await modelSvc.postingModel();
  const model = modelInfo.model;

  // 1–2. The cache, unless the person asked to search again.
  if (!q.fresh && model) {
    try {
      const hit = await cache.exact({ key, keyAny, direction: query.direction, model });
      if (hit) {
        await cache.touch(hit.cache_entry_id);
        return shape({ source: "cache", answer: hit.answer, ctx, entry: hit, extra: { cost: { native: 0, currency: null, search: 0, note: "shared answer — no cost" } } });
      }
      const vector = await embeddings.embedOne(client, normalised);
      const nearHit = await cache.near({ vector, category: query.category, direction: query.direction, model, threshold: NEAR_THRESHOLD });
      if (nearHit) {
        await cache.touch(nearHit.cache_entry_id);
        return shape({
          source: "near_cache", answer: nearHit.answer, ctx, entry: nearHit,
          extra: {
            matched_label: nearHit.normalised_label,
            similarity: Number(nearHit.similarity),
            cost: { native: 0, currency: null, search: 0, note: "shared answer — no cost" },
          },
        });
      }
    } catch (err) {
      // The cache is an optimisation: a platform hiccup goes on to the call.
      logger.warn({ err }, "dictionary posting: cache lookup failed — asking afresh");
    }
  }

  const similarOnce = () => similarLines(client, { ...query, excludeId });

  // 3. The grounded call — gated, keyed, single-flight.
  if (!allowCall || (callBudget && callBudget.left <= 0)) {
    return local(ctx, query, await similarOnce(), "the fresh-search allowance for this run is used up");
  }
  const gate = await governance.canUseFeature(client, { userId, featureKey: FEATURE_KEY });
  if (!gate.allowed) return local(ctx, query, await similarOnce(), gate.reason);
  const vendor = await resolveVendor(null, "gemini").catch(() => null);
  if (!vendor || !vendor.api_key || !model) return local(ctx, query, await similarOnce(), "no Gemini key is configured on the platform");

  if (inflight.has(key)) {
    const peer = await inflight.get(key).catch(() => null);
    if (peer && peer.answer) return shape({ source: "cache", answer: peer.answer, ctx, entry: peer.entry, extra: { cost: { native: 0, currency: null, search: 0, note: "shared answer — no cost" } } });
  }

  const run = (async () => {
    const mine = await cache.claim(key).catch(() => true);
    if (!mine) {
      // Another instance is asking this exact question: wait for its answer.
      const until = Date.now() + WAIT_FOR_PEER_MS;
      while (Date.now() < until) {
        await sleep(1500);
        const hit = await cache.exact({ key, keyAny, direction: query.direction, model }).catch(() => null);
        if (hit) return { answer: hit.answer, entry: hit, fromPeer: true };
      }
    }
    try {
      if (callBudget) callBudget.left -= 1;
      let response;
      try {
        response = await groundedCall({ vendor, model, q: query });
      } catch (err) {
        const status = err.response && err.response.status;
        const message = (err.response && err.response.data && err.response.data.error && err.response.data.error.message) || err.message;
        if (status === 400 || status === 404) modelSvc.markFailed(model, message);
        await meter(client, { userId, model, parsed: null, latencyMs: null, ok: false, errorCode: status ? `HTTP_${status}` : "NETWORK", errorMessage: String(message).slice(0, 300) }).catch(() => null);
        throw Object.assign(new Error(`Google could not be reached (${status || "network"})`), { code: "UNAVAILABLE" });
      }
      let parsed;
      try {
        parsed = rules.parseGrounded(response.data);
      } catch (err) {
        // The call was made and is paid for, even though its answer is unusable.
        const usage = (response.data && response.data.usageMetadata) || {};
        const pseudo = { usage: { input_tokens: Number(usage.promptTokenCount || 0), output_tokens: Number(usage.candidatesTokenCount || 0) + Number(usage.thoughtsTokenCount || 0) }, queries: 0, grounded: false };
        await meter(client, { userId, model, parsed: pseudo, latencyMs: response.latency_ms, ok: false, errorCode: err.code, errorMessage: err.message });
        throw err;
      }
      const cost = await meter(client, { userId, model, parsed, latencyMs: response.latency_ms });
      let vector = null;
      try {
        vector = await embeddings.embedOne(client, normalised);
      } catch (err) {
        // No vector: the exact key still caches; only the near hit is lost.
        logger.debug({ err }, "dictionary posting: no embedding for the cache entry");
      }
      const entry = await cache
        .upsert({ key, normalisedLabel: normalised, category: query.category, direction: query.direction, answer: rules.cacheable(parsed.answer), model, vector })
        .catch((err) => {
          logger.warn({ err }, "dictionary posting: the answer could not be cached");
          return null;
        });
      return { answer: parsed.answer, entry, parsed, cost };
    } finally {
      if (mine) await cache.release(key).catch(() => null);
    }
  })();
  inflight.set(key, run);
  try {
    const out = await run;
    if (out.fromPeer) {
      return shape({ source: "cache", answer: out.answer, ctx, entry: out.entry, extra: { cost: { native: 0, currency: null, search: 0, note: "shared answer — no cost" } } });
    }
    return shape({
      source: "search",
      answer: out.answer,
      ctx,
      model,
      entry: out.entry,
      extra: {
        // Google's own text, links and Search Suggestions — shown to the
        // person who asked, with the answer, and NOT stored anywhere.
        rationale: out.answer.rationale || undefined,
        sources: out.parsed.sources,
        search_suggestion_html: out.parsed.search_suggestion_html,
        cost: out.cost,
      },
    });
  } catch (err) {
    const reason =
      err.code === "UNPARSEABLE" ? "the web search answer could not be read"
        : err.code === "BLOCKED" ? "the web search refused the question"
          : "Google could not be reached";
    logger.warn({ err: err.message, code: err.code }, "dictionary posting: falling back to the local suggestion");
    return local(ctx, query, await similarOnce(), reason);
  } finally {
    inflight.delete(key);
  }
}

module.exports = { suggest, FEATURE_KEY, NEAR_THRESHOLD, similarLines, tenantContext };
