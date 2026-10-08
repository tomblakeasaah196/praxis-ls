"use strict";

/**
 * The device, remembered by the SERVER — so a browser clearing its own storage
 * cannot make the sign-in screen forget who it belongs to, or that it holds a
 * passkey.
 *
 * ── WHY THE BROWSER'S OWN STORAGE IS NOT ENOUGH ─────────────────────────────
 *
 * The passkey itself lives in the operating system's keychain (iCloud
 * Keychain, Google Password Manager, Windows Hello) and nothing a web page does
 * can delete it. What the sign-in screen needs on top — "this is Ama's laptop,
 * and her passkey is here, so lead with the fingerprint" — used to live only in
 * localStorage, and the BROWSER deletes that on its own schedule:
 *
 *   · Safari erases every script-written store (localStorage, IndexedDB) of a
 *     site that has not been opened in seven days of browsing;
 *   · every engine evicts non-persistent storage under disk pressure.
 *
 * After either, the passkey still worked but the screen no longer offered it:
 * "it forgot me". A cookie SET BY THE SERVER, HttpOnly, is outside both — it is
 * not script-written storage — and lives until it expires (400 days, the
 * browsers' ceiling, rolled forward at every sign-in) or the person clears
 * their cookies themselves.
 *
 * ── WHY IT IS SAFE ──────────────────────────────────────────────────────────
 *
 * It is NOT a credential. It grants no session and unlocks nothing on its own.
 * `GET /auth/device` answers with exactly what the same browser's localStorage
 * already held — the greeting (name, email, picture), whether a Quick PIN is
 * set, and the ids of the passkeys proven on this device (public identifiers;
 * the private keys never leave the authenticator). Beyond that:
 *
 *   · `__Host-` prefix in production: Secure, Path=/, no Domain — a page on any
 *     other subdomain cannot plant or overwrite it (no fixation onto a token an
 *     attacker could then read the greeting back with);
 *   · HttpOnly, so script — injected or not — cannot read it;
 *   · SameSite=Strict, so no other site can make a request that carries it;
 *   · only a SHA-256 of the 32 random bytes is stored, so the table cannot be
 *     turned back into cookies;
 *   · passkeys are listed only while the account still holds them (joined to
 *     webauthn_credential): removing one in My security is the one thing that
 *     takes a passkey off a device, and it does so everywhere at once.
 *
 * ── THE ONE EXCEPTION, AND IT IS NEW (14401) ───────────────────────────────
 *
 * This file used to say "skips no factor", flatly. That is no longer true, and
 * pretending otherwise would hide the only part of this mechanism with teeth.
 *
 * `user_known_device.mfa_trusted_until` lets a device that has already proved a
 * TOTP code skip the next ones, for the 24 hours or 30 days its owner chose in
 * My Security. The default is 'always', which trusts nothing. What survives:
 *
 *   · the cookie is consulted only AFTER the first factor has passed — the
 *     right password, or the right Quick PIN. It stands in for the SECOND
 *     factor, never the first, so the cookie alone is still worth nothing;
 *   · the trust is per (device, person): a device trusted for one account says
 *     nothing about another account signing in on it;
 *   · it expires on a stored timestamp, compared against the DATABASE's clock;
 *   · it is dropped from every device the moment 2FA is turned off, reset by an
 *     administrator, or has its frequency changed.
 *
 * The cost is real and worth naming: someone holding BOTH a stolen password and
 * a stolen copy of this cookie skips the code until the window lapses. That is
 * inherent to every "remember this device", it is why 'always' is the default
 * and one tap away, and it is why touching the factor revokes every window.
 *
 * Remembering is best-effort by design: a failure here is logged and the
 * sign-in it followed stands.
 */

const crypto = require("crypto");
const { config } = require("../../../config/env");
const { logger } = require("../../../config/logger");
const repo = require("./known-device.repo");

