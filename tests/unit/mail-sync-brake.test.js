"use strict";

/**
 * The brake on the scheduled mail sync (src/modules/mail/mail/sync-brake.js).
 *
 * The scheduler polled every mailbox once a minute, a failing one exactly like
 * a healthy one, for ever. A poll of an IMAP mailbox is a sign-in, so a mailbox
 * whose password the server refused was one refused sign-in a minute from this
 * server's address. The mail host's firewall blocks an address at ten in an
 * hour, and on 9 Nov 2026 it did: for eight days no system email left the
 * platform and every mailbox on that host stopped, for every tenant.
 *
 * What is pinned here, mostly by running the REAL job handler once a minute for
 * a simulated hour against a mailbox that fails the way the database records it:
 *
 *   1. a refused sign-in is tried three times and then left for a person;
 *   2. any other failure is tried less and less often;
 *   3. a healthy mailbox is still polled every minute, next to a held one;
 *   4. a recovery releases the brake at once;
 *   5. the mailbox says, in words, that it is paused or when it is tried next;
 *   6. a refused sign-in is recognised from imapflow's REAL error, whose
 *      message is the bare "Command failed";
 *   7. the always-on IDLE listener follows the same rule.
 */

const mockRows = [];
const mockSync = jest.fn();
const mockImap = { made: [], connect: async () => {} };

jest.mock("../../src/services/tenant/registry.service", () => ({
  listActiveTenants: async () => [{ db_name: "tenant_one" }],
  withTenantConnection: async (_meta, _env, fn) => fn({}),
}));
jest.mock("../../src/modules/mail/mail/mail.repo", () => ({ listSyncable: async () => mockRows }));
jest.mock("../../src/modules/mail/mail/mail.service", () => ({ syncConnection: (...a) => mockSync(...a) }));
jest.mock("../../src/modules/security/setting/setting.service", () => ({ readSecret: async () => "p" }));
jest.mock("../../src/jobs/queue-producer", () => ({ enqueue: async () => ({}) }));
jest.mock("../../src/config/redis", () => ({ initRedis: async () => {}, closeRedis: async () => {} }));
jest.mock("../../src/config/logger", () => ({ logger: { info() {}, warn() {}, error() {}, debug() {} } }));
jest.mock("imapflow", () => ({
  ImapFlow: class {
    constructor(opts) { this.opts = opts; this.handlers = {}; mockImap.made.push(this); }
    on(ev, fn) { this.handlers[ev] = fn; }
    async connect() {
      try {
        await mockImap.connect();
      } catch (err) {
        // A connection that fails closes, as the real client's does.
        if (this.handlers.close) this.handlers.close();
        throw err;
      }
    }
    async mailboxOpen() {}
    async logout() {}
  },
}));

const brake = require("../../src/modules/mail/mail/sync-brake");
const { health } = require("../../src/modules/mail/mail/limits");
const {
  describeImapFailure, isSignInRefusal, isImapAuthFailure, SIGN_IN_REFUSED_MARK,
} = require("../../src/modules/mail/mail/smtp-error.map");
const mailSync = require("../../src/jobs/handlers/mail-sync");

const MINUTE = 60_000;
const START = new Date("2026-11-09T09:22:00Z").getTime();
const WHERE = { host: "mail.example.cm", port: 993 };

/** imapflow's refused LOGIN, as it really arrives: nothing in the message. */
const refusedLogin = () => Object.assign(new Error("Command failed"), {
  authenticationFailed: true,
  serverResponseCode: "AUTHENTICATIONFAILED",
  response: "[AUTHENTICATIONFAILED] Authentication failed.",
});
const unreachable = () => Object.assign(new Error("Failed to establish connection in required time"), { code: "CONNECT_TIMEOUT" });

const REFUSED = describeImapFailure(refusedLogin(), WHERE).message;
const UNREACHABLE = describeImapFailure(unreachable(), WHERE).message;
const BAD_CERTIFICATE = "Hostname/IP does not match certificate's altnames";

const mailbox = (over = {}) => ({
  email_connection_id: "c1", provider: "imap_smtp", email_address: "ops@example.cm",
  imap_host: "mail.example.cm", secret_key: "mail_conn:c1",
  status: "CONNECTED", consecutive_failures: 0, last_error: null,
  last_failure_at: null, last_failure_reason: null, ...over,
});

