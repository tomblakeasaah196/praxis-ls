/**
 * mail.service.syncConnection unit tests — hermetic. Verifies the engine loop:
 * dedup-insert, one event per NEW message, attachment persistence, CRM linking,
 * cursor advance, and error isolation. Repo / adapter / vault / settings /
 * events are all mocked.
 *
 * PR-1A rewrote what the loop writes. It no longer inserts a flat
 * `email_inbound` row; it folds each message into a CONVERSATION
 * (thread.repo.upsertThread → insertMessage), walks FOLDERS with a cursor each,
 * and records read state per user. So the assertions here moved from
 * `mail.repo.insertInbound` to `thread.repo.insertMessage`, and a second folder
 * appears in the fixtures — a loop that only ever sees one folder cannot show
 * that a failure in one is isolated from the rest, which is the property the
 * per-folder cursor exists to protect.
 *
 * NOTE: jest.mock factories are hoisted, so any var they reference must be
 * `mock`-prefixed (jest's babel-hoist rule).
 */
"use strict";

const mockFetchSince = jest.fn();
const mockListFolders = jest.fn();
const mockVerify = jest.fn();
const mockMarkAsRead = jest.fn();
const mockSendEmail = jest.fn();
const mockEmitEvent = jest.fn(async () => {});

jest.mock("../../src/modules/mail/mail/providers/imapSmtp.provider", () => ({
  ImapSmtpProvider: jest.fn().mockImplementation(() => ({
    fetchSince: mockFetchSince,
    listFolders: mockListFolders,
    verify: mockVerify,
    markAsRead: mockMarkAsRead,
    sendEmail: mockSendEmail,
    capabilities: () => ({ folders: true, folderMove: true, serverFlags: true }),
  })),
}));
jest.mock("../../src/modules/security/setting/setting.service", () => ({
  SECRET_SECTION: "integration_secret",
  put: jest.fn(async () => ({})),
  readSecret: jest.fn(async () => "decrypted-password"),
}));
jest.mock("../../src/shared/events/emit", () => ({
  resolveActorId: async (c, id) => id || null,
  emitEvent: (...a) => mockEmitEvent(...a),
}));
jest.mock(
  "../../src/modules/vault/document_vault/document_vault.service",
  () => ({
    createDocument: jest.fn(async () => ({ doc_id: "vault-1" })),
  }),
);
// sanitize-html mocked to a marker so the ingest-sanitization path is provable
// without the real dependency installed.
jest.mock("sanitize-html", () => {
  const fn = (html) => `SANITIZED:${html}`;
  fn.defaults = { allowedTags: ["p", "a"], allowedAttributes: { a: ["href"] } };
  return fn;
});
// PR-0: the sync loop now writes health book-keeping (clear on success, count
// on failure) and asks the mailbox layer for a send allowance. Mocked here for
// the same reason mail.repo is — these are hermetic tests with no database.
jest.mock("../../src/modules/mail/mail/mailbox.repo", () => ({
  getConnection: jest.fn(async () => ({
    email_connection_id: "conn-1",
    kind: "PERSONAL",
  })),
  updateConnection: jest.fn(async () => ({})),
  clearFailures: jest.fn(async () => ({})),
  bumpFailure: jest.fn(async () => ({
    consecutive_failures: 1,
    status: "CONNECTED",
  })),
  sendCounts: jest.fn(async () => ({ hourly: 0, daily: 0 })),
  bumpSendWindow: jest.fn(async () => ({ sent_count: 1 })),
  recordAccessAudit: jest.fn(async () => ({})),
  listMembers: jest.fn(async () => []),
  liveMember: jest.fn(async () => null),
  personalFor: jest.fn(async () => null),
}));
jest.mock("../../src/shared/config/settings", () => ({
  getSetting: jest.fn(async () => ({})),
}));
const mockSuggest = jest.fn(async () => []);
jest.mock("../../src/modules/mail/binding/binding.service", () => ({
  suggestOnIngest: (...a) => mockSuggest(...a),
}));
jest.mock("../../src/modules/mail/mail/mail.repo", () => ({
  getConnection: jest.fn(),
  updateConnection: jest.fn(async () => ({})),
  setError: jest.fn(async () => {}),
  addAttachment: jest.fn(async () => ({})),
  findClientByEmail: jest.fn(async () => null),
  findDossierByRefs: jest.fn(async () => null),
  listAttachments: jest.fn(async () => []),
}));
// PR-1A: the conversation model. Mocked wholesale for the same reason mail.repo
// is — these tests are hermetic and there is no database behind them.
jest.mock("../../src/modules/mail/mail/thread.repo", () => ({
  upsertFolder: jest.fn(async (_c, connId, f) => ({
    email_folder_id: `fold-${f.canonical}`,
    email_connection_id: connId,
    canonical: f.canonical,
    provider_path: f.provider_path,
    is_syncable: f.is_syncable !== false,
    sync_cursor: null,
    last_sync_at: null,
  })),
  syncableFolders: jest.fn(async () => []),
  setFolderCursor: jest.fn(async () => ({})),
  setFolderError: jest.fn(async () => ({})),
  streamRules: jest.fn(async () => []),
  knownParty: jest.fn(async () => null),
  upsertThread: jest.fn(async () => ({ email_thread_id: "thr-1", message_count: 0 })),
  updateThread: jest.fn(async () => ({})),
  refreshThreadCounts: jest.fn(async () => ({})),
  insertMessage: jest.fn(),
  seedStateForMembers: jest.fn(async () => 0),
  setThreadRead: jest.fn(async () => 0),
  // 14420: the engine looks a message up before it stores it, adopts the row
  // Praxis wrote when it sent one, and follows a message the server moved.
  findMessageByExternal: jest.fn(async () => null),
  adoptLocalSend: jest.fn(async () => null),
  adoptLegacyCopy: jest.fn(async () => null),
  deleteThreadIfEmpty: jest.fn(async () => ({})),
  relocateMessage: jest.fn(async () => ({})),
  markReadForOwner: jest.fn(async () => ({})),
  foldersByPath: jest.fn(async () => new Map()),
  externalIdsFor: jest.fn(async () => []),
  translateExternalIds: jest.fn(async () => 0),
  getMessage: jest.fn(),
  listThreads: jest.fn(async () => []),
  timelineByEntity: jest.fn(async () => []),
}));

