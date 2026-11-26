"use strict";

/**
 * IndexNow: tell Bing (and Yandex, Seznam, Naver, which share the protocol)
 * the moment a page of a tenant's website is published.
 *
 * WHY IT MATTERS HERE. ChatGPT's search draws on Bing's index, so an article
 * Bing has not crawled is an article ChatGPT cannot cite. Without a ping a new
 * page waits for Bing's next visit, which on a young domain is days.
 *
 * ── THE KEY, WITH NO NEW SECRET AND NO NEW TABLE ───────────────────────────
 *
 * IndexNow proves a sender owns a host by a key the host serves at
 * `https://<host>/<key>.txt`. The key here is DERIVED per host: the first 32
 * hex characters of HMAC-SHA256(ENCRYPTION_KEY, "indexnow:" + host). The key
 * is public by design (it is served to anyone who asks), and an HMAC output
 * reveals nothing about the secret behind it. Derived, it needs no storage,
 * no setup step and no rotation story beyond the one ENCRYPTION_KEY already
 * has: rotating that secret changes every key, and the next ping simply
 * proves ownership with the new one.
 *
 * ── FIRE AND FORGET ────────────────────────────────────────────────────────
 *
 * `ping` never throws into its caller and never delays it: publishing an
 * article must not fail, or wait, because a search engine is slow. One POST
 * per public host, a short timeout, a warning in the log on failure, no
 * retries (the sitemap is the safety net). Nothing is sent outside production,
 * from a sandbox connection, or for a rehearsal host.
 */

const crypto = require("crypto");
const registry = require("../../services/tenant/registry.service");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const paths = require("./public-web-paths");

const ENDPOINT = "https://api.indexnow.org/indexnow";
const TIMEOUT_MS = 5000;
/** The protocol accepts up to 10,000 URLs a request; a publish sends four. */
const MAX_URLS = 10000;

const normHost = (h) => String(h || "").toLowerCase().split(":")[0].trim();

/** The host's IndexNow key: 32 lowercase hex characters, stable per host. */
function keyFor(host) {
  return crypto
    .createHmac("sha256", String(config.ENCRYPTION_KEY || ""))
    .update("indexnow:" + normHost(host))
    .digest("hex")
    .slice(0, 32);
}

/** The body IndexNow expects for one host. Paths are base-relative; a public
 *  host serves the site at its root. */
function payloadFor(host, relPaths) {
  const h = normHost(host);
  const key = keyFor(h);
  const urlList = [...new Set((relPaths || []).filter(Boolean))]
    .map((p) => "https://" + h + paths.joinBase(paths.ROOT_BASE, p.startsWith("/") ? p : "/" + p))
    .slice(0, MAX_URLS);
  return { host: h, key, keyLocation: "https://" + h + "/" + key + ".txt", urlList };
}

/**
 * Send the pings for one tenant. Resolves with one entry per host tried;
 * rejects only on a programming error, which `ping` absorbs.
 *
 * @param {string} tenantId
 * @param {string[]} relPaths  base-relative, e.g. ["/insights/x", "/insights", "/"]
 * @param {{ fetchImpl?: Function }} [opts]  injectable for the tests
 */
async function notify(tenantId, relPaths, { fetchImpl = globalThis.fetch } = {}) {
  const { isNoindexHost } = require("./public-head");
  const hosts = (await registry.publicHosts(tenantId)).filter((h) => !isNoindexHost(h));
  const results = [];
  for (const host of hosts) {
    const body = payloadFor(host, relPaths);
    if (!body.urlList.length) continue;
    try {
      const res = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // 200 and 202 are both "received"; anything else is worth a line.
      if (!res || (res.status !== 200 && res.status !== 202)) {
        logger.warn({ host, status: res && res.status }, "indexnow ping refused");
      }
      results.push({ host, status: res && res.status });
    } catch (err) {
      logger.warn({ err, host }, "indexnow ping failed");
      results.push({ host, error: err.message });
    }
  }
  return results;
}

/**
 * Tell the search engines about `relPaths` on this tenant's public hosts.
 * Returns at once; the pings run after the caller has moved on.
 *
 * @param {object} client  the connection the publish ran on: it names the
 *   tenant and the environment, and a SANDBOX publish is never announced.
 */
function ping(client, relPaths) {
  try {
    if (config.NODE_ENV !== "production") return;
    if (client && client[registry.ENV] === "sandbox") return;
    const tenantId = registry.tenantIdOf(client);
    if (!tenantId || !relPaths || !relPaths.length) return;
    setImmediate(() => {
      notify(tenantId, relPaths).catch((err) => logger.warn({ err, tenantId }, "indexnow ping failed"));
    });
  } catch (err) {
    logger.warn({ err }, "indexnow ping skipped");
  }
}

module.exports = { ENDPOINT, keyFor, payloadFor, notify, ping };