/** What `bumpFailure` writes, so the fake fails the way the database records it. */
function fail(row, reason) {
  row.consecutive_failures += 1;
  row.last_error = reason;
  row.last_failure_reason = reason;
  row.last_failure_at = new Date(Date.now()).toISOString();
  if (row.consecutive_failures >= 3) row.status = "ERROR";
}

/** What a good sync, or a passing Test, writes. */
function recover(row) {
  row.consecutive_failures = 0;
  row.last_error = null;
  row.status = "CONNECTED";
}

/** Run the real job once a minute; return the minutes on which `id` was tried. */
async function runFor(minutes, id = "c1", from = 0) {
  const tried = [];
  for (let m = from; m < from + minutes; m += 1) {
    jest.setSystemTime(START + m * MINUTE);
    const before = mockSync.mock.calls.filter((c) => c[1] === id).length;
    await mailSync({ data: { tenantMeta: { slug: "tenant-one" }, env: "live" } });
    if (mockSync.mock.calls.filter((c) => c[1] === id).length > before) tried.push(m);
  }
  return tried;
}

beforeEach(() => {
  jest.useFakeTimers({ now: START });
  mockRows.length = 0;
  mockSync.mockReset();
  mockImap.made.length = 0;
  mockImap.connect = async () => {};
});
afterEach(() => {
  jest.useRealTimers();
});

