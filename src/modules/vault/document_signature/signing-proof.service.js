/**
 * Proof that the PERSON signed — not just their session (owner decision,
 * 28 Sep 2026: "passkey is the condition for signing documents henceforth";
 * the emailed code only where a device cannot do passkeys).
 *
 * ── THE MODEL: A BANK APPROVING A TRANSFER ─────────────────────────────────
 *
 * The signer presses Approve; the phone asks for their fingerprint or face;
 * the document is signed. The fingerprint never leaves the device — what the
 * server receives is a WebAuthn assertion, made with `userVerification:
 * required`, over a challenge that names:
 *
 *   · WHO   — the signer's user id (another person's passkey cannot answer it)
 *   · WHAT  — the document's entity_ref AND its canonical content hash as the
 *             signer SAW it. A sheet edited between the prompt and the tap
 *             no longer hashes the same, and the proof is refused as stale.
 *
 * So a passkey signature is evidence of a person, on one device, approving one
 * exact version of one document — `AES_PASSKEY`, above the session-only SES.
 *
 * ── WHY THE TWO HALVES RUN ON DIFFERENT CONNECTIONS ────────────────────────
 *
 * Passkeys are identity: they live in the LIVE schema (`req.identityDb`),
 * whichever environment the operator is working in. Documents live in the
 * tenant schema (`req.tenantDb`), which in TEST is the sandbox. So:
 *
 *   1. `verifyPasskey` runs on the identity connection — checks the assertion
 *      against the stored public key, burns the challenge, bumps the counter —
 *      and returns the BINDING it proved (user, entity_ref, content_hash).
 *   2. `settle` runs inside the signing transaction and checks that binding
 *      against the document as it stands now.
 *
 * The emailed code is the fallback, and it is bound the same way (otp.js,
 * rule 1: a code verifies one payload).
 *
 * ── THE 5-MINUTE WINDOW (meeting 6, F6) ────────────────────────────────────
 *
 * A passkey or code proof made from a signed-in browser session also OPENS a
 * signing window for that person on that session (signing-window.service,
 * migration 14345); for 5 minutes their next signatures send
 * `{ window: true }` instead of a new proof. Each such signature is still
 * bound to its own document's content hash at the moment of signing, and
 * records the window and the proof that opened it, under its own assurance
 * level (AES_PASSKEY_WINDOW / AES_OTP_WINDOW) — so the verification page says
 * what actually happened.
 *
 * Only `fromRequest` can produce a proof that opens or uses a window: it marks
 * the proof with a private symbol carrying the request's session, which no
 * JSON body can forge. The AI assistant (which calls services directly, with
 * no request) and an API token (whose access token names no session) therefore
 * can neither open a window nor sign under one.
 */
"use strict";

const canonical = require("../../../services/signatures/canonical");
const otp = require("../../../services/signatures/otp");
const otpRepo = require("../signature_request/signature_request.repo");
const webauthn = require("../../security/app_user/webauthn.service");
const webauthnRepo = require("../../security/app_user/webauthn.repo");
const signingWindow = require("./signing-window.service");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

const KIND = "signing";
/** Set only by fromRequest: the session a proof came from (see the header). */
const FROM_REQUEST = Symbol("signing-proof.from-request");
const fromSession = (proof) => (proof && proof[FROM_REQUEST]) || null;

/** The document's canonical hash as it stands, on the connection given. */
async function currentHash(client, { docType, entityRef, doc = null }) {
  const templateSvc = require("../../documents/template/template.service");
  let live = doc;
  if (!live) {
    const recordId = String(entityRef || "").split(":").slice(1).join(":");
    const rec = recordId ? await templateSvc.loadRecord(client, docType, recordId) : null;
    live = rec && rec.data;
  }
  if (!live) throw new AppError("NOT_FOUND", "Document not found", 404, { entity_ref: entityRef });
  return canonical.build(docType, live).hash;
}

/**
 * The ceremony's options. `hasPasskey: false` tells the client to offer the
 * two-tap setup first (or the emailed code on a device that cannot).
 */
