"use strict";

/**
 * Every IMAP client this server builds gives up reaching a server in seconds,
 * and says which server it could not reach.
 *
 * None of them set a timeout, so each ran on imapflow's default of ninety
 * seconds to connect. When a mail host's firewall blocked this server's
 * address, "Create and test" on a new mailbox span for a minute and a half
 * with nothing on screen, then ended on "Failed to establish connection in
 * required time", a sentence that names no server and reads as a slow product.
 * The sending leg had been given short timeouts already (mail-smtp-timeouts);
 * the receiving leg, which verify() tries FIRST, had been missed.
 *
 *   1. The mailbox adapter and the IDLE worker both pass explicit timeouts, and
 *      a full "create and test" (both legs, worst case) ends inside the proxy's
 *      two-minute window.
 *   2. Silence on an open connection is NOT shortened: an idling mailbox is
 *      quiet by design.
 *   3. A server that could not be reached is reported as that, with the host
 *      and the port, the password ruled out, and the sending leg never tried.
 *      A rejected password and a server that DID answer are not relabelled.
 */

const mockImapOptions = [];
let mockImapConnect = async () => {};
jest.mock("imapflow", () => ({
  ImapFlow: class {
    constructor(opts) { mockImapOptions.push(opts); }
    on() {}
    async connect() { return mockImapConnect(); }
    async logout() {}
    async mailboxOpen() {}
  },
}));
const mockCreateTransport = jest.fn();
jest.mock("nodemailer", () => ({ createTransport: (...a) => mockCreateTransport(...a) }));

// The IDLE worker's surroundings: one tenant, one IMAP mailbox, nothing real.
jest.mock("../../src/services/tenant/registry.service", () => ({
  listActiveTenants: async () => [{ db_name: "tenant_one" }],
  withTenantConnection: async (_meta, _env, fn) => fn({}),
}));
jest.mock("../../src/modules/security/setting/setting.service", () => ({ readSecret: async () => "p" }));
jest.mock("../../src/modules/mail/mail/mail.repo", () => ({
  listSyncable: async () => [{
    email_connection_id: "c1", provider: "imap_smtp", email_address: "ops@example.cm",
    imap_host: "idle.example.cm", secret_key: "mail_conn:c1",
  }],
}));
jest.mock("../../src/jobs/queue-producer", () => ({ enqueue: async () => ({}) }));
jest.mock("../../src/config/redis", () => ({ initRedis: async () => {}, closeRedis: async () => {} }));
jest.mock("../../src/config/logger", () => ({ logger: { info() {}, warn() {}, error() {}, debug() {} } }));

const { IMAP, imapTimeouts } = require("../../src/shared/mail/imap-timeouts");
const { SEND } = require("../../src/shared/mail/smtp-timeouts");
const { ImapSmtpProvider } = require("../../src/modules/mail/mail/providers/imapSmtp.provider");

/** The proxy in front of the API cuts a request at about two minutes. */
const PROXY_WINDOW_MS = 120_000;

const mailbox = (over = {}) => new ImapSmtpProvider({
  email_address: "ops@example.cm", imap_host: "mail.example.cm", imap_port: 993,
  smtp_host: "mail.example.cm", smtp_port: 465, password: "p", ...over,
});

beforeEach(() => {
  mockImapOptions.length = 0;
  mockImapConnect = async () => {};
  mockCreateTransport.mockReset();
  mockCreateTransport.mockImplementation(() => ({ verify: async () => true }));
});