const repo = require("../../src/modules/mail/mail/mail.repo");
const threads = require("../../src/modules/mail/mail/thread.repo");
const vault = require("../../src/modules/vault/document_vault/document_vault.service");
const service = require("../../src/modules/mail/mail/mail.service");

const CONN = {
  email_connection_id: "conn-1",
  provider: "imap_smtp",
  email_address: "me@co.cm",
  secret_key: "mail_conn:conn-1",
  sync_cursor: null,
};

// Two folders, because one folder cannot demonstrate isolation. INBOX first so
// the ordinary assertions read against a familiar name.
const INBOX = {
  email_folder_id: "fold-INBOX", canonical: "INBOX", provider_path: "INBOX",
  is_syncable: true, sync_cursor: null,
};
const ARCHIVE = {
  email_folder_id: "fold-ARCHIVE", canonical: "ARCHIVE", provider_path: "Archive",
  is_syncable: true, sync_cursor: { uidvalidity: 10, last_uid: 3 },
};

const inbound = (over = {}) => ({
  externalMessageId: "<a>", from: "x@y", to: ["me@co.cm"],
  subject: "A", bodyText: "a", attachments: [], ...over,
});

/**
 * The db client this file passes to the service.
 *
 * It was `{}` — an object with no `query`, which meant every code path in the
 * sync loop that talks to the database directly rather than through a mocked
 * repo was invisible here, and one of them (`cancel_on_reply` on ingest) had
 * acquired a `typeof client.query === "function"` guard in PRODUCTION code to
 * survive it. That is the FN-1 shape: a fixture that cannot produce what the
 * driver produces tests only itself. It now answers, emptily but truthfully,
 * so a direct query is exercised rather than skipped.
 */
const DB = { query: jest.fn(async () => ({ rows: [] })) };

// jest.clearAllMocks() resets CALLS but not IMPLEMENTATIONS, so every default a
// test may consume is re-established here. A mockResolvedValueOnce left over
// from a previous test is one of the hardest failures in this file to read.
beforeEach(() => {
  jest.clearAllMocks();
  repo.getConnection.mockResolvedValue(CONN);
  repo.findClientByEmail.mockResolvedValue(null);
  repo.findDossierByRefs.mockResolvedValue(null);
  mockListFolders.mockResolvedValue([
    { path: "INBOX", name: "INBOX", flags: [] },
    { path: "Archive", name: "Archive", flags: ["\\Archive"] },
  ]);
  threads.syncableFolders.mockResolvedValue([INBOX]);
  threads.upsertThread.mockResolvedValue({ email_thread_id: "thr-1", message_count: 0 });
  threads.knownParty.mockResolvedValue(null);
  threads.streamRules.mockResolvedValue([]);
  threads.insertMessage.mockResolvedValue({ email_message_id: "msg-1" });
  mockFetchSince.mockResolvedValue({ messages: [], nextCursor: null });
});

test("discovers folders from the server and syncs each with its own cursor", async () => {
  threads.syncableFolders.mockResolvedValue([INBOX, ARCHIVE]);
  mockFetchSince.mockResolvedValue({ messages: [], nextCursor: { uidvalidity: 10, last_uid: 4 } });

  const res = await service.syncConnection(DB, "conn-1", {});

  // Each folder is fetched with ITS OWN cursor, not one shared connection cursor.
  // UIDVALIDITY is per mailbox in IMAP: sharing a cursor makes a renumber in
  // Archive look like a renumber in INBOX and re-downloads the wrong folder.
  expect(mockFetchSince).toHaveBeenCalledWith(null, "INBOX");
  expect(mockFetchSince).toHaveBeenCalledWith({ uidvalidity: 10, last_uid: 3 }, "Archive");
  expect(threads.setFolderCursor).toHaveBeenCalledWith(DB, "fold-INBOX", { uidvalidity: 10, last_uid: 4 });
  expect(threads.setFolderCursor).toHaveBeenCalledWith(DB, "fold-ARCHIVE", { uidvalidity: 10, last_uid: 4 });
  expect(res.folders).toEqual([
    { folder: "INBOX", fetched: 0 },
    { folder: "ARCHIVE", fetched: 0 },
  ]);
});

