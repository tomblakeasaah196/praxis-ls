"use strict";

/**
 * The visitor's real address, when a tenant's domain sits behind Cloudflare.
 *
 * `trust proxy` (a hop count, SEC-H5) makes `req.ip` the address our nginx saw.
 * Behind a proxied Cloudflare record that is a Cloudflare edge, shared by every
 * visitor that edge serves, so every IP-keyed control downstream keyed the
 * whole audience on one value: the public intake limiters, the tracking limiter,
 * the careers limiters, the login limiters and the audit rows' `ip`.
 *
 * This middleware runs once, right after `trust proxy` is set and before the
 * access log and every limiter, and replaces `req.ip` with the address in
 * `CF-Connecting-IP` ONLY when the connection reached nginx from one of
 * Cloudflare's published ranges (`shared/net/cloudflare-ranges.js`). Any other
 * caller can write that header too, straight at the origin address; for them
 * the header is ignored and `req.ip` stays exactly what it was. Replacing the
 * property rather than inventing a second one is the point: nothing that
 * already reads `req.ip` has to change, so no limiter can be missed.
 *
 * `req.edgeIp` keeps the address the connection actually came from, for the
 * access log and for anybody debugging the edge.
 */

const net = require("net");
const { isCloudflare, unmapped } = require("../net/cloudflare-ranges");

const HEADER = "cf-connecting-ip";

/** The address `CF-Connecting-IP` names, or null when it names nothing usable. */
function headerAddress(req) {
  const raw = req.headers ? req.headers[HEADER] : null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const ip = unmapped(String(value).trim());
  return net.isIP(ip) ? ip : null;
}

/**
 * The address to key on. Pure, so the tests can state every case without
 * booting Express: `edge` is the address the proxy chain resolved (`req.ip`).
 */
function resolveVisitorIp(edge, headers) {
  if (!edge || !isCloudflare(edge)) return edge;
  const fromHeader = headerAddress({ headers: headers || {} });
  return fromHeader || edge;
}

function visitorIp(req, _res, next) {
  const edge = req.ip;
  const real = resolveVisitorIp(edge, req.headers);
  if (real && real !== edge) {
    req.edgeIp = edge;
    // Shadows Express's prototype getter on this one request object.
    Object.defineProperty(req, "ip", { value: real, configurable: true, enumerable: true, writable: true });
  }
  next();
}

module.exports = { visitorIp, resolveVisitorIp, headerAddress, HEADER };