describe("the scheduled sync, once a minute for an hour", () => {
  test("a refused password is tried three times, then left alone: far under the host's ten", async () => {
    const row = mailbox();
    mockRows.push(row);
    mockSync.mockImplementation(async () => { fail(row, REFUSED); return { error: REFUSED }; });

    expect(await runFor(60)).toEqual([0, 1, 2]);
    // ...and not the next day either. It is waiting for a person.
    expect(await runFor(24 * 60, "c1", 60)).toEqual([]);
  });

  test("a host that cannot be reached is tried less and less often", async () => {
    const row = mailbox();
    mockRows.push(row);
    mockSync.mockImplementation(async () => { fail(row, UNREACHABLE); return { error: UNREACHABLE }; });

    // Three in a row, then 5, 15 and 60 minutes after each failure.
    expect(await runFor(60)).toEqual([0, 1, 2, 7, 22]);
    // Over a whole day: ten tries, where the loop used to make 1,440.
    const day = [0, 1, 2, 7, 22, ...(await runFor(24 * 60 - 60, "c1", 60))];
    expect(day).toEqual([0, 1, 2, 7, 22, 82, 262, 622, 982, 1342]);
  });

  test("a healthy mailbox is still polled every minute, beside one that is held", async () => {
    const stuck = mailbox({ email_connection_id: "stuck" });
    const fine = mailbox({ email_connection_id: "fine" });
    mockRows.push(stuck, fine);
    mockSync.mockImplementation(async (_c, id) => {
      if (id === "stuck") { fail(stuck, REFUSED); return { error: REFUSED }; }
      return { inserted: 0 };
    });

    const stuckTried = [];
    const fineTried = [];
    for (let m = 0; m < 60; m += 1) {
      jest.setSystemTime(START + m * MINUTE);
      const before = mockSync.mock.calls.length;
      const out = await mailSync({ data: { tenantMeta: { slug: "tenant-one" }, env: "live" } });
      const ids = mockSync.mock.calls.slice(before).map((c) => c[1]);
      if (ids.includes("stuck")) stuckTried.push(m);
      if (ids.includes("fine")) fineTried.push(m);
      // The held mailbox is reported as held, not silently dropped.
      if (m > 2) expect(out.results).toContainEqual(expect.objectContaining({ connection: "stuck", held: "signin" }));
    }
    expect(stuckTried).toEqual([0, 1, 2]);
    expect(fineTried).toHaveLength(60);
  });

  test("a recovery releases the brake at once", async () => {
    const row = mailbox();
    mockRows.push(row);
    mockSync.mockImplementation(async () => { fail(row, REFUSED); return { error: REFUSED }; });
    expect(await runFor(30)).toEqual([0, 1, 2]);

    // The password is put right and a Test passes (mail.service.testConnection
    // writes the counter back to zero). From then on it is a healthy mailbox.
    recover(row);
    mockSync.mockImplementation(async () => ({ inserted: 0 }));
    expect(await runFor(5, "c1", 30)).toEqual([30, 31, 32, 33, 34]);
  });

  test("one or two failures are a wobble: the next minute tries again", async () => {
    const row = mailbox();
    mockRows.push(row);
    let n = 0;
    mockSync.mockImplementation(async () => {
      n += 1;
      if (n <= 2) { fail(row, UNREACHABLE); return { error: UNREACHABLE }; }
      recover(row);
      return { inserted: 0 };
    });
    expect(await runFor(6)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("the verdict itself", () => {
  const at = (failures, minutesAgo, reason = UNREACHABLE) => mailbox({
    consecutive_failures: failures,
    last_failure_reason: reason,
    last_failure_at: new Date(START - minutesAgo * MINUTE).toISOString(),
  });

  test("the steps are 5, 15, 60, 180 and 360 minutes, and the last one repeats", () => {
    expect(brake.BACKOFF_MINUTES).toEqual([5, 15, 60, 180, 360]);
    for (const [failures, wait] of [[3, 5], [4, 15], [5, 60], [6, 180], [7, 360], [40, 360]]) {
      expect(brake.verdict(at(failures, wait - 1), START)).toMatchObject({ due: false, kind: "backoff" });
      expect(brake.verdict(at(failures, wait), START)).toEqual({ due: true });
    }
  });

  test("a refused sign-in has no time at which it is tried again", () => {
    expect(brake.verdict(at(3, 10_000, REFUSED), START)).toEqual({ due: false, kind: "signin", retryAt: null });
  });

  test("a failing mailbox with no record of when it failed is tried, not held for ever", () => {
    expect(brake.verdict(mailbox({ consecutive_failures: 9, last_failure_reason: UNREACHABLE }), START)).toEqual({ due: true });
  });

  test("the threshold is the one that turns a mailbox to ERROR", () => {
    expect(brake.FAILURES_BEFORE_BRAKE).toBe(3);
    expect(brake.verdict(at(2, 0, REFUSED), START)).toEqual({ due: true });
  });
});

describe("the mailbox says what is happening", () => {
  test("paused for a refused password: it says so, and what resumes it", () => {
    const h = health(mailbox({
      status: "ERROR", consecutive_failures: 3, last_error: REFUSED, last_failure_reason: REFUSED,
      last_failure_at: new Date(START).toISOString(),
    }), { now: new Date(START + 5 * MINUTE) });
    expect(h).toMatchObject({ level: "DOWN", paused: true, failures: 3 });
    expect(h.reason).toMatch(/^Paused: the mail server refused this mailbox's password/);
    expect(h.reason).toMatch(/automatic syncing has stopped/);
    expect(h.reason).toMatch(/Enter the password again to resume\.$/);
  });

  test("backing off: the reason, then roughly when it is tried next", () => {
    const h = health(mailbox({
      status: "ERROR", consecutive_failures: 3, last_error: BAD_CERTIFICATE, last_failure_reason: BAD_CERTIFICATE,
      last_failure_at: new Date(START).toISOString(),
    }), { now: new Date(START + MINUTE) });
    expect(h.level).toBe("DOWN");
    expect(h.reason).toBe(`Failing to connect: ${BAD_CERTIFICATE}. Trying again in about 4 minutes.`);
    expect(h.retry_at).toBe(new Date(START + 5 * MINUTE).toISOString());
    expect(h.paused).toBeUndefined();
  });

  test("a long wait is said in hours, and a sentence that already ends is not given a second full stop", () => {
    const h = health(mailbox({
      status: "ERROR", consecutive_failures: 7, last_error: UNREACHABLE, last_failure_reason: UNREACHABLE,
      last_failure_at: new Date(START).toISOString(),
    }), { now: new Date(START + MINUTE) });
    expect(h.reason).toMatch(/The password was never tried\. Trying again in about 6 hours\.$/);
  });

  test("due again, or with nothing to wait from: the reason alone, exactly as before", () => {
    expect(health(mailbox({ status: "ERROR", consecutive_failures: 5, last_error: "LIST refused" })))
      .toEqual({ level: "DOWN", reason: "Failing to connect: LIST refused", failures: 5 });
    expect(health(mailbox({ status: "ERROR", consecutive_failures: 4 })).reason).toBe("Failed to connect 4 times in a row.");
  });

  test("the waits read as people say them", () => {
    expect(brake.waitInWords(new Date(START + 30_000), START)).toBe("about 1 minute");
    expect(brake.waitInWords(new Date(START + 14 * MINUTE), START)).toBe("about 14 minutes");
    expect(brake.waitInWords(new Date(START + 60 * MINUTE), START)).toBe("about 1 hour");
    expect(brake.waitInWords(new Date(START + 170 * MINUTE), START)).toBe("about 3 hours");
  });
});

describe("a refused sign-in is recognised from what the server really sends", () => {
  test("imapflow's refused LOGIN says nothing in its message; the object does", () => {
    const err = refusedLogin();
    expect(err.message).toBe("Command failed");
    expect(isImapAuthFailure(err)).toBe(true);
    const described = describeImapFailure(err, WHERE);
    expect(described.code).toBe("IMAP_AUTH_FAILED");
    expect(described.message).toContain(SIGN_IN_REFUSED_MARK);
    // The server's own words, not "Command failed".
    expect(described.message).toContain("Authentication failed.");
    expect(described.message).not.toContain("Command failed");
  });

  test("the sentence that is stored and the test that reads it back cannot drift apart", () => {
    expect(isSignInRefusal(REFUSED)).toBe(true);
    expect(isSignInRefusal(describeImapFailure(new Error("Invalid credentials (Failure) [AUTHENTICATIONFAILED]")).message)).toBe(true);
  });

  test.each([
    ["a host that cannot be reached", UNREACHABLE],
    ["a certificate that does not match", BAD_CERTIFICATE],
    ["a folder listing the server refused", "LIST refused"],
    ["nothing at all", null],
  ])("%s is not a refused sign-in", (_name, text) => {
    expect(isSignInRefusal(text)).toBe(false);
  });

  test("an unreachable host is not mistaken for a refusal because the sentence mentions the password", () => {
    expect(UNREACHABLE).toMatch(/password was never tried/);
    expect(describeImapFailure(unreachable(), WHERE).code).toBe("IMAP_UNREACHABLE");
  });
});

describe("the always-on IDLE listener follows the same rule", () => {
  /** A fresh copy of the worker: it keeps its own book of who was refused. */
  const startWorker = async () => {
    let idle;
    jest.isolateModules(() => { idle = require("../../src/jobs/mail-idle"); });
    const on = jest.spyOn(process, "on").mockImplementation(() => process);
    try {
      await idle.main();
    } finally {
      on.mockRestore();
    }
    return idle;
  };

  test("a refused sign-in is not tried again by the worker, however long it runs", async () => {
    mockRows.push(mailbox());
    mockImap.connect = async () => { throw refusedLogin(); };
    await startWorker();
    expect(mockImap.made).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(6 * 60 * MINUTE);
    expect(mockImap.made).toHaveLength(1);
  });

  test("a host that cannot be reached is tried at widening intervals, not four times a minute", async () => {
    mockRows.push(mailbox());
    mockImap.connect = async () => { throw unreachable(); };
    await startWorker();
    expect(mockImap.made).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(29_000);
    expect(mockImap.made).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(mockImap.made).toHaveLength(2);
    // Half an hour in: a handful of connections, where a fixed 15 s made 120.
    await jest.advanceTimersByTimeAsync(30 * MINUTE - 30_000);
    expect(mockImap.made.length).toBeGreaterThanOrEqual(5);
    expect(mockImap.made.length).toBeLessThanOrEqual(7);
  });

  test("a connection that was idling and dropped comes straight back", async () => {
    mockRows.push(mailbox());
    await startWorker();
    expect(mockImap.made).toHaveLength(1);
    mockImap.made[0].handlers.close();
    await jest.advanceTimersByTimeAsync(14_000);
    expect(mockImap.made).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(mockImap.made).toHaveLength(2);
  });

  test("the reconnect wait doubles from fifteen seconds to a ceiling of fifteen minutes", async () => {
    const idle = await startWorker();
    expect([0, 1, 2, 3].map(idle.reconnectDelay)).toEqual([15_000, 30_000, 60_000, 120_000]);
    expect(idle.reconnectDelay(30)).toBe(15 * MINUTE);
  });
});