test("inserts new messages, dedups, emits one event each, advances the folder cursor", async () => {
  mockFetchSince.mockResolvedValue({
    messages: [inbound({ externalMessageId: "<a>", subject: "A" }), inbound({ externalMessageId: "<b>", subject: "B" })],
    nextCursor: { uidvalidity: 10, last_uid: 7 },
  });
  threads.insertMessage
    .mockResolvedValueOnce({ email_message_id: "msg-a" })
    .mockResolvedValueOnce(null); // duplicate → ON CONFLICT DO NOTHING

  const res = await service.syncConnection(DB, "conn-1", { slug: "smartls" });

  expect(res).toMatchObject({ connection: "conn-1", fetched: 2, inserted: 1 });
  const kinds = mockEmitEvent.mock.calls.map((c) => c[1].eventTypeKey);
  expect(kinds.filter((k) => k === "email.thread.created" || k === "email.received")).toHaveLength(1);
  expect(threads.setFolderCursor).toHaveBeenCalledWith(DB, "fold-INBOX", { uidvalidity: 10, last_uid: 7 });
});

test("a message that starts a conversation is announced as a new thread", async () => {
  mockFetchSince.mockResolvedValue({ messages: [inbound()], nextCursor: null });
  threads.upsertThread.mockResolvedValue({ email_thread_id: "thr-new", message_count: 0 });

  await service.syncConnection(DB, "conn-1", {});

  expect(mockEmitEvent).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ eventTypeKey: "email.thread.created" }),
  );
});

test("a reply into an existing conversation is announced as a REPLY, not as a new thread", async () => {
  mockFetchSince.mockResolvedValue({
    messages: [inbound({ externalMessageId: "<r>", inReplyTo: "<a>", references: ["<a>"] })],
    nextCursor: null,
  });
  threads.upsertThread.mockResolvedValue({ email_thread_id: "thr-1", message_count: 2 });

  await service.syncConnection(DB, "conn-1", {});

  const kinds = mockEmitEvent.mock.calls.map((c) => c[1].eventTypeKey);
  /**
   * This asserted `email.received` until the third sweep.
   *
   * The branch emitted the pre-thread engine's message-grain key while the
   * other half of the same ternary emitted `email.thread.created` — so
   * `email.thread.replied`, seeded by 10735 and described as "a new message
   * joined an existing conversation", was emitted by nothing. Two keys for one
   * moment, and the one an administrator can pick in the rule builder was the
   * one that never fired.
   *
   * Now symmetric, both on the thread grain. `categoryFor` keys on the domain
   * (`email`), so notification routing and preferences are unchanged.
   */
  expect(kinds).toContain("email.thread.replied");
  expect(kinds).not.toContain("email.thread.created");
  // Threaded onto the conversation the References header names, not onto itself.
  expect(threads.upsertThread).toHaveBeenCalledWith(DB, expect.objectContaining({ thread_key: "<a>" }));
});

test("classifies the first inbound message of a conversation into a stream", async () => {
  // The SYSTEM verdicts are DATA, not code — migration 10734 seeds eight header
  // rules and an administrator can tune them. Only the known-party override is
  // hard-coded. So the rule has to be supplied here, exactly as the sync loop
  // reads it from email_stream_rule.
  threads.streamRules.mockResolvedValue([{
    email_stream_rule_id: "rule-1", match_kind: "HEADER_VALUE", match_key: "auto-submitted",
    match_value: "auto-(generated|replied)", stream: "SYSTEM", is_active: true,
    reason: "Carries Auto-Submitted, which RFC 3834 reserves for automated mail.",
  }]);
  mockFetchSince.mockResolvedValue({
    messages: [inbound({ from: "no-reply@cpanel.example", subject: "Backup complete", headers: { "auto-submitted": "auto-generated" } })],
    nextCursor: null,
  });

  await service.syncConnection(DB, "conn-1", {});

  expect(threads.updateThread).toHaveBeenCalledWith(
    DB, "thr-1", expect.objectContaining({ stream: "SYSTEM", stream_reason: expect.stringContaining("Auto-Submitted") }),
  );
});

test("a known party overrides the system verdict — a client's mail is never buried", async () => {
  // With this rule and no override the verdict would be SYSTEM. That is the
  // point: the override has to beat a rule that genuinely matches, or the test
  // proves nothing.
  threads.streamRules.mockResolvedValue([{
    email_stream_rule_id: "rule-1", match_kind: "HEADER_VALUE", match_key: "auto-submitted",
    match_value: "auto-(generated|replied)", stream: "SYSTEM", is_active: true,
    reason: "Carries Auto-Submitted, which RFC 3834 reserves for automated mail.",
  }]);
  threads.knownParty.mockResolvedValue({ kind: "client", id: "cli-1", name: "Acme", is_vip: true });
  mockFetchSince.mockResolvedValue({
    messages: [inbound({ from: "ops@acme.cm", headers: { "auto-submitted": "auto-generated" } })],
    nextCursor: null,
  });

  await service.syncConnection(DB, "conn-1", {});

  expect(threads.updateThread).toHaveBeenCalledWith(
    DB, "thr-1", expect.objectContaining({ stream: "HUMAN", is_vip: true }),
  );
});

