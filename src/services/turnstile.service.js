"use strict";

/**
 * Cloudflare Turnstile, verified on the server.
 *
 * The widget on the website hands the browser a single-use token. A token is
 * worth nothing until the SERVER asks Cloudflare whether it is genuine
 * (`siteverify`), because a bot can post any string it likes as a "token". So
 * every protected public write calls `verifyToken` before it touches the
 * database, and a token Cloudflare refuses is a refused submission.
 *
 * ── THE KEYS, AND WHAT HAPPENS WITHOUT THEM ───────────────────────────────
 *
 * Per tenant, in the tenant's own LIVE settings: the site key in
 * `website_messages.turnstile`, the secret as the encrypted integration secret
 * `turnstile_secret`, written once in Settings › Website › Messages and never
 * returned to a browser. A tenant with no keys (and every staging copy) keeps
 * working on the honeypot and the 1.5 second timing trap alone, as before.
 *
 * ── WHEN CLOUDFLARE ITSELF CANNOT BE REACHED ──────────────────────────────
 *
 * A timeout or a 5xx from siteverify lets the submission through, logged at
 * WARN. A visitor cannot cause that, the honeypot, the timing trap and the rate
 * limits still stand in front of it, and the alternative is that a Cloudflare
 * incident silently turns away every enquiry the tenant receives that day. A
 * token Cloudflare ANSWERS for and refuses is always refused.
 */

const axios = require("axios");
const { URLSearchParams } = require("url");
const { logger } = require("../config/logger");

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 6000;

/**
 * Ask Cloudflare about one token.
 *
 * Never throws. Returns `{ success, errorCodes, hostname, action, unreachable }`
 * where `unreachable` is true when no answer came back at all.
 */
async function verifyToken({ secret, token, remoteIp = null, idempotencyKey = null }, http = axios) {
  try {
    const body = new URLSearchParams();
    body.set("secret", String(secret || ""));
    body.set("response", String(token || ""));
    if (remoteIp) body.set("remoteip", String(remoteIp));
    if (idempotencyKey) body.set("idempotency_key", String(idempotencyKey));
    const { data, status } = await http.post(SITEVERIFY, body.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: TIMEOUT_MS,
      validateStatus: () => true,
    });
    if (status >= 500 || !data || typeof data !== "object") {
      return { success: false, errorCodes: [], hostname: null, action: null, unreachable: true };
    }
    return {
      success: data.success === true,
      errorCodes: Array.isArray(data["error-codes"]) ? data["error-codes"] : [],
      hostname: data.hostname || null,
      action: data.action || null,
      unreachable: false,
    };
  } catch (err) {
    logger.warn({ err: { message: err && err.message, code: err && err.code } }, "[turnstile] siteverify unreachable");
    return { success: false, errorCodes: [], hostname: null, action: null, unreachable: true };
  }
}

module.exports = { verifyToken, SITEVERIFY };