async function passkeyOptions(identityClient, { userId, entityRef, contentHash, req }) {
  const creds = await webauthnRepo.listForUserWithKeys(identityClient, userId);
  if (!creds.length) return { has_passkey: false, options: null };

  const { rpID } = webauthn.getRpInfo(req);
  const { generateAuthenticationOptions } = webauthn.sw();
  const opts = await generateAuthenticationOptions({
    rpID,
    timeout: webauthn.CEREMONY_TIMEOUT_MS,
    // Only THIS person's keys: the OS goes straight to the fingerprint.
    allowCredentials: creds.map((c) => ({
      id: webauthn.credentialIdToBytes(c.credential_id),
      type: "public-key",
      transports: c.transports || undefined,
    })),
    userVerification: "required",
  });
  const token = webauthn.signChallenge({
    sub: String(userId),
    kind: KIND,
    challenge: opts.challenge,
    entity_ref: entityRef,
    content_hash: contentHash,
  });
  return { has_passkey: true, options: { ...opts, _challengeToken: token } };
}

/**
 * Verify the assertion on the identity connection. Returns the binding it
 * proved; `settle` checks that binding against the live document.
 */
async function verifyPasskey(identityClient, { userId, assertion, challengeToken, req }) {
  if (!assertion || !challengeToken) {
    throw new AppError("SIGNING_PROOF_INVALID", "Your fingerprint or face confirmation was incomplete. Try again.", 400);
  }
  const p = webauthn.verifyChallenge(challengeToken);
  if (p.kind !== KIND || String(p.sub) !== String(userId)) {
    throw new AppError("SIGNING_PROOF_INVALID", "That confirmation was not issued to you for signing. Try again.", 400);
  }

  const rawId = assertion.rawId || assertion.id;
  const credId = typeof rawId === "string" ? rawId : webauthn.toBase64URL(rawId);
  const stored = credId ? await webauthnRepo.getByCredentialId(identityClient, credId) : null;
  if (!stored || String(stored.user_id) !== String(userId)) {
    throw new AppError("SIGNING_PROOF_INVALID", "That passkey is not registered to you.", 400);
  }

  const { rpID, origin } = webauthn.getRpInfo(req);
  const { verifyAuthenticationResponse } = webauthn.sw();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: p.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      authenticator: {
        credentialID: webauthn.credentialIdToBytes(stored.credential_id),
        credentialPublicKey: new Uint8Array(Buffer.from(stored.public_key, "base64url")),
        counter: Number(stored.counter) || 0,
        transports: stored.transports || undefined,
      },
      // The fingerprint / face / device PIN — the whole point.
      requireUserVerification: true,
    });
  } catch (e) {
    logger.warn({ err: e, credential_id: stored.credential_id }, "[signing-proof] passkey verify failed");
    throw new AppError("SIGNING_PROOF_INVALID", "Your passkey could not be verified. Try again.", 400);
  }
  if (!verification.verified) {
    throw new AppError("SIGNING_PROOF_INVALID", "Your passkey could not be verified. Try again.", 400);
  }
  await webauthn.consumeChallenge(p.challenge);
  await webauthnRepo.updateCounter(
    identityClient, stored.credential_id,
    verification.authenticationInfo?.newCounter ?? stored.counter,
  );
  return {
    method: "PASSKEY",
    user_id: String(userId),
    credential_id: stored.credential_id,
    entity_ref: p.entity_ref,
    content_hash: p.content_hash,
  };
}

/** Send (or resend) the emailed code for one document, to the signer's own address. */
async function sendOtp(client, { actor = {}, docType, entityRef }) {
  if (!actor.user_id) throw new AppError("NO_ACTOR", "Sign in to sign", 401);
  const { rows } = await client.query("SELECT email FROM app_user WHERE user_id = $1", [actor.user_id]);
  const email = rows[0] && rows[0].email;
  if (!email) throw new AppError("NO_RECIPIENT", "Your account has no email address for a code", 422);
  const contentHash = await currentHash(client, { docType, entityRef });
  const { code, otp: row } = await otp.issue(otpRepo, client, {
    userId: actor.user_id, entityRef, contentHash, sentTo: email,
  });
  const mail = require("../signature_request/signature_request.mail");
  const subject = "Your signing code";
  const text = `Your code is ${code}. It expires in ${otp.OTP.TTL_MINUTES} minutes. If you did not ask to sign a document, ignore this email.`;
  await mail.send(client, {
    to: email, subject, text, html: `<p>Your code is <b style="font-size:20px;letter-spacing:2px">${code}</b>.</p><p>It expires in ${otp.OTP.TTL_MINUTES} minutes.</p>`,
    entityRef, sendPoint: "signature.otp",
  });
  return otp.present(row);
}