test("persists attachments to the vault and links them to the MESSAGE", async () => {
  mockFetchSince.mockResolvedValue({
    messages: [inbound({
      externalMessageId: "<c>", subject: "C",
      attachments: [{ filename: "f.pdf", content_type: "application/pdf", content: Buffer.from("PDFDATA") }],
    })],
    nextCursor: { uidvalidity: 10, last_uid: 8 },
  });
  threads.insertMessage.mockResolvedValueOnce({ email_message_id: "msg-c" });

  const res = await service.syncConnection(DB, "conn-1", { slug: "smartls" });

  expect(res.attachments).toBe(1);
  expect(vault.createDocument).toHaveBeenCalledWith(
    DB,
    expect.objectContaining({ slug: "smartls", entityRef: "email_message:msg-c" }),
  );
  // `email_message_id`, not `email_inbound_id`. 10737 renamed the column and
  // the call sites were not updated, so this INSERT failed against the real
  // schema — inside the @silent:storage catch, which meant every inbound
  // attachment was written to the vault and then orphaned, in silence. This
  // assertion said `email_inbound_id`, so it agreed with the bug rather than
  // with the database, and `npm run db:check:columns` is what found it.
  expect(repo.addAttachment).toHaveBeenCalledWith(
    DB,
    expect.objectContaining({
      email_message_id: "msg-c", direction: "IN", vault_id: "vault-1", filename: "f.pdf",
    }),
  );
  // And the sha256 that lets the archive chain seal the attachment (§9.6).
  expect(repo.addAttachment.mock.calls[0][1].checksum_sha256).toMatch(/^[a-f0-9]{64}$/);
});

test("ingest writes a binding SUGGESTION, never entity_ref (Q18)", async () => {
  mockFetchSince.mockResolvedValue({
    messages: [inbound({ externalMessageId: "<d>", from: "client@acme.cm", subject: "Re: SLAS-2026-0001 shipment" })],
    nextCursor: null,
  });
  threads.insertMessage.mockResolvedValueOnce({ email_message_id: "msg-d" });

  await service.syncConnection(DB, "conn-1", {});

  expect(mockSuggest).toHaveBeenCalledWith(DB, expect.objectContaining({
    fromAddress: "client@acme.cm",
    subject: "Re: SLAS-2026-0001 shipment",
  }));
  expect(threads.updateThread).not.toHaveBeenCalledWith(
    DB, "thr-1", expect.objectContaining({ entity_ref: expect.anything() }),
  );
});

test("sanitizes the inbound HTML body before storing (stored-XSS guard)", async () => {
  mockFetchSince.mockResolvedValue({
    messages: [inbound({ externalMessageId: "<e>", subject: "E", bodyHtml: "<script>evil()</script><p>hi</p>", bodyText: "hi" })],
    nextCursor: null,
  });

  await service.syncConnection(DB, "conn-1", {});

  const row = threads.insertMessage.mock.calls[0][1];
  expect(row.body_html).toBe("SANITIZED:<script>evil()</script><p>hi</p>"); // passed through the sanitizer
});

test("stores the sender's original HTML beside the cleaned copy, stamped with the policy", async () => {
  mockFetchSince.mockResolvedValue({
    messages: [inbound({ externalMessageId: "<o>", bodyHtml: '<td style="background:#0b3d2e">Brief</td>' })],
    nextCursor: null,
  });

  await service.syncConnection(DB, "conn-1", {});

  const row = threads.insertMessage.mock.calls[0][1];
  // Never rendered; it is what the next sanitizer change re-runs over (14410).
  expect(row.body_html_original).toBe('<td style="background:#0b3d2e">Brief</td>');
  expect(row.body_policy).toBe(require("../../src/modules/mail/mail/body-html").BODY_POLICY);
});

test("the archive seals what ARRIVED: sender, subject and original body, not three ids from RETURNING", async () => {
  // The real hook, the real chain module, the real sync loop. The wiring test in
  // tests/security hands the hook a complete fixture; this is the path that
  // handed it `{ email_message_id, email_thread_id, received_at }` and sealed
  // every message with no sender and an empty body.
  const chain = require("../../src/modules/mail/triage/archive-chain");
  const spy = jest.spyOn(chain, "append");
  mockFetchSince.mockResolvedValue({
    messages: [inbound({
      externalMessageId: "<arc>", from: "lola@beautiful-fabrics.com", subject: "Build request",
      bodyHtml: '<p style="color:#c9a227">Hello</p>', bodyText: "Hello",
    })],
    nextCursor: null,
  });

  try {
    await service.syncConnection(DB, "conn-1", {});
    expect(spy).toHaveBeenCalledTimes(1);
    const sealed = spy.mock.calls[0][1];
    expect(sealed.headers.from).toBe("lola@beautiful-fabrics.com");
    expect(sealed.headers.subject).toBe("Build request");
    expect(sealed.body).toBe('<p style="color:#c9a227">Hello</p>\nHello');
  } finally {
    spy.mockRestore();
  }
});

