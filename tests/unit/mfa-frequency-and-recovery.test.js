"use strict";

/**
 * The authenticator, as 14401 left it: a QR that can actually be scanned, a
 * frequency the owner chooses, a device that may be trusted between asks, and
 * ten single-use codes for the day the phone is gone.
 *
 * These are the decisions worth pinning down without a database — the ones
 * where being wrong is a security property rather than a broken screen.
 */

const qr = require("../../src/services/signatures/qr");

jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => {}),
  audit: jest.fn(async () => {}),
}));
jest.mock("../../src/shared/cache/identity-cache", () => ({
  invalidateUser: jest.fn(async () => {}),
}));

const service = require("../../src/modules/security/app_user/app_user.service");
const repo = require("../../src/modules/security/app_user/app_user.repo");
const knownDeviceRepo = require("../../src/modules/security/app_user/known-device.repo");
const { audit } = require("../../src/shared/events/emit");

const USER = "11111111-1111-1111-1111-111111111111";

describe("the QR the enrolment card scans", () => {
  const otpauth =
    "otpauth://totp/Praxis%20LS:ama%40example.com?secret=GIDQWPBYLQHGCR3P&period=30&digits=6&algorithm=SHA1";

  test("is an SVG data URL an <img> can render", async () => {
    const url = await qr.dataUrl(otpauth);
    expect(url.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const svg = Buffer.from(url.split(",")[1], "base64").toString("utf8");
    expect(svg).toMatch(/^<svg\b/);
    // It must ENCODE the otpauth URL, not print it: a camera reads the symbol.
    expect(svg).not.toContain("otpauth://");
  });

  test("carries no fixed px size, so the card can scale it", async () => {
    const url = await qr.dataUrl(otpauth);
    const svg = Buffer.from(url.split(",")[1], "base64").toString("utf8");
    const openTag = svg.match(/<svg[^>]*>/)[0];
    expect(openTag).not.toMatch(/\swidth=/);
    expect(openTag).not.toMatch(/\sheight=/);
    // The viewBox is what drives the geometry once width/height are gone.
    expect(openTag).toMatch(/viewBox="0 0 \d+ \d+"/);
  });

  test("setup still returns the key and the link, for the manual path", async () => {
    jest.spyOn(repo, "getTotpSecret").mockResolvedValue({ user_id: USER, email: "ama@example.com" });
    jest.spyOn(repo, "setTotpSecret").mockResolvedValue(undefined);
    const sessionPolicy = require("../../src/modules/security/app_user/session-policy");
    jest.spyOn(sessionPolicy, "assertFreshAuth").mockResolvedValue({ via: "recent_sign_in" });

    const out = await service.setupTotp({}, USER, { sessionId: "s1" });
    expect(out.secret).toEqual(expect.any(String));
    expect(out.otpauth_url).toMatch(/^otpauth:\/\/totp\//);
    expect(out.qr_svg.startsWith("data:image/svg+xml;base64,")).toBe(true);
    jest.restoreAllMocks();
  });

  test("setup refuses on a stale session with no password", async () => {
    jest.spyOn(repo, "getTotpSecret").mockResolvedValue({ user_id: USER, email: "ama@example.com" });
    const setSecret = jest.spyOn(repo, "setTotpSecret").mockResolvedValue(undefined);

    await expect(
      service.setupTotp(
        { query: async () => ({ rows: [] }) }, // no live session row → stale
        USER,
        { sessionId: "s1", currentPassword: null },
      ),
    ).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
    // And critically: no secret was written for a session that could not prove itself.
    expect(setSecret).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });
});

describe("how often it asks", () => {
  test("'always' trusts no device", () => {
    expect(service.mfaTrustUntil("always")).toBeNull();
  });

  test("'daily' is a rolling 24 hours, not a calendar day", () => {
    const until = service.mfaTrustUntil("daily");
    const hours = (until.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThan(24.1);
  });

  test("'monthly' is 30 days", () => {
    const days = (service.mfaTrustUntil("monthly").getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  test("an unknown frequency trusts nothing — the fallback is always to ask", () => {
    expect(service.mfaTrustUntil("weekly")).toBeNull();
    expect(service.mfaTrustUntil(undefined)).toBeNull();
  });

  test("changing it drops every device's window, in both directions", async () => {
    jest.spyOn(repo, "getTotpSecret").mockResolvedValue({
      user_id: USER, email: "ama@example.com", is_2fa_enabled: true, mfa_frequency: "daily",
    });
    jest.spyOn(repo, "setMfaFrequency").mockResolvedValue(undefined);
    const revoke = jest.spyOn(knownDeviceRepo, "revokeMfaTrust").mockResolvedValue(undefined);

    // Loosening must not backdate a 'daily' window into a 30-day one.
    await service.setMfaFrequency({}, USER, "monthly");
    expect(revoke).toHaveBeenCalledWith({}, USER);

    revoke.mockClear();
    await service.setMfaFrequency({}, USER, "always");
    expect(revoke).toHaveBeenCalledWith({}, USER);
    jest.restoreAllMocks();
  });

  test("an unknown value is refused before anything is written", async () => {
    const set = jest.spyOn(repo, "setMfaFrequency").mockResolvedValue(undefined);
    await expect(service.setMfaFrequency({}, USER, "hourly")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(set).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  test("it cannot be set on an account with no authenticator", async () => {
    jest.spyOn(repo, "getTotpSecret").mockResolvedValue({ user_id: USER, is_2fa_enabled: false });
    await expect(service.setMfaFrequency({}, USER, "daily")).rejects.toMatchObject({
      code: "NOT_ENABLED",
    });
    jest.restoreAllMocks();
  });
});

describe("recovery codes", () => {
  test("normalisation forgives case, the grouping dash and pasted spaces", () => {
    expect(service.normaliseRecoveryCode("abcde-fghij")).toBe("ABCDEFGHIJ");
    expect(service.normaliseRecoveryCode(" ABCDE FGHIJ ")).toBe("ABCDEFGHIJ");
    expect(service.normaliseRecoveryCode("ABCDE-FGHIJ")).toBe("ABCDEFGHIJ");
  });

  test("enable mints ten, returns them once, and starts every device untrusted", async () => {
    const { authenticator } = require("otplib");
    const encryption = require("../../src/services/encryption.service");
    jest.spyOn(repo, "getTotpSecret").mockResolvedValue({
      user_id: USER, email: "ama@example.com", totp_secret_enc: "enc", mfa_frequency: "always",
    });
    jest.spyOn(encryption, "decrypt").mockReturnValue("JBSWY3DPEHPK3PXP");
    jest.spyOn(authenticator, "verify").mockReturnValue(true);
    jest.spyOn(repo, "setTotpEnabled").mockResolvedValue(undefined);
    jest.spyOn(repo, "setMfaFrequency").mockResolvedValue(undefined);
    const revoke = jest.spyOn(knownDeviceRepo, "revokeMfaTrust").mockResolvedValue(undefined);
    let stored = [];
    jest.spyOn(repo, "replaceRecoveryCodes").mockImplementation(async (c, u, hashes) => {
      stored = hashes;
    });

    const out = await service.enableTotp({}, USER, "123456", { frequency: "daily" });

    expect(out.is_2fa_enabled).toBe(true);
    expect(out.mfa_frequency).toBe("daily");
    expect(out.recovery_codes).toHaveLength(10);
    // Readable off a printout: no 0/O, no 1/I/L, grouped in fives.
    for (const code of out.recovery_codes) {
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
    }
    expect(new Set(out.recovery_codes).size).toBe(10);
    // Stored hashed, never in the clear.
    expect(stored).toHaveLength(10);
    for (const h of stored) expect(h.startsWith("$argon2id$")).toBe(true);
    // Enrolling does not earn a window; proving a code at a sign-in does.
    expect(revoke).toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  test("one gets you in at sign-in, burns, and never works twice", async () => {
    const jwt = require("jsonwebtoken");
    const argon2 = require("argon2");
    const { config } = require("../../src/config/env");
    const { authenticator } = require("otplib");
    const encryption = require("../../src/services/encryption.service");
    const sessionStore = require("../../src/shared/cache/session-store");

    const hash = await argon2.hash("ABCDEFGHIJ", { type: argon2.argon2id });
    const rows = [{ code_id: "c1", code_hash: hash }];
    const burned = new Set();

    jest.spyOn(repo, "getTotpSecret").mockResolvedValue({
      user_id: USER,
      email: "ama@example.com",
      full_name: "Ama",
      is_2fa_enabled: true,
      totp_secret_enc: "enc",
      mfa_frequency: "daily",
    });
    jest.spyOn(encryption, "decrypt").mockReturnValue("JBSWY3DPEHPK3PXP");
    // The TOTP is wrong — this is somebody whose phone is gone.
    jest.spyOn(authenticator, "verify").mockReturnValue(false);
    jest.spyOn(repo, "liveRecoveryCodes").mockImplementation(async () =>
      rows.filter((r) => !burned.has(r.code_id)),
    );
    jest.spyOn(repo, "burnRecoveryCode").mockImplementation(async (c, id) => {
      if (burned.has(id)) return false;
      burned.add(id);
      return true;
    });
    jest.spyOn(repo, "countLiveRecoveryCodes").mockResolvedValue(9);
    const failure = jest.spyOn(repo, "recordLoginFailure").mockResolvedValue(undefined);
    jest.spyOn(repo, "recordLoginSuccess").mockResolvedValue(undefined);
    jest.spyOn(repo, "createSession").mockResolvedValue("55555555-5555-5555-5555-555555555555");
    jest.spyOn(repo, "setRefreshJti").mockResolvedValue(undefined);
    jest.spyOn(repo, "roleNames").mockResolvedValue(["CEO"]);
    jest.spyOn(sessionStore, "indexSession").mockResolvedValue(undefined);

    // resolveAiEnabled / resolveAiFeatures / resolveChannels read through the
    // client; an empty answer is the "nothing configured" path.
    const client = { query: async () => ({ rows: [] }) };
    const pendingToken = jwt.sign(
      { sub: USER, typ: "2fa_pending", via: "password" },
      config.JWT_ACCESS_SECRET,
      { expiresIn: 300 },
    );

    const out = await service.verifyTotp(client, { pendingToken, code: "abcde-fghij" });

    expect(out.access_token).toEqual(expect.any(String));
    // A recovery code is still the second factor, so the device earns the
    // window the account's frequency allows.
    expect(out.mfa_trust_until).toBeInstanceOf(Date);
    // And a wrong TOTP that was rescued by a recovery code is NOT a login failure.
    expect(failure).not.toHaveBeenCalled();
    // Burned, so somebody reading the same printout later gets nothing.
    expect(burned.has("c1")).toBe(true);

    const replay = jwt.sign(
      { sub: USER, typ: "2fa_pending", via: "password" },
      config.JWT_ACCESS_SECRET,
      { expiresIn: 300 },
    );
    await expect(
      service.verifyTotp(client, { pendingToken: replay, code: "ABCDE-FGHIJ" }),
    ).rejects.toMatchObject({ code: "INVALID_2FA_CODE" });
    expect(failure).toHaveBeenCalled();

    jest.restoreAllMocks();
  });

  test("a wrong code is refused without touching the live set's state", async () => {
    const argon2 = require("argon2");
    const hash = await argon2.hash("ABCDEFGHIJ", { type: argon2.argon2id });
    jest.spyOn(repo, "liveRecoveryCodes").mockResolvedValue([{ code_id: "c1", code_hash: hash }]);
    const burn = jest.spyOn(repo, "burnRecoveryCode").mockResolvedValue(true);

    // Right length, wrong code: every hash is walked and none matches.
    jest.spyOn(repo, "getTotpSecret").mockResolvedValue({
      user_id: USER, email: "a@b.com", is_2fa_enabled: true, totp_secret_enc: "enc",
    });
    const encryption = require("../../src/services/encryption.service");
    const { authenticator } = require("otplib");
    const jwt = require("jsonwebtoken");
    const { config } = require("../../src/config/env");
    jest.spyOn(encryption, "decrypt").mockReturnValue("JBSWY3DPEHPK3PXP");
    jest.spyOn(authenticator, "verify").mockReturnValue(false);
    jest.spyOn(repo, "recordLoginFailure").mockResolvedValue(undefined);

    const pendingToken = jwt.sign(
      { sub: USER, typ: "2fa_pending" }, config.JWT_ACCESS_SECRET, { expiresIn: 300 },
    );
    await expect(
      service.verifyTotp({ query: async () => ({ rows: [] }) }, { pendingToken, code: "ZZZZZ-ZZZZZ" }),
    ).rejects.toMatchObject({ code: "INVALID_2FA_CODE" });
    expect(burn).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });
});

describe("the device, between asks", () => {
  /** A 2FA account whose password is "right". */
  function enrolled() {
    const argon2 = require("argon2");
    jest.spyOn(repo, "recordLoginSuccess").mockResolvedValue(undefined);
    jest.spyOn(repo, "createSession").mockResolvedValue("55555555-5555-5555-5555-555555555555");
    jest.spyOn(repo, "setRefreshJti").mockResolvedValue(undefined);
    jest.spyOn(repo, "roleNames").mockResolvedValue([]);
    jest.spyOn(require("../../src/shared/cache/session-store"), "indexSession").mockResolvedValue(undefined);
    jest.spyOn(argon2, "verify").mockResolvedValue(true);
    jest.spyOn(repo, "findByEmail").mockResolvedValue({
      user_id: USER,
      email: "ama@example.com",
      full_name: "Ama",
      status: "ACTIVE",
      password_hash: "$argon2id$x",
      failed_logins: 0,
      is_2fa_enabled: true,
    });
    return { query: async () => ({ rows: [] }) };
  }

  afterEach(() => jest.restoreAllMocks());

  test("an untrusted device still gets the challenge", async () => {
    const out = await service.login(enrolled(), {
      email: "ama@example.com", password: "right", deviceTrusted: false,
    });
    expect(out.pending_2fa).toBe(true);
    expect(out.access_token).toBeUndefined();
  });

  test("a trusted device skips it, and the session records why", async () => {
    const out = await service.login(enrolled(), {
      email: "ama@example.com", password: "right", deviceTrusted: true,
    });
    expect(out.pending_2fa).toBeUndefined();
    expect(out.access_token).toEqual(expect.any(String));
  });

  test("a trusted device is NOT a way past the password", async () => {
    const client = enrolled();
    const argon2 = require("argon2");
    argon2.verify.mockResolvedValue(false); // wrong password, trusted device
    await expect(
      service.login(client, { email: "ama@example.com", password: "wrong", deviceTrusted: true }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  test("the trust is never consulted for an account with no authenticator", async () => {
    const client = enrolled();
    repo.findByEmail.mockResolvedValue({
      user_id: USER, email: "ama@example.com", full_name: "Ama", status: "ACTIVE",
      password_hash: "$argon2id$x", failed_logins: 0, is_2fa_enabled: false,
    });
    const out = await service.login(client, {
      email: "ama@example.com", password: "right", deviceTrusted: true,
    });
    expect(out.access_token).toEqual(expect.any(String));
  });
});

describe("an administrator's reset", () => {
  test("clears the factor, the codes and every device's window — and hands out nothing", async () => {
    jest.spyOn(repo, "getTotpSecret").mockResolvedValue({
      user_id: USER, email: "ama@example.com", is_2fa_enabled: true,
    });
    const disabled = jest.spyOn(repo, "setTotpEnabled").mockResolvedValue(undefined);
    const codes = jest.spyOn(repo, "deleteRecoveryCodes").mockResolvedValue(undefined);
    const revoke = jest.spyOn(knownDeviceRepo, "revokeMfaTrust").mockResolvedValue(undefined);
    audit.mockClear();

    const out = await service.resetMfaForUser({}, { id: USER, actor: { user_id: "admin" } });

    expect(out).toEqual({ is_2fa_enabled: false, reset: true });
    expect(disabled).toHaveBeenCalledWith({}, USER, false);
    expect(codes).toHaveBeenCalledWith({}, USER);
    expect(revoke).toHaveBeenCalledWith({}, USER);
    // No secret, no code, nothing the administrator could sign in with.
    expect(JSON.stringify(out)).not.toMatch(/secret|code/i);
    // One person removing another's second factor is always audited as sensitive.
    expect(audit).toHaveBeenCalledWith({}, expect.objectContaining({ isSensitive: true }));
    jest.restoreAllMocks();
  });

  test("is a no-op on an account that has no authenticator", async () => {
    jest.spyOn(repo, "getTotpSecret").mockResolvedValue({ user_id: USER, is_2fa_enabled: false });
    const disabled = jest.spyOn(repo, "setTotpEnabled").mockResolvedValue(undefined);
    const out = await service.resetMfaForUser({}, { id: USER, actor: { user_id: "admin" } });
    expect(out).toEqual({ is_2fa_enabled: false, reset: false });
    expect(disabled).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });
});