/**
 * Inside the signing transaction: turn what the client sent into the evidence
 * the signature records, or refuse.
 *
 * `proof` is one of:
 *   { passkey: <verifyPasskey result> }   — already verified on identity
 *   { otp_code: "123456" }                 — verified here, bound to the hash
 *   { window: true }                       — this session's open signing window
 *
 * Returns { assurance, otpChallengeId, passkeyCredentialId } plus, for the
 * window, `signingWindowId` / `windowOpenedAt` (a signature under it) or
 * `opensWindow` (a proof from a session, which opens one when its signature
 * is written — document_signature.service signInternal).
 */
async function settle(client, { actor = {}, docType, entityRef, doc = null, proof }) {
  if (!proof || (!proof.passkey && !proof.otp_code && !proof.window)) {
    throw new AppError(
      "SIGNING_PROOF_REQUIRED",
      "Confirm with your fingerprint or face to sign.",
      428,
      { doc_type: docType, entity_ref: entityRef },
    );
  }
  const hash = await currentHash(client, { docType, entityRef, doc });
  const session = fromSession(proof);

  if (proof.window) {
    // Only a proof built from a signed-in request names a session; anything
    // else (an AI payload, a forged body, an API token) never reaches a window.
    if (!session || !session.sessionId) {
      throw new AppError(
        "SIGNING_PROOF_REQUIRED",
        "A signing window is only usable from the signed-in session that opened it. Confirm with your fingerprint or face to sign.",
        428,
        { doc_type: docType, entity_ref: entityRef },
      );
    }
    const w = await signingWindow.use(client, { userId: actor.user_id, sessionId: session.sessionId });
    return {
      assurance: w.proof_method === "PASSKEY" ? "AES_PASSKEY_WINDOW" : "AES_OTP_WINDOW",
      otpChallengeId: w.otp_challenge_id || null,
      passkeyCredentialId: w.passkey_credential_id || null,
      signingWindowId: w.window_id,
      windowOpenedAt: w.opened_at,
      opensWindow: null,
    };
  }
  // A proof made from a session opens that session's window when it signs.
  const opens = (method, ids) =>
    session && session.sessionId && actor.user_id
      ? { userId: actor.user_id, sessionId: session.sessionId, method, ...ids }
      : null;

  if (proof.passkey) {
    const b = proof.passkey;
    if (String(b.user_id) !== String(actor.user_id) || b.entity_ref !== entityRef) {
      throw new AppError("SIGNING_PROOF_INVALID", "That confirmation was for a different document.", 400);
    }
    if (b.content_hash !== hash) {
      throw new AppError("SIGNING_PROOF_STALE", "This document changed while you were confirming. Check it and try again.", 409);
    }
    return {
      assurance: "AES_PASSKEY", otpChallengeId: null, passkeyCredentialId: b.credential_id,
      opensWindow: opens("PASSKEY", { passkeyCredentialId: b.credential_id }),
    };
  }

  const row = await otp.verify(otpRepo, client, {
    userId: actor.user_id, entityRef, contentHash: hash, code: String(proof.otp_code),
  });
  return {
    assurance: "AES_OTP", otpChallengeId: row.otp_id, passkeyCredentialId: null,
    opensWindow: opens("OTP", { otpChallengeId: row.otp_id }),
  };
}

/**
 * The controller half, shared by every route that signs: verify a passkey on
 * the identity connection BEFORE the tenant transaction, and hand the result
 * to the service as `proof`. An emailed code passes straight through.
 */
async function fromRequest(req) {
  const p = req.body && req.body.proof;
  if (!p) return null;
  // The session this request is signed in under — the access token's `sid`
  // (auth middleware). Null for a token that names none (an API token, a
  // token minted before SEC-C2): such a request can prove, but never opens or
  // uses a window.
  const mark = (proof) => {
    Object.defineProperty(proof, FROM_REQUEST, {
      value: { sessionId: (req.user && req.user.session_id) || null },
      enumerable: false,
    });
    return proof;
  };
  if (p.window === true) return mark({ window: true });
  if (p.passkey) {
    const verified = await req.identityDb((c) => verifyPasskey(c, {
      userId: req.user && req.user.user_id,
      assertion: p.passkey.assertion,
      challengeToken: p.passkey.challenge_token,
      req,
    }));
    return mark({ passkey: verified });
  }
  if (p.otp_code) return mark({ otp_code: String(p.otp_code) });
  return null;
}

module.exports = { currentHash, passkeyOptions, verifyPasskey, sendOtp, settle, fromRequest, KIND };