test("an inline part is stored with its Content-ID; a repeated Content-ID stays a plain attachment", async () => {
  const png = Buffer.from("png");
  mockFetchSince.mockResolvedValue({
    messages: [inbound({
      externalMessageId: "<cid>",
      attachments: [
        { filename: "logo.png", content_type: "image/png", content: png, content_id: "logo@x", disposition: "inline" },
        { filename: "logo2.png", content_type: "image/png", content: png, content_id: "logo@x", disposition: "inline" },
        { filename: "b.pdf", content_type: "application/pdf", content: Buffer.from("pdf"), content_id: null, disposition: "attachment" },
      ],
    })],
    nextCursor: null,
  });

  await service.syncConnection(DB, "conn-1", { slug: "t" });

  const rows = repo.addAttachment.mock.calls.map((c) => c[1]);
  expect(rows[0]).toMatchObject({ content_id: "logo@x", disposition: "inline" });
  // ux_email_attachment_cid_message would refuse the repeat inside a silent
  // catch and the file would vanish; it is kept, unlinked from the cid.
  expect(rows[1]).toMatchObject({ content_id: null, disposition: "attachment" });
  expect(rows[2]).toMatchObject({ content_id: null, disposition: "attachment" });
});

test("one failing folder does not abort its siblings", async () => {
  threads.syncableFolders.mockResolvedValue([INBOX, ARCHIVE]);
  mockFetchSince
    .mockRejectedValueOnce(new Error("SELECT INBOX failed"))
    .mockResolvedValueOnce({ messages: [inbound({ externalMessageId: "<g>" })], nextCursor: { uidvalidity: 10, last_uid: 4 } });

  const res = await service.syncConnection(DB, "conn-1", {});

  expect(threads.setFolderError).toHaveBeenCalledWith(DB, "fold-INBOX", "SELECT INBOX failed");
  expect(res.inserted).toBe(1); // Archive still synced
  expect(res.folders).toEqual([
    { folder: "INBOX", error: "SELECT INBOX failed" },
    { folder: "ARCHIVE", fetched: 1 },
  ]);
  // A partial success is a success for the connection's health: the mailbox is
  // reachable, one folder is not.
  expect(res.error).toBeUndefined();
});

/*
 * A failed sync is COUNTED, and only the third in a row turns the mailbox to
 * ERROR (mailbox.repo `bumpFailure`). The loop also called `repo.setError`,
 * which set ERROR on the first one: one wobble at 17:36 read as "No mailbox
 * connected" in Compose until the next good poll. So these assert the count,
 * and that the immediate ERROR write is gone.
 */
const mailboxRepo = require("../../src/modules/mail/mail/mailbox.repo");

test("records the error on the connection and does not throw", async () => {
  mockFetchSince.mockRejectedValue(new Error("IMAP auth failed"));
  const res = await service.syncConnection(DB, "conn-1", {});
  expect(res.error).toBe("IMAP auth failed"); // every folder failed; surface it to Sync now
  expect(res.folders).toEqual([{ folder: "INBOX", error: "IMAP auth failed" }]);
  expect(mailboxRepo.bumpFailure).toHaveBeenCalledWith(DB, "conn-1", "IMAP auth failed");
  expect(repo.setError).not.toHaveBeenCalled();
});

test("a folder listing that fails stops the sync and records it on the connection", async () => {
  mockListFolders.mockRejectedValue(new Error("LIST refused"));
  const res = await service.syncConnection(DB, "conn-1", {});
  expect(res.error).toBe("LIST refused");
  expect(mailboxRepo.bumpFailure).toHaveBeenCalledWith(DB, "conn-1", "LIST refused");
  expect(repo.setError).not.toHaveBeenCalled();
  expect(mockFetchSince).not.toHaveBeenCalled();
});

test("the third failure in a row raises the health event; the first does not", async () => {
  mockFetchSince.mockRejectedValue(new Error("token refused"));
  await service.syncConnection(DB, "conn-1", {});
  expect(mockEmitEvent.mock.calls.map((c) => c[1].eventTypeKey)).not.toContain("mailbox.health.failed");

  mailboxRepo.bumpFailure.mockResolvedValueOnce({ consecutive_failures: 3, status: "ERROR" });
  await service.syncConnection(DB, "conn-1", {});
  expect(mockEmitEvent).toHaveBeenCalledWith(DB, expect.objectContaining({
    eventTypeKey: "mailbox.health.failed",
    payload: expect.objectContaining({ error: "token refused", failures: 3 }),
  }));
});

/*
 * WHY THIS ASSERTS 422 AND NOT THE 502 IT USED TO.
 *
 * Two implementations of this mapping landed within days of each other:
 * `mapSmtpError` (#160) called a rejected sender a 502 SMTP_SENDER_REJECTED,
 * and `explainSendError` called it a 422 SENDER_NOT_AUTHORIZED. Only the
 * second was wired to `send`, so this test (which used to assert the 502
 * contract) went red on main. Both paths now share the 422 classifier —
 * Test / system-email / platform probe included — because a mail server
 * refusing your FROM address is a mailbox-config verdict, not a Praxis 5xx.
 */
