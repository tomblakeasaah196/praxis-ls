"use strict";

/**
 * Google OAuth for Gmail mailboxes — credentials, error vocabulary, and the
 * Platform Console Test probe.
 *
 *   1. CREDENTIALS come from the platform vault first and `.env` last, field by
 *      field — the same tiering as Microsoft — so a deployment that only ever
 *      set GOOGLE_* keeps working, and one configured in the console wins.
 *   2. GOOGLE'S ERRORS are named: a cancel is OAUTH_CANCELLED (not a failure),
 *      a bad client is GOOGLE_BAD_CLIENT (the platform's problem, not the
 *      operator's), and an expired/revoked grant says "sign in again".
 *   3. THE PROBE passes on `invalid_grant` and fails on `invalid_client`: Google
 *      checks the client before the code, which is the only way to test a
 *      user-consent client's secret without a user.
 */

jest.mock("axios", () => ({ post: jest.fn() }));
// The real config object is frozen; give these tests a mutable copy of it.
jest.mock("../../src/config/env", () => {
  const actual = jest.requireActual("../../src/config/env");
  return { ...actual, config: { ...actual.config } };
});
jest.mock("../../src/services/platform/settings.service", () => ({ resolve: jest.fn(async () => null) }));

const axios = require("axios");
const platformSettings = require("../../src/services/platform/settings.service");
const { config } = require("../../src/config/env");
const googleOAuth = require("../../src/modules/mail/mail/providers/googleOAuth");

const saved = {};
beforeEach(() => {
  jest.clearAllMocks();
  for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "GOOGLE_SCOPES"]) saved[k] = config[k];
  config.GOOGLE_CLIENT_ID = "env-id";
  config.GOOGLE_CLIENT_SECRET = "env-secret";
  config.GOOGLE_REDIRECT_URI = "";
  config.GOOGLE_SCOPES = "openid email https://www.googleapis.com/auth/gmail.modify";
});
afterEach(() => Object.assign(config, saved));

describe("credentials", () => {
  test("falls back to the environment when nothing is stored", async () => {
    const c = await googleOAuth.credentials();
    expect(c).toMatchObject({ client_id: "env-id", client_secret: "env-secret", redirect_uri: null });
    await expect(googleOAuth.isConfigured()).resolves.toBe(true);
  });

  test("the platform vault wins over the environment, field by field", async () => {
    platformSettings.resolve.mockResolvedValueOnce({
      value: { client_id: "vault-id", redirect_uri: "https://praxisls.com/api/tenant/mail/oauth/google/callback" },
      secret: "vault-secret",
    });
    const c = await googleOAuth.credentials();
    expect(c).toMatchObject({
      client_id: "vault-id",
      client_secret: "vault-secret",
      redirect_uri: "https://praxisls.com/api/tenant/mail/oauth/google/callback",
      scopes: config.GOOGLE_SCOPES,
    });
  });

  test("an unreachable vault falls through to the environment instead of failing", async () => {
    platformSettings.resolve.mockRejectedValueOnce(new Error("db down"));
    await expect(googleOAuth.credentials()).resolves.toMatchObject({ client_id: "env-id" });
  });

  test("not configured when neither source has a secret", async () => {
    config.GOOGLE_CLIENT_SECRET = "";
    await expect(googleOAuth.isConfigured()).resolves.toBe(false);
  });

  test("the consent URL asks for offline access with the configured client and scopes", async () => {
    const url = new URL(await googleOAuth.authorizeUrl({ state: "s", redirectUri: "https://praxisls.com/cb" }));
    expect(url.searchParams.get("client_id")).toBe("env-id");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toContain("gmail.modify");
  });
});

describe("classifyProviderError", () => {
  test.each([
    ["access_denied", "OAUTH_CANCELLED"],
    ["invalid_client", "GOOGLE_BAD_CLIENT"],
    ["deleted_client", "GOOGLE_BAD_CLIENT"],
    ["redirect_uri_mismatch", "GOOGLE_REDIRECT_MISMATCH"],
    ["invalid_grant", "GOOGLE_GRANT_EXPIRED"],
    ["something_new", "GOOGLE_AUTH_FAILED"],
  ])("%s → %s", (error, code) => {
    expect(googleOAuth.classifyProviderError({ error })).toMatchObject({ code });
  });

  test("a failed refresh surfaces as the named error, not an axios dump", async () => {
    axios.post.mockRejectedValueOnce({
      response: { status: 400, data: { error: "invalid_grant", error_description: "Token has been expired or revoked." } },
    });
    await expect(googleOAuth.refresh({ refreshToken: "r" })).rejects.toMatchObject({ code: "GOOGLE_GRANT_EXPIRED" });
  });
});

describe("Platform Console Test probe", () => {
  const { googleGmail } = require("../../src/services/platform/settings.probes");
  const cfg = { client_id: "id", client_secret: "secret" };

  test("passes when Google rejects only the made-up code", async () => {
    axios.post.mockRejectedValueOnce({ response: { status: 400, data: { error: "invalid_grant" } } });
    await expect(googleGmail(cfg)).resolves.toMatchObject({ client_id: "id", credentials: "accepted" });
  });

  test("fails, naming the client, when Google rejects the credentials", async () => {
    axios.post.mockRejectedValueOnce({ response: { status: 401, data: { error: "invalid_client", error_description: "Unauthorized" } } });
    await expect(googleGmail(cfg)).rejects.toThrow(/rejected the client ID or secret/);
  });

  test("refuses to run without a client ID or secret", async () => {
    await expect(googleGmail({ client_id: "id" })).rejects.toThrow(/client secret/);
    expect(axios.post).not.toHaveBeenCalled();
  });
});
