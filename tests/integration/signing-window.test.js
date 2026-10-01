"use strict";

/**
 * Meeting 6, PR 3 — Definition of done #9 (register 3.7, owner decision F6),
 * against a real tenant: the 5-minute signing window.
 *
 *   - one confirmation (here the emailed code — on a computer without
 *     fingerprint, after the phone was declined) signs the first costing and
 *     OPENS a window on that session;
 *   - two more costings are then signed with `{ window: true }` and no new
 *     proof, each bound to its own content hash and recording the window and
 *     the proof that opened it (AES_OTP_WINDOW);
 *   - another session, a proof that did not come from a request (the AI
 *     assistant) and a token with no session (an API token) cannot use it;
 *   - after 5 minutes it is refused and closed EXPIRED; "End now" and
 *     sign-out close it too;
 *   - opened, each signature and closed are all in the audit trail.
 *
 * Runs only with DATABASE_URL pointing at a provisioned tenant; self-skips
 * otherwise.
 */

const crypto = require("crypto");

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("The 5-minute signing window (14345)", () => {
  let pool;
  let c;
  let userId;
  const SESSION = crypto.randomUUID();
  const OTHER_SESSION = crypto.randomUUID();
  const STAMP = Date.now();

  const signingProof = () => require("../../src/modules/vault/document_signature/signing-proof.service");
  const signatures = () => require("../../src/modules/vault/document_signature/document_signature.service");
  const signingWindow = () => require("../../src/modules/vault/document_signature/signing-window.service");

  const costing = (n) => ({
    ref: `costing:${crypto.randomUUID()}`,
    doc: { number: `CST-W${STAMP}-${n}`, status: "SUBMITTED_FOR_APPROVAL", lines: [], totals: {} },
  });
  const req = (proof, sessionId = SESSION) => ({ body: { proof }, user: { user_id: userId, session_id: sessionId } });

  async function sign(target, proof) {
    const presets = require("../../src/services/signatures/presets");
    const menu = await presets.resolveMenu(c, { docType: "COSTING" });
    const settled = await signingProof().settle(c, { actor: { user_id: userId }, docType: "COSTING", entityRef: target.ref, doc: target.doc, proof });
    return signatures().signInternal(c, {
      entityRef: target.ref, docType: "COSTING", presetCode: menu.default, actor: { user_id: userId }, doc: target.doc, settled, language: "en",
    });
  }

  async function emailedCode(target) {
    const otp = require("../../src/services/signatures/otp");
    const otpRepo = require("../../src/modules/vault/signature_request/signature_request.repo");
    const canonical = require("../../src/services/signatures/canonical");
    const { code } = await otp.issue(otpRepo, c, {
      userId, entityRef: target.ref, contentHash: canonical.build("COSTING", target.doc).hash, sentTo: "signer@example.test",
    });
    return code;
  }

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    c = await pool.connect();
    const { rows } = await c.query(
      "INSERT INTO app_user (email, full_name, password_hash) VALUES ($1, 'Window Signer', 'x') RETURNING user_id",
      [`window-${STAMP}@example.test`],
    );
    userId = rows[0].user_id;
  });
  afterAll(async () => {
    if (c) c.release();
    if (pool) await pool.end();
  });

  test("one confirmation, then two more signatures in 5 minutes with no new proof, each recording the window", async () => {
    const first = costing(1);
    const proof = await signingProof().fromRequest(req({ otp_code: await emailedCode(first) }));
    const s1 = await sign(first, proof);
    expect(s1.assurance_level).toBe("AES_OTP");
    expect(s1.signing_window_id).toBeTruthy();

    const w = await signingWindow().current(c, { userId, sessionId: SESSION });
    expect(w.window_id).toBe(s1.signing_window_id);
    expect(new Date(w.expires_at) - new Date(w.opened_at)).toBe(5 * 60 * 1000);

    const second = costing(2);
    const third = costing(3);
    const s2 = await sign(second, await signingProof().fromRequest(req({ window: true })));
    const s3 = await sign(third, await signingProof().fromRequest(req({ window: true })));
    for (const [s, t] of [[s2, second], [s3, third]]) {
      expect(s.assurance_level).toBe("AES_OTP_WINDOW");
      expect(s.assurance_words).toBe("Verified by email code, within a 5-minute signing window");
      expect(s.signing_window_id).toBe(w.window_id);
      expect(s.entity_ref).toBe(t.ref);
    }
    // Each bound to its OWN document's hash at the moment of signing.
    const canonical = require("../../src/services/signatures/canonical");
    expect(s2.content_hash).toBe(canonical.build("COSTING", second.doc).hash);
    expect(s3.content_hash).toBe(canonical.build("COSTING", third.doc).hash);
    expect(s2.content_hash).not.toBe(s3.content_hash);

    // Never extended by use.
    const after = await signingWindow().current(c, { userId, sessionId: SESSION });
    expect(after.expires_at).toEqual(w.expires_at);
    expect(after.signature_count).toBe(3);

    const { rows: trail } = await c.query(
      "SELECT action, after_json FROM immutable_ledger WHERE entity_ref = $1 ORDER BY ledger_id",
      [`signing_window:${w.window_id}`],
    );
    expect(trail.map((t) => t.action)).toEqual([
      "document_signature.window.opened",
      "document_signature.window.signed",
      "document_signature.window.signed",
      "document_signature.window.signed",
    ]);
    expect(trail[0].after_json).toMatchObject({ proof_method: "OTP", opened_for: first.ref });
  });

  test("another session, the AI assistant and an API token cannot use it", async () => {
    const t = costing(4);
    // Another device / session of the same person.
    await expect(sign(t, await signingProof().fromRequest(req({ window: true }, OTHER_SESSION))))
      .rejects.toMatchObject({ code: "SIGNING_PROOF_REQUIRED", status: 428 });
    // The AI assistant calls services directly: its proof is a plain object.
    await expect(sign(t, { window: true })).rejects.toMatchObject({ code: "SIGNING_PROOF_REQUIRED", status: 428 });
    // An API token's access token names no session.
    await expect(sign(t, await signingProof().fromRequest(req({ window: true }, null))))
      .rejects.toMatchObject({ code: "SIGNING_PROOF_REQUIRED", status: 428 });
  });

  test("after 5 minutes a proof is asked again, and the window is closed EXPIRED", async () => {
    await c.query(
      "UPDATE signing_window SET opened_at = now() - interval '6 minutes', expires_at = now() - interval '1 minute' WHERE user_id = $1 AND session_id = $2 AND closed_at IS NULL",
      [userId, SESSION],
    );
    await expect(sign(costing(5), await signingProof().fromRequest(req({ window: true }))))
      .rejects.toMatchObject({ code: "SIGNING_PROOF_REQUIRED", status: 428 });
    const { rows } = await c.query(
      "SELECT close_reason FROM signing_window WHERE user_id = $1 AND session_id = $2 ORDER BY opened_at DESC LIMIT 1",
      [userId, SESSION],
    );
    expect(rows[0].close_reason).toBe("EXPIRED");
  });

  test("End now and sign-out close it", async () => {
    const t = costing(6);
    await sign(t, await signingProof().fromRequest(req({ otp_code: await emailedCode(t) })));
    expect(signingWindow().present(await signingWindow().current(c, { userId, sessionId: SESSION })).open).toBe(true);
    const ended = await signingWindow().end(c, { userId, sessionId: SESSION });
    expect(ended.open).toBe(false);
    await expect(sign(costing(7), await signingProof().fromRequest(req({ window: true }))))
      .rejects.toMatchObject({ code: "SIGNING_PROOF_REQUIRED" });

    const t2 = costing(8);
    await sign(t2, await signingProof().fromRequest(req({ otp_code: await emailedCode(t2) })));
    await signingWindow().closeForSession(c, { userId, sessionId: SESSION });
    const { rows } = await c.query(
      "SELECT close_reason FROM signing_window WHERE user_id = $1 AND session_id = $2 ORDER BY opened_at DESC LIMIT 2",
      [userId, SESSION],
    );
    expect(rows.map((r) => r.close_reason)).toEqual(["SESSION_ENDED", "END_NOW"]);
  });
});