describe("the timeouts themselves", () => {
  test("reaching the server has a limit, far below imapflow's ninety seconds", () => {
    for (const k of ["connectionTimeout", "greetingTimeout"]) {
      expect(Number.isFinite(IMAP[k])).toBe(true);
      expect(IMAP[k]).toBeGreaterThan(0);
      expect(IMAP[k]).toBeLessThanOrEqual(30_000);
    }
  });

  test("a full create-and-test, both legs at their worst, ends inside the proxy's window", () => {
    // Receiving: connect, then the greeting. Sending: DNS, connect, greeting.
    const worst = IMAP.connectionTimeout + IMAP.greetingTimeout
      + SEND.dnsTimeout + SEND.connectionTimeout + SEND.greetingTimeout;
    expect(worst).toBeLessThan(PROXY_WINDOW_MS);
  });

  test("silence on an open connection is left to imapflow: an idling mailbox is quiet by design", () => {
    expect(IMAP.socketTimeout).toBeUndefined();
    expect(imapTimeouts().socketTimeout).toBeUndefined();
  });

  test("the helper hands back a copy, so one caller cannot change another's", () => {
    const a = imapTimeouts();
    a.connectionTimeout = 1;
    expect(imapTimeouts().connectionTimeout).toBe(IMAP.connectionTimeout);
  });
});

describe("every IMAP client passes them", () => {
  test("a mailbox's own adapter (create and test, Test, Sync now)", () => {
    mailbox()._imapClient();
    expect(mockImapOptions[0]).toEqual(expect.objectContaining({ host: "mail.example.cm", ...IMAP }));
  });

  test("the IDLE worker", async () => {
    const on = jest.spyOn(process, "on").mockImplementation(() => process);
    try {
      await require("../../src/jobs/mail-idle").main();
    } finally {
      on.mockRestore();
    }
    expect(mockImapOptions).toHaveLength(1);
    expect(mockImapOptions[0]).toEqual(expect.objectContaining({ host: "idle.example.cm", ...IMAP }));
    expect(mockImapOptions[0].socketTimeout).toBeUndefined();
  });
});

describe("verify() says a server could not be reached, and which one", () => {
  const failingWith = (err) => { mockImapConnect = async () => { throw err; }; };

  test.each([
    ["the connection timing out (a firewall dropping this server)", Object.assign(new Error("Failed to establish connection in required time"), { code: "CONNECT_TIMEOUT" })],
    ["a greeting that never comes", Object.assign(new Error("Failed to receive greeting from server in required time"), { code: "GREETING_TIMEOUT" })],
    ["a refused connection", Object.assign(new Error("connect ECONNREFUSED 203.0.113.9:993"), { code: "ECONNREFUSED" })],
    ["a host name that does not resolve", Object.assign(new Error("getaddrinfo ENOTFOUND mail.example.cm"), { code: "ENOTFOUND" })],
  ])("%s names the host and port, rules the password out, and never tries the sending leg", async (_name, err) => {
    failingWith(err);
    const result = await mailbox().verify();
    expect(result).toMatchObject({ ok: false, stage: "imap", code: "IMAP_UNREACHABLE" });
    expect(result.error).toMatch(/Could not reach mail\.example\.cm on port 993 from this server/);
    expect(result.error).toMatch(/password was never tried/);
    expect(mockCreateTransport).not.toHaveBeenCalled();
  });

  test("the port in the sentence is the one the mailbox uses", async () => {
    failingWith(Object.assign(new Error("Failed to establish connection in required time"), { code: "CONNECT_TIMEOUT" }));
    const result = await mailbox({ imap_port: 143 }).verify();
    expect(result.error).toMatch(/on port 143/);
  });

  test("a rejected password is still a password problem", async () => {
    failingWith(Object.assign(new Error("Invalid credentials (Failure) [AUTHENTICATIONFAILED]"), { authenticationFailed: true }));
    const result = await mailbox().verify();
    expect(result).toMatchObject({ ok: false, stage: "imap", code: "IMAP_AUTH_FAILED" });
    expect(result.error).not.toMatch(/Could not reach/);
  });

  test("a server that DID answer, with a certificate it should not have, is not called unreachable", async () => {
    const raw = "Hostname/IP does not match certificate's altnames";
    failingWith(Object.assign(new Error(raw), { code: "ERR_TLS_CERT_ALTNAME_INVALID" }));
    const result = await mailbox().verify();
    expect(result).toMatchObject({ ok: false, stage: "imap", code: null, error: raw });
  });

  test("a mailbox that connects still goes on to test the sending leg", async () => {
    const result = await mailbox().verify();
    expect(result).toEqual({ ok: true });
    expect(mockCreateTransport).toHaveBeenCalledTimes(1);
  });
});