const PROD = config.NODE_ENV === "production";
/** `__Host-` needs Secure, which plain-http development cannot set. */
const COOKIE = PROD ? "__Host-praxis_device" : "praxis_device";
/** Chrome and Safari cap a cookie's life at 400 days; every sign-in rolls it on. */
const MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const cookieOptions = () => ({
  httpOnly: true,
  secure: PROD,
  sameSite: "strict",
  path: "/",
  maxAge: MAX_AGE_MS,
});

/** This device's token from the Cookie header, or null. Anything malformed is ignored. */
function readToken(req) {
  const header = String((req.headers && req.headers.cookie) || "");
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== COOKIE) continue;
    const value = part.slice(i + 1).trim();
    return TOKEN.test(value) ? value : null;
  }
  return null;
}

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

/**
 * After a sign-in (or a passkey enrolment) from this device: remember who, and
 * which passkey — minting the device's token the first time.
 */
async function remember(req, res, { userId, credentialId = null, mfaTrustedUntil = null }) {
  if (!userId || typeof req.identityDb !== "function") return;
  try {
    const token = readToken(req) || crypto.randomBytes(32).toString("base64url");
    const deviceHash = hashToken(token);
    const { labelFromUserAgent } = require("./webauthn.service");
    await req.identityDb(async (c) => {
      await repo.upsert(c, {
        deviceHash,
        userId,
        credentialId: credentialId ? String(credentialId) : null,
        label: labelFromUserAgent(req.headers && req.headers["user-agent"]),
      });
      // Same request, after the row exists — a trust stamped before the upsert
      // would update nothing on a device signing in for the first time.
      if (mfaTrustedUntil) await repo.trustForMfa(c, { deviceHash, userId, until: mfaTrustedUntil });
    });
    res.cookie(COOKIE, token, cookieOptions());
  } catch (err) {
    // The person is signed in; the device just will not greet them from the
    // server next time (localStorage still does). (taxonomy: degraded-optional)
    logger.warn({ err, user_id: userId }, "[auth] could not remember this device");
  }
}

/** What this device remembers — `{ account: null }` for a device it does not know. */
async function lookup(req) {
  const token = readToken(req);
  if (!token) return { account: null };
  const row = await req.identityDb((c) => repo.latestAccount(c, hashToken(token)));
  if (!row) return { account: null };
  return {
    account: {
      email: row.email,
      display_name: row.full_name || null,
      avatar_url: row.avatar_ref || null,
      has_quick_pin: !!row.has_quick_pin,
      passkeys: Array.isArray(row.passkeys) ? row.passkeys : [],
    },
  };
}

/**
 * Has THIS device already proved a code for the person signing in as `email`,
 * inside the window their `mfa_frequency` allows (14401)?
 *
 * This is the one place the device cookie influences a factor, so the limits
 * are worth restating where they are read:
 *
 *   · the LOGIN route calls it, but the answer is only acted on AFTER the
 *     password or the Quick PIN has already passed — the cookie alone still
 *     unlocks nothing;
 *   · it is scoped to (device, person), so a device trusted for one account
 *     says nothing about another account signing in on it;
 *   · the expiry is compared against the database's clock.
 *
 * An unknown device — no cookie, or one this person has never signed in with —
 * is `false`, and a failure to look it up is `false` too: the fallback is
 * always to ask for a code.
 */
async function mfaTrustForEmail(req, email) {
  if (!email || typeof req.identityDb !== "function") return false;
  const token = readToken(req);
  if (!token) return false;
  try {
    return await req.identityDb((c) =>
      repo.mfaTrustedForEmail(c, { deviceHash: hashToken(token), email: String(email).trim() }),
    );
  } catch (err) {
    // Asking for a code we did not strictly need is the safe failure.
    // (taxonomy: degraded-optional)
    logger.warn({ err }, "[auth] could not read this device's MFA trust — asking for a code");
    return false;
  }
}

module.exports = { remember, lookup, mfaTrustForEmail, readToken, hashToken, COOKIE, cookieOptions };