test("send maps a '550 Sender verify failed' SMTP rejection to an actionable 422 AppError", async () => {
  const smtpErr = Object.assign(
    new Error(
      "Can't send mail - all recipients were rejected: 550 Sender verify failed",
    ),
    {
      responseCode: 550,
      response: "550 Sender verify failed",
      code: "EENVELOPE",
    },
  );
  mockSendEmail.mockRejectedValueOnce(smtpErr);

  await expect(
    service.send(DB, { connectionId: "conn-1", to: "x@y.cm", subject: "hi" }),
  ).rejects.toMatchObject({
    name: "AppError",
    code: "SENDER_NOT_AUTHORIZED",
    status: 422,
  });
  // The failed send must not be recorded as an outbound thread copy.
  expect(threads.insertMessage).not.toHaveBeenCalled();
});

test("send maps 550 user-unknown to RECIPIENT_REJECTED, not sender-auth", async () => {
  const smtpErr = Object.assign(new Error("550 5.1.1 User unknown"), {
    responseCode: 550,
    response: "550 5.1.1 User unknown",
    code: "EENVELOPE",
  });
  mockSendEmail.mockRejectedValueOnce(smtpErr);
  await expect(
    service.send(DB, { connectionId: "conn-1", to: "nobody@x.cm", subject: "hi" }),
  ).rejects.toMatchObject({ name: "AppError", code: "RECIPIENT_REJECTED", status: 422 });
  expect(threads.insertMessage).not.toHaveBeenCalled();
});

test("markRead propagates to the server adapter and flips the local row (G-3)", async () => {
  threads.getMessage.mockResolvedValue({
    email_message_id: "msg-1",
    email_thread_id: "thr-1",
    email_connection_id: "conn-1",
    external_message_id: "<mid>",
  });
  repo.getConnection.mockResolvedValue({ ...CONN, status: "CONNECTED" });

  const res = await service.markRead(DB, "msg-1", "user-1");

  expect(mockMarkAsRead).toHaveBeenCalledWith("<mid>");
  // Read state is PER USER and PER CONVERSATION now. A markRead that does not
  // carry a user id is the bug the whole model change exists to remove.
  expect(threads.setThreadRead).toHaveBeenCalledWith(DB, "user-1", "thr-1", true);
  expect(res).toMatchObject({ email_message_id: "msg-1", is_read: true });
});

test("markRead still flips the local row when server propagation fails", async () => {
  threads.getMessage.mockResolvedValue({
    email_message_id: "msg-2",
    email_thread_id: "thr-2",
    email_connection_id: "conn-1",
    external_message_id: "<mid>",
  });
  repo.getConnection.mockResolvedValue({ ...CONN, status: "CONNECTED" });
  mockMarkAsRead.mockRejectedValueOnce(new Error("provider down"));

  const res = await service.markRead(DB, "msg-2", "user-1");

  expect(threads.setThreadRead).toHaveBeenCalledWith(DB, "user-1", "thr-2", true);
  expect(res).toMatchObject({ email_message_id: "msg-2", is_read: true });
});

test("linkEntity binds the CONVERSATION, not the one message it was called on", async () => {
  threads.getMessage.mockResolvedValue({ email_message_id: "msg-9", email_thread_id: "thr-9" });
  const res = await service.linkEntity(DB, { inboundId: "msg-9", entity_ref: "dossier:dos-2" });
  expect(threads.updateThread).toHaveBeenCalledWith(DB, "thr-9", { entity_ref: "dossier:dos-2" });
  expect(res).toEqual({ email_thread_id: "thr-9", entity_ref: "dossier:dos-2" });
});

/* ── 14420: what the engine does with a server that says where mail is ────────
 *
 * The same IMAP mock, given the two methods a Microsoft or Google adapter has:
 * `locateMessage` (its promise that a message is in one folder at a time and
 * keeps its id when it moves) and, for Microsoft, `translateIds`.
 */
const { ImapSmtpProvider } = require("../../src/modules/mail/mail/providers/imapSmtp.provider");
const mailNotify = require("../../src/modules/mail/mail/mail-notify.service");
const mockLocate = jest.fn();
const mockTranslate = jest.fn();
const followingAdapter = (extra = {}) => ({
  fetchSince: mockFetchSince, listFolders: mockListFolders, verify: mockVerify,
  markAsRead: mockMarkAsRead, sendEmail: mockSendEmail,
  capabilities: () => ({ folders: true, folderMove: true, serverFlags: true }),
  locateMessage: mockLocate,
  ...extra,
});

