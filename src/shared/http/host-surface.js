"use strict";

/**
 * Which app a HOST serves: the tenant's public site ("public") or the
 * workspace ("erp"), and the marketing prefix that goes with it.
 *
 * One function, called by the surface middleware in server.js AND by any route
 * registered ahead of it. That second caller is the reason this is a module:
 * /robots.txt and /sitemap.xml are registered before the middleware (a
 * workspace host has no mount that would claim them), so for months they read a
 * `req.hostSurface` nobody had set yet. On smartlsgroup.com, the day it went
 * live (25 Nov 2026), robots.txt answered "Disallow: /" and sitemap.xml fell
 * through to the HTML shell.
 *
 * The host string is derived exactly as `hostTenantResolver` derives it: raw
 * `Host`, lowercased, port stripped. Deliberately not `req.hostname`, which
 * prefers `X-Forwarded-Host` under `trust proxy`: the app a visitor is served
 * and the tenant its data comes from must be decided by the same string.
 *
 * `resolveByHost` is cached per host (60s hit, 10s miss), and the answer is
 * kept on the request, so calling this twice costs nothing.
 *
 * A failed lookup falls back to "erp", i.e. the workspace. Failing closed would
 * take a tenant's workspace offline because its registry row could not be read.
 */

const registry = require("../../services/tenant/registry.service");
const paths = require("./public-web-paths");
const { logger } = require("../../config/logger");

const hostOf = (req) => String((req.headers && req.headers.host) || "").toLowerCase().split(":")[0];

async function resolveHostSurface(req) {
  if (req.hostSurface) return req.hostSurface;
  const host = hostOf(req);
  try {
    const meta = await registry.resolveByHost(host);
    req.hostSurface = meta && meta.surface === "public" ? "public" : "erp";
    // A host the site OWNS serves it at the root. `public_base` is the prefix
    // that keeps the marketing site out of the ERP's way on a shared origin; on
    // a domain the client brought there is no ERP to avoid.
    req.publicBase =
      req.hostSurface === "public"
        ? paths.ROOT_BASE
        : paths.normaliseBase(meta && meta.public_base) || paths.DEFAULT_BASE;
  } catch (err) {
    logger.warn({ err, host }, "host surface lookup failed, serving the workspace");
    req.hostSurface = "erp";
    req.publicBase = paths.DEFAULT_BASE;
  }
  return req.hostSurface;
}

module.exports = { resolveHostSurface, hostOf };
