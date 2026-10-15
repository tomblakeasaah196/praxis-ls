/**
 * 14420: the pieces of "every folder syncs" that live below the engine.
 *
 *   - a discovered folder CLAIMS the row that already holds its role, rather
 *     than violating `ux_email_folder_canonical` and failing the whole sync;
 *   - a failed sync is counted, its reason kept after recovery;
 *   - an OAuth token is refreshed once, however many callers ask at once.
 *
 * Hermetic: the client records SQL and answers from a script.
 */
"use strict";

const threadRepo = require("../../src/modules/mail/mail/thread.repo");
const mailboxRepo = require("../../src/modules/mail/mail/mailbox.repo");

const scripted = (...answers) => {
  const calls = [];
  return {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push({ sql: String(sql), params });
      const next = answers.length ? answers.shift() : { rows: [] };
      return typeof next === "function" ? next(sql, params) : next;
    }),
  };
};

describe("upsertFolder: a role belongs to one row", () => {
  test("the real Sent folder takes over the placeholder that held SENT", async () => {
    const claimed = { email_folder_id: "f-sent", canonical: "SENT", provider_path: "SE-ID" };
    const c = scripted({ rows: [claimed] });
    const row = await threadRepo.upsertFolder(c, "conn-1", {
      canonical: "SENT", provider_path: "SE-ID", display_name: "Éléments envoyés", is_syncable: true,
    });
    expect(row).toBe(claimed);
    expect(c.calls).toHaveLength(1);
    const { sql, params } = c.calls[0];
    expect(sql).toMatch(/UPDATE email_folder f/);
    expect(sql).toMatch(/f\.canonical = \$2 AND f\.provider_path <> \$3/);
    // A cursor belongs to a path: the claimed row starts its folder again.
    expect(sql).toMatch(/sync_cursor = NULL/);
    expect(params).toEqual(["conn-1", "SENT", "SE-ID", "Éléments envoyés", true]);
  });

  test("with nothing to claim, it inserts, and only takes a role no other row holds", async () => {
    const inserted = { email_folder_id: "f-new" };
    const c = scripted({ rows: [] }, { rows: [inserted] });
    const row = await threadRepo.upsertFolder(c, "conn-1", {
      canonical: "SPAM", provider_path: "JUNK-ID", display_name: "Junk", is_syncable: true,
    });
    expect(row).toBe(inserted);
    const insert = c.calls[1].sql;
    expect(insert).toMatch(/INSERT INTO email_folder/);
    expect(insert).toMatch(/NOT EXISTS \([\s\S]*o\.canonical = \$2 AND o\.provider_path <> \$3\)/);
    // Never syncable without the role, so a demoted second Spam is not read into Archive.
    expect(insert).toMatch(/\$5 AND role\.canonical IS NOT NULL/);
  });

  test("a folder with no role skips the claim", async () => {
    const c = scripted({ rows: [{ email_folder_id: "f-u" }] });
    await threadRepo.upsertFolder(c, "conn-1", { canonical: null, provider_path: "U1", display_name: "Clients", is_syncable: false });
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0].sql).toMatch(/INSERT INTO email_folder/);
  });
});

describe("a failed sync is counted, and remembered", () => {
  test("bumpFailure keeps the reason and the time beside the current error", async () => {
    const c = scripted({ rows: [{ consecutive_failures: 1, status: "CONNECTED" }] });
    await mailboxRepo.bumpFailure(c, "conn-1", "AADSTS70008: expired");
    const { sql, params } = c.calls[0];
    expect(sql).toMatch(/last_failure_reason = \$2/);
    expect(sql).toMatch(/last_failure_at = now\(\)/);
    expect(sql).toMatch(/consecutive_failures \+ 1 >= 3 AND status = 'CONNECTED'/);
    expect(params).toEqual(["conn-1", "AADSTS70008: expired"]);
  });

  test("recovery clears the current error and leaves the last failure alone", async () => {
    const c = scripted({ rows: [{}] });
    await mailboxRepo.clearFailures(c, "conn-1");
    expect(c.calls[0].sql).toMatch(/last_error = NULL/);
    expect(c.calls[0].sql).not.toMatch(/last_failure/);
  });
});

describe("read state from the server", () => {
  test("a new message is seeded read when the server says it was", async () => {
    const c = scripted({ rows: [] });
    await threadRepo.seedStateForMembers(c, "m1", "conn-1", { isRead: true });
    expect(c.calls[0].params).toEqual(["m1", "conn-1", true]);
  });

  test("read on the server marks it read for the owner of a PERSONAL mailbox only", async () => {
    const c = scripted({ rows: [] });
    await threadRepo.markReadForOwner(c, "m1", "conn-1");
    expect(c.calls[0].sql).toMatch(/c\.kind = 'PERSONAL'/);
  });
});

describe("the sent copy is matched on what both copies share", () => {
  test("Message-ID first; otherwise subject, a recipient and ten minutes, outbound rows Praxis wrote only", async () => {
    const c = scripted({ rows: [{ email_message_id: "local" }] });
    const at = new Date("2026-10-15T17:34:00Z");
    await threadRepo.adoptLocalSend(c, "conn-1", {
      externalMessageId: "srv", messageIdHeader: null, subject: "Quote", to: ["a@b.cm"], receivedAt: at, providerPath: "SE",
    });
    const { sql, params } = c.calls[0];
    expect(sql).toMatch(/m\.direction = 'OUT' AND m\.provider_folder IS NULL/);
    expect(sql).toMatch(/interval '10 minutes'/);
    expect(params).toEqual(["conn-1", "srv", null, "Quote", ["a@b.cm"], at, "SE"]);
  });
});
