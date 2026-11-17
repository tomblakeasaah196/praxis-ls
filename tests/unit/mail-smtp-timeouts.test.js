"use strict";

/**
 * Every SMTP transport this server builds gives up in seconds, not minutes.
 *
 * None of them set a timeout, so each ran on nodemailer's defaults (two minutes
 * to connect, ten idle). When the platform's mail server stopped answering the
 * API host, "Create user" with an invitation hung for two minutes and ended in
 * the proxy's 504, and the console's Test for that same sender hung with it.
 *
 *   1. The system mailer, a user's own SMTP mailbox and the console's probe all
 *      pass explicit timeouts, and the wait before a dead server is reported is
 *      far inside the proxy's two-minute window.
 *   2. The probe says "could not reach the server" for a failure that happens
 *      before any SMTP reply, naming the host and port, and does NOT say that
 *      about a rejected password.
 */

const mockCreateTransport = jest.fn();
jest.mock("nodemailer", () => ({ createTransport: (...a) => mockCreateTransport(...a) }));
jest.mock("imapflow", () => ({ ImapFlow: class { async connect() {} async logout() {} } }));

const { SEND, PROBE, smtpTimeouts } = require("../../src/shared/mail/smtp-timeouts");

/** The proxy in front of the API cuts a request at about two minutes. */
const PROXY_WINDOW_MS = 120_000;
const KEYS = ["connectionTimeout", "greetingTimeout", "dnsTimeout", "socketTimeout"];

beforeEach(() => {
  mockCreateTransport.mockReset();
  mockCreateTransport.mockImplementation(() => ({ verify: async () => true, sendMail: async () => ({}) }));
});

describe("the timeouts themselves", () => {
  test.each([["send", SEND], ["probe", PROBE]])("%s: every wait is set, and a dead server is reported well inside the proxy's window", (_kind, t) => {
    for (const k of KEYS) {
      expect(Number.isFinite(t[k])).toBe(true);
      expect(t[k]).toBeGreaterThan(0);
    }
    // DNS, then the connection, then the greeting: the longest a server that
    // never answers can hold a request.
    expect(t.dnsTimeout + t.connectionTimeout + t.greetingTimeout).toBeLessThan(PROXY_WINDOW_MS / 2);
  });

  test("a probe waits no longer than a send", () => {
    for (const k of KEYS) expect(PROBE[k]).toBeLessThanOrEqual(SEND[k]);
  });

  test("the helper hands back a copy, so one caller cannot change another's", () => {
    const a = smtpTimeouts("send");
    a.connectionTimeout = 1;
    expect(smtpTimeouts("send").connectionTimeout).toBe(SEND.connectionTimeout);
  });
});

describe("every transport passes them", () => {
  test("the system mailer (invitations, password resets, sign-in codes)", () => {
    const email = require("../../src/services/email.service");
    email.transportFrom({ smtp_host: "mail.praxisls.com", smtp_port: 465, smtp_user: "u", smtp_pass: "p" });
    expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({ host: "mail.praxisls.com", ...SEND }));
  });

  test("a user's own SMTP mailbox", () => {
    const { ImapSmtpProvider } = require("../../src/modules/mail/mail/providers/imapSmtp.provider");
    new ImapSmtpProvider({
      email_address: "ops@example.cm", imap_host: "mail.example.cm", smtp_host: "mail.example.cm", smtp_port: 465, password: "p",
    })._smtpTransport();
    expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({ host: "mail.example.cm", ...SEND }));
  });

  test("the console's Test button", async () => {
    const probes = require("../../src/services/platform/settings.probes");
    await probes.smtp({ smtp_host: "mail.praxisls.com", smtp_port: 465, smtp_user: "u", smtp_pass: "p" });
    expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({ host: "mail.praxisls.com", ...PROBE }));
  });
});

describe("the console's Test says which kind of failure it was", () => {
  const probes = require("../../src/services/platform/settings.probes");
  const failingWith = (err) => mockCreateTransport.mockImplementation(() => ({ verify: async () => { throw err; } }));
  const cfg = { smtp_host: "mail.praxisls.com", smtp_port: 465, smtp_user: "u", smtp_pass: "p" };

  test.each([
    ["a connection that times out", Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" })],
    ["a refused connection", Object.assign(new Error("connect ECONNREFUSED 37.59.83.88:465"), { code: "ECONNREFUSED" })],
    ["a host name that does not resolve", Object.assign(new Error("getaddrinfo ENOTFOUND mail.praxisls.com"), { code: "EDNS" })],
    ["a greeting that never comes", Object.assign(new Error("Greeting never received"), { code: "ETIMEDOUT" })],
  ])("%s is 'could not reach', with the host and port, and no blame on the password", async (_name, err) => {
    failingWith(err);
    await expect(probes.smtp(cfg)).rejects.toMatchObject({
      code: "SMTP_UNREACHABLE",
      message: expect.stringMatching(/Could not reach mail\.praxisls\.com on port 465.*password was never tried/),
    });
  });

  test("a rejected password is still reported as a password problem", async () => {
    failingWith(Object.assign(new Error("Invalid login: 535 Incorrect authentication data"), { code: "EAUTH", responseCode: 535 }));
    const rejection = await probes.smtp(cfg).catch((e) => e);
    expect(rejection.code).not.toBe("SMTP_UNREACHABLE");
    expect(String(rejection.message)).not.toMatch(/Could not reach/);
  });
});
