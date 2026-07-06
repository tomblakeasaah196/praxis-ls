/**
 * Tenant request context (implements the empty stub).
 *
 * Runs AFTER hostTenantResolver (req.tenant set) and after auth (req.user set,
 * optional). It:
 *   1. picks the environment — 'sandbox' only when the tenant is NOT yet Live
 *      and the client asks via `X-Praxis-Env: sandbox`; once a tenant is Live
 *      the Test/Live toggle is hidden and everything is 'live' (PRD §5.5).
 *   2. binds an ambient request-context (tenant slug, user id, env) for the rest
 *      of the async chain (audit, logging).
 *   3. exposes `req.tenantDb(fn)` — run a callback on a pooled connection to the
 *      tenant's DB with search_path already bound to the chosen schema.
 */
"use strict";

const requestContext = require("../config/request-context");
const registry = require("../services/tenant/registry.service");

function tenantContext(req, res, next) {
  if (!req.tenant) {
    return res.status(500).json({ error: { code: "NO_TENANT_CONTEXT", message: "hostTenantResolver must run first" } });
  }
  const requested = String(req.headers["x-praxis-env"] || "").toLowerCase();
  const env = !req.tenant.is_live && requested === "sandbox" ? "sandbox" : "live";

  req.env = env;
  req.tenantDb = (fn) => registry.withTenantConnection(req.tenant, env, fn);

  const ctx = { tenant: req.tenant.slug, userId: req.user ? req.user.user_id : null, env };
  return requestContext.run(ctx, () => next());
}

module.exports = { tenantContext };
