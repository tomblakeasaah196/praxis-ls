/**
 * Live FX sync core (MOD-08) — ONE implementation shared by the "Sync now"
 * button (runs in-request via req.tenantDb) and the daily midnight cron (runs in
 * the fx-sync worker via withTenantConnection). Both hand it a tenant client, so
 * the fetch/upsert logic and the key-resolution order never drift between them.
 *
 * The key is resolved in priority order (BUILD_CONVENTIONS §7 — NOT .env-only):
 *   1. encrypted integration_secret 'fx_exchangerate' (Settings, AES-256-GCM)
 *   2. legacy plaintext setting fx.exchangerate_api_key (back-compat)
 *   3. config.EXCHANGERATE_API_KEY or config.FX_API_KEY (deploy default)
 *
 * Rates are written with source 'exchangerate-api' and is_override=false, so a
 * manual override (source 'manual', is_override=true) always wins in the
 * resolver and a failed/late feed can never corrupt a hand-set rate.
 *
 * A FIXED PARITY is never written (meeting 6, F1). XAF/XOF ↔ EUR is 655.957 by
 * treaty; the feed's 0.001524 is that figure rounded to four significant digits,
 * and storing it is how the Currencies screen came to show 656.168. Pegged
 * pairs are skipped and reported under `fixed`, so the run says why they were
 * not updated rather than looking like the provider dropped them.
 */
"use strict";
const axios = require("axios");
const repo = require("./currency.repo");
const { getSetting } = require("../../../shared/config/settings");
const settingService = require("../../security/setting/setting.service");
const { atomically } = require("../../../shared/db/tx");
const { config } = require("../../../config/env");
const { currencies } = require("@praxis/shared");

async function resolveKey(client) {
  return (
    (await settingService.readSecret(client, "fx_exchangerate")) ||
    (await getSetting(client, "fx", "exchangerate_api_key", null)) ||
    config.EXCHANGERATE_API_KEY ||
    config.FX_API_KEY ||
    null
  );
}

/**
 * Fetch base→quotes from exchangerate-api.com and upsert each as today's feed
 * rate. Resolves base (the tenant's base currency) and quotes (all other active
 * currencies) from the DB when the caller does not pass them.
 *
 * @returns { base, as_of_date, fetched_at, source, updated: [{quote, rate}], unsupported: [code] }
 *          on a real run, or { skipped: true, reason } when the run was a no-op
 *          (no key configured, no active quote currencies).
 *
 * `skipped` is ALWAYS a boolean — the sentinel that says "no HTTP call was
 * made, no rows were written". Quote codes the provider returned no rate for
 * live on `unsupported` on a success payload. This split matters: callers
 * check `if (result.skipped === true)` (or the negation) to gate audit,
 * event-emission and the UI banner. The previous shape overloaded `skipped`
 * as an array on success — and an empty array is truthy in JS, so a fully
 * successful sync (four rates for XAF against CNY/EUR/NGN/USD → `skipped: []`)
 * looked like a skip to every caller: `service.syncNow` never emitted its
 * `RATE_SYNCED` audit, and the client's "Sync now" banner permanently read
 * "Sync skipped — no API key configured." even though rates were being
 * written. Boolean-only sentinel keeps the two states unambiguously distinct.
 */
async function syncRates(client, { base, quotes } = {}) {
  const baseCode = base || (await repo.getBaseCode(client)) || "XAF";
  const candidates = (quotes || (await repo.listActiveCodes(client))).filter((q) => q && q !== baseCode);
  const fixed = candidates
    .map((q) => currencies.fixedParity(baseCode, q))
    .filter(Boolean)
    .map((p) => ({ quote: p.quote, rate: p.rate, authority: p.authority }));
  const quoteCodes = candidates.filter((q) => !currencies.isFixedPair(baseCode, q));

  const key = await resolveKey(client);
  if (!key) {
    return {
      skipped: true,
      reason:
        "No exchangerate-api key configured (integration_secret 'fx_exchangerate', fx.exchangerate_api_key, EXCHANGERATE_API_KEY, or FX_API_KEY).",
    };
  }
  if (!quoteCodes.length) {
    return {
      skipped: true,
      base: baseCode,
      fixed,
      reason: fixed.length ? "every active quote currency is at a fixed parity" : "no active quote currencies",
    };
  }

  const url = "https://v6.exchangerate-api.com/v6/" + key + "/latest/" + baseCode;

  // `validateStatus: () => true` — axios must NOT throw on a non-2xx here.
  const res = await axios.get(url, { timeout: 15000, validateStatus: () => true });
  const data = res.data;

  if (res.status === 404) {
    // NEVER interpolate `url` — the API key is a path segment, and this message
    // is stored in platform.error_event and rendered in the Error Center.
    throw new Error(
      "exchangerate-api: 404 — the API key in the request path was not recognised. "
      + "Check integration_secret 'fx_exchangerate', the fx.exchangerate_api_key setting, "
      + `or EXCHANGERATE_API_KEY (base was ${baseCode}).`,
    );
  }
  if (res.status !== 200) {
    throw new Error(`exchangerate-api: HTTP ${res.status}${data && data["error-type"] ? ` — ${data["error-type"]}` : ""}`);
  }
  if (data && data.result === "error") {
    throw new Error("exchangerate-api: " + (data["error-type"] || "unknown error"));
  }
  const rates = (data && data.conversion_rates) || {};
  const fetchedAt = new Date().toISOString();
  const asOf = fetchedAt.slice(0, 10);

  // ONE TRANSACTION for the whole daily run (audit #6 — no partial write). A
  // database failure part-way through would otherwise leave some quotes at
  // today's rate and others stale, with no signal that the run was incomplete.
  // Feed rows only (is_override=false), so a manual override is never touched.
  const updated = [];
  const unsupported = [];
  await atomically(client, async () => {
    for (const quote of quoteCodes) {
      const rate = Number(rates[quote]);
      if (!(rate > 0)) {
        unsupported.push(quote);
        continue;
      }
      await repo.upsertRate(client, { base: baseCode, quote, rate, asOfDate: asOf, source: "exchangerate-api", isOverride: false });
      updated.push({ quote, rate });
    }
  });
  return { skipped: false, base: baseCode, as_of_date: asOf, fetched_at: fetchedAt, source: "exchangerate-api", updated, unsupported, fixed };
}

/**
 * The line a sync run records about the pairs it deliberately did not touch —
 * "EUR at fixed parity (BEAC) — not synced" — or null when there were none.
 * Stored as the run's `reason` so the freshness banner can say it.
 */
function fixedNote(result) {
  const fixed = (result && result.fixed) || [];
  if (!fixed.length) return null;
  return fixed.map((f) => `${f.quote} (${f.authority})`).join(", ") + " at fixed parity — not synced";
}

module.exports = { resolveKey, syncRates, fixedNote };
