"use strict";

/**
 * The address of this tenant's careers page, and of one published role on it.
 *
 * ── WHY THIS IS A MODULE AND NOT `window.location.origin` ──────────────────
 *
 * The vacancy screen used to build the link it shows a recruiter from the
 * browser's own origin, with a comment claiming that was the tenant's own
 * domain. It is not. The ERP is served on the WORKSPACE host —
 * `<slug>.<APP_BASE_DOMAIN>` — and a tenant who brought their own domain is
 * served the public site on that instead (`platform.subdomain.surface='public'`,
 * src/server.js). So the recruiter was handed `smartls.praxisls.com/careers/…`
 * to paste into a job board while their careers page lived at `smartls.cm`.
 *
 * That link is not broken — the workspace host still answers `/careers/*`
 * through the legacy group in `public-web-paths.matcherFor` — which is exactly
 * what makes it expensive. It redirects, the page renders, nothing fails, and
 * the only thing wrong with it is that the company's internal ERP hostname is
 * now printed on a job advert, on LinkedIn, and in a candidate's address bar.
 * `services/signatures/verify-link.js` makes the same argument for the QR on an
 * invoice, and this is the same mistake on the other public surface.
 *
 * ── THE PRECEDENCE, AND WHY REGISTRY FIRST ────────────────────────────────
 *
 *   1. `registry.publicSiteBaseUrl` — the tenant's own public host at its root
 *      when they have one, else the workspace host with the marketing prefix
 *      that host is configured for (`public_base`, which is a per-tenant
 *      setting and may not be `/public` at all). One function, already used by
 *      the alert digest, so a link a recruiter copies and a link a subscriber
 *      is emailed cannot point at different hosts.
 *   2. The caller's own origin plus the DEFAULT prefix. Reached only when the
 *      tenant has no subdomain row at all, which on a provisioned tenant does
 *      not happen; it is here so a dev workspace or a half-seeded fixture gets
 *      a working link rather than an empty one.
 *   3. "" — say nothing rather than guess. The caller renders no link at all,
 *      which is honest, where the apex would be a confident wrong answer.
 *
 * Never throws. A registry hiccup must not redden a recruitment screen over a
 * hostname.
 */

const { logger } = require("../../../config/logger");
const registry = require("../../../services/tenant/registry.service");
const publicWebPaths = require("../../../shared/http/public-web-paths");

/**
 * Give a base a scheme and strip its trailing slashes, so `careersUrl` never
 * emits `//careers/…`.
 *
 * ⚠ THE TRIM IS A LOOP, NOT `replace(/\/+$/, "")` (CodeQL js/polynomial-redos).
 *   `origin` reaches this from `req.get("host")`, so it is caller-controlled,
 *   and a quantifier anchored at the end of a string is quadratic in the length
 *   of the run when the match fails. Same shape, same fix, same reasoning as
 *   `signatures/verify-link.js` and `public-web-paths.normaliseBase`.
 */
function normaliseBase(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let out = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  while (out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

/**
 * The absolute base the careers pages hang off, or "" when none can be
 * resolved. `client` is a tenant connection; `origin` is the host the request
 * arrived on, when there is a request.
 */
async function careersBase(client, { origin = null } = {}) {
  try {
    const tenantId = client ? registry.tenantIdOf(client) : null;
    if (tenantId) {
      const fromRegistry = normaliseBase(await registry.publicSiteBaseUrl(tenantId));
      if (fromRegistry) return fromRegistry;
    }
  } catch (err) {
    // Logged rather than swallowed: a tenant with no subdomain row resolves to
    // null WITHOUT throwing, so reaching here means the platform lookup itself
    // failed. The caller still gets an answer, because a screen must not break
    // over a hostname, but a recruiter being handed the less correct host is
    // worth a line.
    logger.warn({ err }, "[careers] public base lookup failed — falling back to the request origin");
  }
  const fromCaller = normaliseBase(origin);
  // `DEFAULT_BASE` and not the root: rung 2 is a WORKSPACE host by definition
  // (rung 1 is the only thing that knows about public-surface hosts), and the
  // marketing site is never at the root of one.
  return fromCaller ? fromCaller + publicWebPaths.DEFAULT_BASE : "";
}

/** `https://smartls.cm/careers/<token>`, or null without both halves. */
const careersUrl = (base, token) =>
  base && token ? `${base}/careers/${encodeURIComponent(token)}` : null;

/** The careers index — the page listing every open role. */
const careersIndexUrl = (base) => (base ? `${base}/careers` : null);

module.exports = { careersBase, careersUrl, careersIndexUrl, normaliseBase };
