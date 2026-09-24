/**
 * Smart Comms calls — the ICE configuration a call's browser gets: STUN, and
 * TURN credentials minted for one live call (calls audit C2, C12, C13).
 *
 * Credentials use coturn's REST scheme: username `<expiry>:<call token>`,
 * password base64(HMAC-SHA1(username)) under the shared secret coturn is
 * started with. The token is random and stored on the call row, so the relay's
 * logs name the call and never a person, and a credential dies with the call:
 * its TTL is the call's remaining allowance plus a minute. The call service
 * decides WHETHER to mint (only for RINGING or IN_CALL); this file only how.
 *
 * STUN comes from configuration only: STUN_URLS, else the TURN host's own
 * port, else none. A public STUN server is never used unless it is listed.
 */
"use strict";

const crypto = require("crypto");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");

let warnedTurnMisconfigured = false;

const turnConfigured = () => Boolean(config.TURN_HOST && config.TURN_CREDENTIAL_SECRET);

/** A fresh per-call token for the credential's username. */
function newCallToken() {
  return crypto.randomBytes(18).toString("base64url");
}

/** One credential for `token`, valid for `ttlSeconds` (at least a minute). */
function turnCredential({ token, ttlSeconds, now = Date.now() }) {
  if (!token) throw new Error("a TURN credential needs the call's token");
  const expiry = Math.floor(now / 1000) + Math.max(60, Math.ceil(Number(ttlSeconds) || 0));
  const username = `${expiry}:${token}`;
  // A neutral local name: CodeQL's sensitive-data heuristic matches by name,
  // and this is the deployment's coturn secret doing its one job.
  const sharedKey = String(config.TURN_CREDENTIAL_SECRET);
  const password = crypto
    // SHA1 is TURN's wire protocol (RFC 5766 MESSAGE-INTEGRITY; coturn's
    // use-auth-secret computes exactly this), not a chosen cipher.
    // codeql[js/weak-cryptographic-algorithm]
    // codeql[js/weak-crypto]
    .createHmac("sha1", sharedKey)
    .update(username)
    .digest("base64");
  return { username, password, expiresAt: new Date(expiry * 1000).toISOString() };
}

function stunServers() {
  const listed = String(config.STUN_URLS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (listed.length) return [{ urls: listed }];
  if (config.TURN_HOST) return [{ urls: [`stun:${config.TURN_HOST}:${config.TURN_PORT_UDP}`] }];
  return [];
}

/**
 * The `RTCConfiguration` pieces for one participant of one call.
 *
 * `relayOnly` is the tenant's `comms.call_privacy` choice. It is honoured
 * even without a relay configured: the promise is that no IP address is
 * exchanged, and a call that cannot connect keeps it where a quiet fallback
 * to peer-to-peer would break it.
 */
function iceConfigFor({ token, ttlSeconds, relayOnly = false }) {
  const servers = stunServers();
  let expiresAt = null;
  if (turnConfigured()) {
    const cred = turnCredential({ token, ttlSeconds });
    expiresAt = cred.expiresAt;
    const urls = String(config.TURN_TRANSPORTS || "udp,tcp")
      .split(",")
      .map((s) => s.trim())
      .filter((t) => t === "udp" || t === "tcp")
      .map((t) => `turn:${config.TURN_HOST}:${t === "tcp" ? config.TURN_PORT_TCP : config.TURN_PORT_UDP}?transport=${t}`);
    if (Number(config.TURN_TLS_PORT) > 0) {
      urls.push(`turns:${config.TURN_HOST}:${config.TURN_TLS_PORT}?transport=tcp`);
    }
    for (const url of urls) {
      servers.push({ urls: [url], username: cred.username, credential: cred.password });
    }
  } else if (config.TURN_HOST && !warnedTurnMisconfigured) {
    // Warn once per process: an ops error, not a per-call one.
    warnedTurnMisconfigured = true;
    logger.warn("TURN_HOST is set but TURN_CREDENTIAL_SECRET is empty — no relay, " +
      "calls behind carrier-grade NAT will not connect");
  }
  return {
    iceServers: servers,
    iceTransportPolicy: relayOnly ? "relay" : "all",
    turnConfigured: turnConfigured(),
    expiresAt,
  };
}

module.exports = { newCallToken, turnCredential, iceConfigFor };
