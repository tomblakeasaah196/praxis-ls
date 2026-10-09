/**
 * The verification link a document carries — the resolved URL, the printed
 * code, and the QR that encodes them (doc/SIGNATURE_ENGINEERING_GUIDE.md §3.7,
 * §5.2).
 *
 * ── Why this is a module and not two lines at the render site ──────────────
 * Three things have to agree or the QR is decoration: the host the code
 * resolves on, the `/v/` path (which is where the QR's density gain comes
 * from — §3.7 measured it), and the code's canonical spelling. Each render
 * path deriving its own would eventually produce a document whose printed
 * code and scanned URL point somewhere different, and nobody would find out
 * until a customer at a border post did.
 *
 * ── Resolving the host ─────────────────────────────────────────────────────
 * A tenant is reached at `<slug>.<APP_BASE_DOMAIN>` (middleware/host-tenent-
 * resolver.js), so the verify URL has to be on the tenant's OWN host: the
 * platform hosts do not resolve a tenant, and a QR pointing at one would 404
 * for everybody. In order:
 *
 *   1. THE TENANT'S OWN PUBLIC WEBSITE (`platform.subdomain.surface='public'`),
 *      via registry.publicSurfaceOrigin. This is the answer whenever it exists,
 *      and it is first for a reason that is not cosmetic. A verification QR is
 *      printed on an invoice that goes to a customs officer and a buyer's
 *      lawyer. Addressing it to the STAFF workspace host puts the tenant's
 *      internal ERP hostname on their customer's paper, and on a host whose
 *      root is a staff sign-in screen. The public site is the surface the
 *      tenant actually publishes to strangers, so that is where a stranger's
 *      verification belongs.
 *
 *      It is also the only host that is CORRECT once the portal moved there:
 *      a `surface='public'` host serves public-web at its root and the ERP not
 *      at all (src/server.js), so the page answering /v/ there is the one in
 *      public-web.
 *   2. `origin` from the caller. The HTTP path has `req.tenant.slug` and the
 *      worker path has `tenantMeta.slug`, so both real render paths can say
 *      exactly which host this document belongs to. This is what a tenant with
 *      no public domain on file gets, and the ERP still answers /v/ there.
 *   3. The tenant setting `signature_policy.verify_base_url`. Note this is a
 *      FALLBACK and not an override: it is reached only when rungs 1 and 2 are
 *      both empty, which on a real render path means neither a public host nor
 *      a caller origin nor a slug. That was already true before the public-site
 *      rung existed — both render paths always supply an origin — so nothing
 *      that used to win here stops winning. It is kept because a worker in an
 *      odd state still beats the apex with it.
 *   4. The apex. A last resort that will not resolve a tenant, and is here so a
 *      render never throws over a hostname; the code beneath the QR is still
 *      typable at the tenant's own /verify page, which is the failure mode
 *      worth having.
 *
 * Precedence puts the caller ahead of the SETTING deliberately: a tenant that
 * moves host should not have every document rendered that day pointing at a
 * stale setting. The public site goes ahead of both because it is read live
 * from the registry on every render and cannot be the stale one.
 */
"use strict";

const { config } = require("../../config/env");
const { getSetting } = require("../../shared/config/settings");
const tokens = require("./tokens");
const qr = require("./qr");

/**
 * Normalise a base URL: give it a scheme if it has none, and drop trailing
 * slashes so `verifyUrl` never emits `//v/CODE`.
 *
 * ⚠ THE TRAILING-SLASH TRIM IS A LOOP, NOT `replace(/\/+$/, "")`
 *   (CodeQL js/polynomial-redos, High).
 *
 * `origin` reaches this from `req.get("host")` on the render path, so it is
 * caller-controlled. A quantifier anchored at the end of a string — `\/+$`,
 * `\s+$`, and every variant of that shape — makes the engine re-scan from each
 * successive start position when the match ultimately fails, which is quadratic
 * in the length of the run. A request with a Host header of fifty thousand
 * slashes is not a plausible accident, but it is a cheap one to send.
 *
 * The loop is linear, obviously so to a reader, and there is no pattern left
 * for a scanner to flag or for a later edit to reintroduce.
 */
