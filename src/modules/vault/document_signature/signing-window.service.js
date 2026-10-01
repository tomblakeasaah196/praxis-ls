/**
 * The 5-minute signing window (meeting 6, register 3.7, owner decision F6).
 *
 * One confirmation — a passkey (usually the phone's, by QR) or the emailed
 * code — covers the SAME person's further signatures on the SAME session for
 * 5 minutes. Migration 14345's header is the contract; in short:
 *
 *   · 5 minutes from the proof, never extended by use (`expires_at` is set
 *     once, at open);
 *   · keyed on user_id AND session_id — the access token's `sid`. A request
 *     with no session (an API token, a token minted before SEC-C2) and a call
 *     with no request at all (the AI assistant runs services directly) have
 *     nothing to match, so they never reach a window: signing-proof.service
 *     only builds a window proof from a request, and marks it so a JSON body
 *     cannot forge one;
 *   · closed by "End now", by sign-out and the lock screen (both end the
 *     session — the logout path calls closeForSession), or by its clock;
 *   · opened, each signature under it, and closed are audit entries.
 *
 * Runs on the TENANT connection, inside the signing transaction: a window is
 * opened only when the signature that proved it commits, and in the schema
 * (LIVE or TEST) the signing happened in.
 */
"use strict";

const events = require("./document_signature.events");
const { audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const WINDOW_MINUTES = 5;
const PROOF_METHODS = new Set(["PASSKEY", "OTP"]);
const CLOSE_REASONS = new Set(["END_NOW", "SESSION_ENDED", "EXPIRED", "REPLACED"]);

const ref = (id) => "signing_window:" + id;

/** What the screen shows: open or not, and until when. */
function present(w) {
  if (!w) return { open: false, window_id: null, opened_at: null, expires_at: null, proof_method: null, signature_count: 0 };
  return {
    open: !w.closed_at && new Date(w.expires_at).getTime() > Date.now(),
    window_id: w.window_id,
    opened_at: w.opened_at,
    expires_at: w.expires_at,
    proof_method: w.proof_method,
    signature_count: Number(w.signature_count) || 0,
  };
}

async function closeRows(client, rows, reason, actorUserId) {
  if (!CLOSE_REASONS.has(reason)) throw new AppError("BAD_CLOSE_REASON", "Unknown signing-window close reason", 500);
  for (const w of rows) {
    const { rows: closed } = await client.query(
      `UPDATE signing_window SET closed_at = now(), close_reason = $2
        WHERE window_id = $1 AND closed_at IS NULL
        RETURNING *`,
      [w.window_id, reason],
    );
    if (!closed[0]) continue;
    await audit(client, {
      actorUserId: actorUserId || w.user_id,
      action: events.WINDOW_CLOSED,
      moduleKey: events.MODULE,
      entityRef: ref(w.window_id),
      after: { window_id: w.window_id, close_reason: reason, signature_count: closed[0].signature_count, expires_at: w.expires_at },
    });
  }
}

/** Windows past their clock are closed (EXPIRED) the first time anyone looks. */
async function sweepExpired(client, { userId, sessionId }) {
  const { rows } = await client.query(
    `SELECT * FROM signing_window
      WHERE user_id = $1 AND session_id = $2 AND closed_at IS NULL AND expires_at <= now()`,
    [userId, sessionId],
  );
  if (rows.length) await closeRows(client, rows, "EXPIRED", userId);
}

/** This person's open window on this session, or null. */
async function current(client, { userId, sessionId }) {
  if (!userId || !sessionId) return null;
  await sweepExpired(client, { userId, sessionId });
  const { rows } = await client.query(
    `SELECT * FROM signing_window
      WHERE user_id = $1 AND session_id = $2 AND closed_at IS NULL AND expires_at > now()
      ORDER BY opened_at DESC LIMIT 1`,
    [userId, sessionId],
  );
  return rows[0] || null;
}

/**
 * Open a window after a successful proof. A window already open on the
 * session is closed first (REPLACED) — the new proof restarts the clock; use
 * never does.
 */
async function open(client, { userId, sessionId, method, passkeyCredentialId = null, otpChallengeId = null, entityRef = null }) {
  if (!userId || !sessionId) return null;
  if (!PROOF_METHODS.has(method)) throw new AppError("BAD_PROOF_METHOD", "Unknown signing proof method", 500);
  const { rows: prior } = await client.query(
    "SELECT * FROM signing_window WHERE user_id = $1 AND session_id = $2 AND closed_at IS NULL",
    [userId, sessionId],
  );
  if (prior.length) await closeRows(client, prior, "REPLACED", userId);
  const { rows } = await client.query(
    `INSERT INTO signing_window
       (user_id, session_id, proof_method, passkey_credential_id, otp_challenge_id, opened_for_entity_ref, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(mins => $7::int))
     RETURNING *`,
    [userId, sessionId, method, passkeyCredentialId, otpChallengeId, entityRef, WINDOW_MINUTES],
  );
  const w = rows[0];
  await audit(client, {
    actorUserId: userId,
    action: events.WINDOW_OPENED,
    moduleKey: events.MODULE,
    entityRef: ref(w.window_id),
    after: {
      window_id: w.window_id, proof_method: method, passkey_credential_id: passkeyCredentialId,
      otp_challenge_id: otpChallengeId, opened_for: entityRef, opened_at: w.opened_at, expires_at: w.expires_at,
    },
  });
  return w;
}

/**
 * Check the window for one signature: locked, still open, still in its five
 * minutes (the count moves with the signature row — recordSignature). Refused with SIGNING_PROOF_REQUIRED (the client then asks for a
 * proof again) when there is none — expired, ended, or another session.
 */
async function use(client, { userId, sessionId }) {
  if (!userId || !sessionId) {
    throw new AppError("SIGNING_PROOF_REQUIRED", "Confirm with your fingerprint or face to sign.", 428, { window: "none" });
  }
  await sweepExpired(client, { userId, sessionId });
  const { rows } = await client.query(
    `SELECT * FROM signing_window
      WHERE user_id = $1 AND session_id = $2 AND closed_at IS NULL AND expires_at > now()
      ORDER BY opened_at DESC LIMIT 1
      FOR UPDATE`,
    [userId, sessionId],
  );
  const w = rows[0];
  if (!w) {
    throw new AppError("SIGNING_PROOF_REQUIRED", "Your signing window has ended. Confirm again to sign.", 428, { window: "closed" });
  }
  return w;
}

/** The per-signature count and audit entry, written with the signature row. */
async function recordSignature(client, { windowId, userId, signatureId, entityRef, contentHash }) {
  await client.query("UPDATE signing_window SET signature_count = signature_count + 1 WHERE window_id = $1", [windowId]);
  await audit(client, {
    actorUserId: userId,
    action: events.WINDOW_SIGNED,
    moduleKey: events.MODULE,
    entityRef: ref(windowId),
    after: { window_id: windowId, signature_id: signatureId, entity_ref: entityRef, content_hash: contentHash },
  });
}

/** "End now". */
async function end(client, { userId, sessionId }) {
  if (!userId || !sessionId) return present(null);
  const { rows } = await client.query(
    "SELECT * FROM signing_window WHERE user_id = $1 AND session_id = $2 AND closed_at IS NULL",
    [userId, sessionId],
  );
  await closeRows(client, rows, "END_NOW", userId);
  return present(null);
}

/** Sign-out and the lock screen end the session; its windows end with it. */
async function closeForSession(client, { userId, sessionId }) {
  if (!sessionId || !userId) return;
  // Scoped to the caller, like the logout that calls it (SEC-M2): a session id
  // from a request body never closes somebody else's window.
  const { rows } = await client.query(
    "SELECT * FROM signing_window WHERE session_id = $1 AND user_id = $2 AND closed_at IS NULL",
    [sessionId, userId],
  );
  await closeRows(client, rows, "SESSION_ENDED", userId);
}

module.exports = { WINDOW_MINUTES, PROOF_METHODS, CLOSE_REASONS, present, current, open, use, recordSignature, end, closeForSession };