describe("a server that says where its mail is", () => {
  beforeEach(() => {
    ImapSmtpProvider.mockImplementation(() => followingAdapter());
    jest.spyOn(mailNotify, "onInboundMessage").mockResolvedValue(undefined);
  });
  afterAll(() => {
    ImapSmtpProvider.mockImplementation(() => followingAdapter({ locateMessage: undefined }));
  });

  test("a stored message seen in another folder is moved there, not stored twice", async () => {
    threads.syncableFolders.mockResolvedValue([ARCHIVE]);
    threads.findMessageByExternal.mockResolvedValueOnce({
      email_message_id: "msg-1", email_thread_id: "thr-1", folder: "INBOX", provider_folder: "INBOX", direction: "IN",
    });
    mockFetchSince.mockResolvedValue({ messages: [inbound({ externalMessageId: "<a>", isRead: true })], nextCursor: {} });

    const res = await service.syncConnection(DB, "conn-1", {});

    expect(res.inserted).toBe(0);
    expect(threads.insertMessage).not.toHaveBeenCalled();
    expect(threads.upsertThread).not.toHaveBeenCalled(); // no empty conversation left behind
    expect(threads.relocateMessage).toHaveBeenCalledWith(DB, "msg-1", expect.objectContaining({
      // direction null: a message keeps IN or OUT when it is archived.
      folder: "ARCHIVE", providerPath: "Archive", direction: null, refresh: null,
    }));
    // Gmail and Microsoft-after-14420 have no legacy ids to look for.
    expect(threads.adoptLegacyCopy).not.toHaveBeenCalled();
    // Read in Outlook is read here, for the owner of a personal mailbox.
    expect(threads.markReadForOwner).toHaveBeenCalledWith(DB, "msg-1", "conn-1");
  });

  test("IMAP is NOT followed: a Message-ID can sit in two folders at once", async () => {
    ImapSmtpProvider.mockImplementation(() => followingAdapter({ locateMessage: undefined }));
    threads.syncableFolders.mockResolvedValue([ARCHIVE]);
    threads.findMessageByExternal.mockResolvedValueOnce({
      email_message_id: "msg-1", folder: "INBOX", provider_folder: "INBOX", direction: "IN",
    });
    mockFetchSince.mockResolvedValue({ messages: [inbound({ externalMessageId: "<a>" })], nextCursor: {} });

    await service.syncConnection(DB, "conn-1", {});

    expect(threads.relocateMessage).not.toHaveBeenCalled();
    expect(threads.insertMessage).not.toHaveBeenCalled();
  });

  test("a draft that has since been sent takes the sent content with it", async () => {
    const SENT = { ...INBOX, email_folder_id: "fold-SENT", canonical: "SENT", provider_path: "SentItems" };
    threads.syncableFolders.mockResolvedValue([SENT]);
    threads.findMessageByExternal.mockResolvedValueOnce({
      email_message_id: "msg-d", email_thread_id: "thr-d", folder: "DRAFTS", provider_folder: "Drafts", direction: "OUT",
    });
    mockFetchSince.mockResolvedValue({
      messages: [inbound({ externalMessageId: "<d>", subject: "Final", bodyText: "as sent" })], nextCursor: {},
    });

    await service.syncConnection(DB, "conn-1", {});

    expect(threads.relocateMessage).toHaveBeenCalledWith(DB, "msg-d", expect.objectContaining({
      folder: "SENT", direction: "OUT",
      refresh: expect.objectContaining({ subject: "Final", body_text: "as sent" }),
    }));
  });

  test("Gmail's mailbox-wide history: each message goes where its labels say", async () => {
    threads.syncableFolders.mockResolvedValue([INBOX]);
    mockFetchSince.mockResolvedValue({
      messages: [inbound({ externalMessageId: "g1", folder: "SPAM", providerPath: "SPAM" })], nextCursor: {},
    });

    await service.syncConnection(DB, "conn-1", {});

    expect(threads.insertMessage).toHaveBeenCalledWith(DB, expect.objectContaining({ folder: "SPAM", provider_folder: "SPAM" }));
    // Junk is not news.
    expect(mailNotify.onInboundMessage).not.toHaveBeenCalled();
  });

  test("a message that left a folder for one Praxis does not sync is followed after the sync", async () => {
    threads.syncableFolders.mockResolvedValue([INBOX]);
    mockFetchSince.mockResolvedValue({ messages: [], nextCursor: {}, removed: [{ externalMessageId: "<a>", fromPath: "INBOX" }] });
    threads.findMessageByExternal.mockResolvedValueOnce({ email_message_id: "msg-1", folder: "INBOX", provider_folder: "INBOX" });
    threads.foldersByPath.mockResolvedValueOnce(new Map([["U1", { provider_path: "U1", canonical: null }]]));
    mockLocate.mockResolvedValueOnce({ path: "U1" });

    await service.syncConnection(DB, "conn-1", {});

    expect(mockLocate).toHaveBeenCalledWith("<a>");
    expect(threads.relocateMessage).toHaveBeenCalledWith(DB, "msg-1", { folder: "ARCHIVE", providerPath: "U1" });
  });

  test("one the server no longer has goes to Trash, never deleted", async () => {
    threads.syncableFolders.mockResolvedValue([INBOX]);
    mockFetchSince.mockResolvedValue({ messages: [], nextCursor: {}, removed: [{ externalMessageId: "<a>", fromPath: null }] });
    threads.findMessageByExternal.mockResolvedValueOnce({ email_message_id: "msg-1", folder: "INBOX", provider_folder: "INBOX" });
    mockLocate.mockResolvedValueOnce(null);

    await service.syncConnection(DB, "conn-1", {});

    expect(threads.relocateMessage).toHaveBeenCalledWith(DB, "msg-1", { folder: "TRASH", providerPath: null });
  });

  test("one another folder already claimed this sync costs no call", async () => {
    threads.syncableFolders.mockResolvedValue([INBOX]);
    mockFetchSince.mockResolvedValue({ messages: [], nextCursor: {}, removed: [{ externalMessageId: "<a>", fromPath: "INBOX" }] });
    threads.findMessageByExternal.mockResolvedValueOnce({ email_message_id: "msg-1", folder: "ARCHIVE", provider_folder: "Archive" });

    await service.syncConnection(DB, "conn-1", {});

    expect(mockLocate).not.toHaveBeenCalled();
  });

  test("Microsoft ids are translated once, before the first immutable sync", async () => {
    ImapSmtpProvider.mockImplementation(() => followingAdapter({ translateIds: mockTranslate }));
    threads.externalIdsFor.mockResolvedValueOnce(["old-1", "old-2"]);
    mockTranslate.mockResolvedValueOnce(new Map([["old-1", "IMM-1"]]));

    await service.syncConnection(DB, "conn-1", {});

    expect(threads.translateExternalIds).toHaveBeenCalledWith(DB, "conn-1", [["old-1", "IMM-1"]]);
    expect(repo.updateConnection).toHaveBeenCalledWith(DB, "conn-1", { provider_id_scheme: "immutable" });

    // And never again.
    jest.clearAllMocks();
    repo.getConnection.mockResolvedValue({ ...CONN, provider_id_scheme: "immutable" });
    threads.syncableFolders.mockResolvedValue([INBOX]);
    mockFetchSince.mockResolvedValue({ messages: [], nextCursor: null });
    mockListFolders.mockResolvedValue([]);
    await service.syncConnection(DB, "conn-1", {});
    expect(mockTranslate).not.toHaveBeenCalled();
  });
});