function normaliseBase(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let out = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  while (out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

/** `https://smartls.praxisls.com` for a tenant slug. */
const originForSlug = (slug) =>
  (slug ? `https://${String(slug).toLowerCase().trim()}.${config.APP_BASE_DOMAIN}` : "");

/**
 * The tenant's own public website origin, or "" when they have none.
 *
 * ⚠ THIS FUNCTION MUST NEVER THROW, and that is why the try/catch wraps the
 *   whole body rather than just the query. It runs on the PDF render path, and
 *   the header above is explicit that a render must not fail over a hostname —
 *   a document that does not exist is strictly worse than one whose QR points
 *   at the workspace host. A registry hiccup degrades to the next rung of the
 *   precedence chain, which is exactly today's behaviour.
 *
 * `require` is deferred to call time rather than hoisted to the top of the
 * file: registry.service is the module that opens tenant pools, this module is
 * pulled in by template rendering, and a top-level edge between the two is the
 * kind of cycle that resolves to `{}` at import time and fails much later with
 * "publicSurfaceOrigin is not a function". The job handlers that reach for
 * `originForSlug` require this module the same way, for the same reason.
 *
 * ── NOT `publicSiteBaseUrl`, WHICH IS THE NEIGHBOURING FUNCTION ───────────
 * That one falls back to a WORKSPACE host with the `/public` prefix appended,
 * which is right for a marketing link in an email and wrong here twice over:
 * it would silently hand back the host this chain is trying to move off, and
 * it would append a prefix to a path (`/v/{code}`) whose length is a measured
 * constraint on a printed QR (§3.7). `publicSurfaceOrigin` returns the public
 * host or null, with no prefix and no fallback, which is the question being
 * asked here.
 */
async function publicSiteOrigin(client) {
  try {
    if (!client) return "";
    const registry = require("../tenant/registry.service");
    const tenantId = registry.tenantIdOf(client);
    if (!tenantId) return "";
    return normaliseBase(await registry.publicSurfaceOrigin(tenantId));
  } catch {
    /* @silent:expected — a tenant with no public-surface host is the ordinary
       case this returns "" for, and the chain below has three more rungs. A
       render must not fail over a hostname (see the file header): a registry
       hiccup degrades this document's QR to the workspace host, which is
       exactly where every QR pointed before this rung existed. */
    return "";
  }
}

/**
 * The base URL the QR resolves on. See the header for the precedence and why.
 * `client` may be null when the caller already knows the origin — the setting
 * lookup is skipped rather than failed.
 */
async function baseUrl(client, { origin = null, slug = null } = {}) {
  const fromPublicSite = await publicSiteOrigin(client);
  if (fromPublicSite) return fromPublicSite;
  const fromCaller = normaliseBase(origin) || normaliseBase(originForSlug(slug));
  if (fromCaller) return fromCaller;
  if (client) {
    const configured = await getSetting(client, "signature_policy", "verify_base_url", null);
    const fromSetting = normaliseBase(configured);
    if (fromSetting) return fromSetting;
  }
  return `https://${config.APP_BASE_DOMAIN}`;
}

/**
 * Everything a renderer needs to print the verification block, for one
 * signature's code. Returns null for a missing code rather than a block
 * pointing at `/v/` with nothing after it — a QR that resolves to a 404 is
 * worse than no QR, because it reads as a broken product rather than an
 * unsigned document.
 *
 * `env` is baked into the URL when it is 'sandbox', so a test-mode document's
 * QR resolves against sandbox rather than 404ing against live. The env travels
 * with the printed URL — not through a client header — because the verify page
 * has no session and cannot be told otherwise (see tokens.verifyUrl).
 */
async function verifyContext(client, { code, origin = null, slug = null, sizeMm = 22, env = "live" } = {}) {
  const normalised = tokens.normaliseCode(code);
  if (!normalised) return null;
  const base = await baseUrl(client, { origin, slug });
  const url = tokens.verifyUrl(normalised, base, env);
  return { url, code: normalised, qrSvg: await qr.svg(url, { sizeMm }) };
}

module.exports = { baseUrl, verifyContext, originForSlug, normaliseBase, publicSiteOrigin };
