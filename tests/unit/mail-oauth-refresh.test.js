/**
 * One OAuth refresh at a time (14420).
 *
 * The sync worker, repair on open, a send and a webhook can all ask for a
 * Microsoft or Google token in the same second. Each used to refresh on its own
 * and write back what it got, so the last write won. Now callers in a process
 * share the refresh in flight, and the refresh itself runs under an advisory
 * lock and re-reads the bundle once it holds it.
 */
"use strict";

const mockReadSecret = jest.fn();
const mockPut = jest.fn(async () => ({}));
jest.mock("../../src/modules/security/setting/setting.service", () => ({
  SECRET_SECTION: "integration_secret",
  readSecret: (...a) => mockReadSecret(...a),
  put: (...a) => mockPut(...a),
}));
const mockRefresh = jest.fn();
jest.mock("../../src/modules/mail/mail/providers/microsoftOAuth", () => ({
  refresh: (...a) => mockRefresh(...a),
}));
jest.mock("../../src/modules/mail/mail/mail.repo", () => ({
  updateConnection: jest.fn(async () => ({})),
}));

const service = require("../../src/modules/mail/mail/mail.service");

const CONN = { email_connection_id: "conn-ms", provider: "microsoft_graph", secret_key: "mail_conn:conn-ms" };
const bundle = (expiresIn) => JSON.stringify({ access_token: "old", refresh_token: "rt", expires_at: Date.now() + expiresIn });

const client = () => ({ query: jest.fn(async () => ({ rows: [] })) });

beforeEach(() => jest.clearAllMocks());

test("a token with time left is used as it is", async () => {
  mockReadSecret.mockResolvedValue(bundle(10 * 60 * 1000));
  const adapter = await service.resolveAdapter(client(), CONN);
  expect(await adapter._getToken()).toBe("old");
  expect(mockRefresh).not.toHaveBeenCalled();
});

test("three callers at once cause ONE refresh, under a lock, and all get its token", async () => {
  mockReadSecret.mockResolvedValue(bundle(10 * 1000)); // inside the 60s window
  let release;
  mockRefresh.mockImplementation(() => new Promise((r) => { release = () => r({ access_token: "new", expires_in: 3600 }); }));
  const c = client();
  const adapter = await service.resolveAdapter(c, CONN);

  const asks = [adapter._getToken(), adapter._getToken(), adapter._getToken()];
  await new Promise(setImmediate);
  release();
  expect(await Promise.all(asks)).toEqual(["new", "new", "new"]);
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(mockPut).toHaveBeenCalledTimes(1);
  const sql = c.query.mock.calls.map((x) => String(x[0]));
  expect(sql).toContain("SELECT pg_advisory_xact_lock(hashtext($1))");
  expect(c.query.mock.calls.find((x) => /advisory/.test(x[0]))[1]).toEqual(["mail_oauth:conn-ms"]);
});

test("another process refreshed while this one waited for the lock: its token is used", async () => {
  mockReadSecret
    .mockResolvedValueOnce(bundle(10 * 1000)) // before the lock: stale
    .mockResolvedValueOnce(JSON.stringify({ access_token: "theirs", refresh_token: "rt", expires_at: Date.now() + 3600e3 }));
  const adapter = await service.resolveAdapter(client(), CONN);
  expect(await adapter._getToken()).toBe("theirs");
  expect(mockRefresh).not.toHaveBeenCalled();
});

test("a failed refresh is not cached: the next caller tries again", async () => {
  mockReadSecret.mockResolvedValue(bundle(10 * 1000));
  mockRefresh.mockRejectedValueOnce(new Error("invalid_grant")).mockResolvedValueOnce({ access_token: "new", expires_in: 3600 });
  const adapter = await service.resolveAdapter(client(), CONN);
  await expect(adapter._getToken()).rejects.toThrow("invalid_grant");
  expect(await adapter._getToken()).toBe("new");
});
