/**
 * Google OAuth 2.0 (authorization code + refresh) for the Gmail adapter.
 * Deploy-wide Google Cloud client. axios-only, no googleapis dependency.
 * Tokens are persisted by mail.service into the tenant vault; this module only
 * talks to Google's IdP.
 *
 * `access_type=offline` + `prompt=consent` are required to receive a refresh
 * token (Google only returns one on the first consent unless prompt=consent).
 */
"use strict";

const axios = require("axios");
const qs = require("querystring");
const { config } = require("../../../../config/env");
const { AppError } = require("../../../../utils/errors");

const platformSettings = require("../../../../services/platform/settings.service");

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * WHERE THE CREDENTIALS COME FROM: the platform vault first, `.env` last —
 * the same tiering as microsoftOAuth.credentials(), and for the same reasons.
 *
 * Google's client secret does not expire on a calendar the way an Entra one
 * does, but it is still a deploy-wide bearer credential, and kept only in
 * `.env` it was invisible: nobody could tell from the console whether Gmail
 * was configured at all, let alone test it. Platform Console → Integrations →
 * Google Workspace / Gmail now holds it encrypted, shows its last4, and has a
 * Test button. `.env` stays as the fallback so a deployment that set the
 * GOOGLE_* variables keeps working untouched.
 *
 * Resolved per call, not cached: a rotated secret must take effect on the next
 * consent or refresh, not after a restart.
 */
async function credentials() {
  let stored = null;
  try {
    stored = await platformSettings.resolve("mail", "google_gmail");
  } catch {
    /* @silent:storage the platform store being unreachable must fall through to
       env, not take Gmail OAuth down with it */
  }
  const v = (stored && stored.value) || {};
  return {
    client_id: v.client_id || config.GOOGLE_CLIENT_ID,
    client_secret: (stored && stored.secret) || config.GOOGLE_CLIENT_SECRET,
    scopes: v.scopes || config.GOOGLE_SCOPES,
    redirect_uri: v.redirect_uri || config.GOOGLE_REDIRECT_URI || null,
  };
}

async function isConfigured() {
  const c = await credentials();
  return Boolean(c.client_id && c.client_secret);
}

/** Browser-facing consent URL. `state` is our signed CSRF+context token. */
async function authorizeUrl({ state, redirectUri }) {
  const c = await credentials();
  const params = {
    client_id: c.client_id,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: c.scopes,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  };
  return `${AUTH_URL}?${qs.stringify(params)}`;
}

async function exchangeCode({ code, redirectUri }) {
  const c = await credentials();
  return tokenRequest(c, { grant_type: "authorization_code", code, redirect_uri: redirectUri });
}

async function refresh({ refreshToken }) {
  const c = await credentials();
  return tokenRequest(c, { grant_type: "refresh_token", refresh_token: refreshToken });
}

async function tokenRequest(c, extra) {
  const body = qs.stringify({
    client_id: c.client_id,
    client_secret: c.client_secret,
    ...extra,
  });
  try {
    const r = await axios.post(TOKEN_URL, body, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
    });
    // { access_token, refresh_token?, expires_in, scope, token_type, id_token? }
    return r.data;
  } catch (err) {
    const d = err.response && err.response.data;
    if (d && (d.error || d.error_description)) {
      throw classifyProviderError({
        error: d.error,
        description: d.error_description,
        httpStatus: err.response.status,
      });
    }
    throw err;
  }
}

/**
 * WHAT GOOGLE ACTUALLY SAID, IN OUR VOCABULARY.
 *
 * Google answers both the token endpoint and the consent redirect with
 * `{ error, error_description }`. Untranslated, every failure landed on the
 * setup page as `mail_error=OAUTH_FAILED`, and the operator could not tell
 * "you pressed Cancel" from "the platform's client secret is wrong" — two
 * failures with different owners. Same shape as microsoftOAuth's classifier;
 * the codes are Google's own:
 *
 *   invalid_client         the client ID or secret is wrong or deleted.
 *                          Owner: whoever holds Platform Console → Integrations.
 *   redirect_uri_mismatch  the return address is not registered on the OAuth
 *                          client. Owner: the same, or the Google Cloud console.
 *   access_denied          the person pressed Cancel at Google — not an error.
 *   invalid_grant          on a code exchange: the code was used or expired
 *                          (a double-submitted callback, a slow return). On a
 *                          refresh: the person revoked access, or — while the
 *                          app is in Testing — Google's 7-day limit on refresh
 *                          tokens ran out. Either way the remedy is to sign in
 *                          again, which is what the code says.
 *
 * Used twice: for token-endpoint failures, and by the OAuth callback for
 * Google's error redirect (`?error=access_denied`), the same vocabulary over GET.
 */
function classifyProviderError({ error, description, httpStatus } = {}) {
  const e = String(error || "");
  const desc = String(description || "");
  const short = desc ? desc.replace(/\s+/g, " ").trim().slice(0, 240) : "";

  if (e === "invalid_client" || e === "unauthorized_client" || e === "deleted_client") {
    return new AppError(
      "GOOGLE_BAD_CLIENT",
      `Google rejected the platform's OAuth client credentials${short ? `: ${short}` : ""} (HTTP ${httpStatus || "?"})`,
      502,
    );
  }
  if (e === "redirect_uri_mismatch") {
    return new AppError(
      "GOOGLE_REDIRECT_MISMATCH",
      `Google rejected the redirect URI${short ? `: ${short}` : ""}`,
      502,
    );
  }
  if (e === "access_denied") {
    return new AppError("OAUTH_CANCELLED", "The connection was cancelled at Google's sign-in screen.", 400);
  }
  if (e === "invalid_grant") {
    return new AppError(
      "GOOGLE_GRANT_EXPIRED",
      `Google no longer accepts this sign-in — sign in again to reconnect the mailbox${short ? ` (${short})` : ""}`,
      401,
    );
  }
  return new AppError(
    "GOOGLE_AUTH_FAILED",
    `Google refused the sign-in${e ? ` (${e})` : ""}${short ? `: ${short}` : ""}`,
    502,
  );
}

module.exports = { isConfigured, authorizeUrl, exchangeCode, refresh, credentials, classifyProviderError };