describe("whatever the provider", () => {
  test("the server's copy of a message Praxis sent adopts Praxis's row", async () => {
    const SENT = { ...INBOX, email_folder_id: "fold-SENT", canonical: "SENT", provider_path: "Sent Messages" };
    threads.syncableFolders.mockResolvedValue([SENT]);
    threads.adoptLocalSend.mockResolvedValueOnce({ email_message_id: "local-1" });
    mockFetchSince.mockResolvedValue({
      messages: [inbound({ externalMessageId: "srv-1", messageIdHeader: "<p@co.cm>", to: ["Client@X.cm"] })], nextCursor: {},
    });

    const res = await service.syncConnection(DB, "conn-1", {});

    expect(threads.adoptLocalSend).toHaveBeenCalledWith(DB, "conn-1", expect.objectContaining({
      externalMessageId: "srv-1", messageIdHeader: "<p@co.cm>", to: ["client@x.cm"], providerPath: "Sent Messages",
    }));
    expect(threads.insertMessage).not.toHaveBeenCalled();
    expect(res.inserted).toBe(0);
  });

  test("anything in Sent or Drafts is ours, whatever the adapter guessed", async () => {
    // "Éléments envoyés" never matched the IMAP adapter's name test.
    const SENT = { ...INBOX, email_folder_id: "fold-SENT", canonical: "SENT", provider_path: "Éléments envoyés" };
    threads.syncableFolders.mockResolvedValue([SENT]);
    mockFetchSince.mockResolvedValue({ messages: [inbound({ direction: "IN" })], nextCursor: {} });
    await service.syncConnection(DB, "conn-1", {});
    expect(threads.insertMessage).toHaveBeenCalledWith(DB, expect.objectContaining({ direction: "OUT", folder: "SENT" }));
  });

  test("mail the server says was read arrives read", async () => {
    mockFetchSince.mockResolvedValue({ messages: [inbound({ isRead: true }), inbound({ externalMessageId: "<b>" })], nextCursor: {} });
    threads.insertMessage.mockResolvedValueOnce({ email_message_id: "m-read" }).mockResolvedValueOnce({ email_message_id: "m-new" });
    await service.syncConnection(DB, "conn-1", {});
    expect(threads.seedStateForMembers).toHaveBeenCalledWith(DB, "m-read", "conn-1", { isRead: true });
    expect(threads.seedStateForMembers).toHaveBeenCalledWith(DB, "m-new", "conn-1", { isRead: false });
  });

  test("a folder still on its first read keeps the backfill narrowing for extraction", async () => {
    const ocr = require("../../src/modules/mail/assist/ocr.enqueue");
    const spy = jest.spyOn(ocr, "forMessage").mockResolvedValue({ queued: 0 });
    threads.syncableFolders.mockResolvedValue([{ ...INBOX, last_sync_at: "2026-10-15T10:00:00Z", sync_cursor: { v: 2, backfill: true } }]);
    mockFetchSince.mockResolvedValue({
      messages: [inbound({ attachments: [{ filename: "f.pdf", content_type: "application/pdf", content: Buffer.from("x") }] })],
      nextCursor: {},
    });
    await service.syncConnection(DB, "conn-1", {});
    expect(spy).toHaveBeenCalledWith(DB, expect.objectContaining({ isFirstSync: true }));
    spy.mockRestore();
  });
});
