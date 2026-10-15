/**
 * MicrosoftGraphProvider unit tests — hermetic (axios mocked, no network).
 * Covers capabilities, Graph→NormalizedEmail mapping, delta paging + cursor, and
 * the create-reply sequence. See doc/EMAIL_ENGINE_PLAN.md Phase 2.
 */
"use strict";

jest.mock("axios");
const axios = require("axios");
const {
  MicrosoftGraphProvider,
} = require("../../src/modules/mail/mail/providers/microsoftGraph.provider");

const provider = () =>
  new MicrosoftGraphProvider({ getAccessToken: async () => "access-tok" });

beforeEach(() => jest.clearAllMocks());

test("capabilities: push + delta + server threads, and NOT appendSent (Graph files Sent)", () => {
  const caps = provider().capabilities();
  expect(caps).toMatchObject({
    push: true,
    delta: true,
    serverThreads: true,
    appendSent: false,
  });
});

test("_normalize maps a Graph message and uses conversationId as threadKey", () => {
  const n = provider()._normalize({
    id: "AAMk-1",
    conversationId: "conv-9",
    internetMessageId: "<x@ms>",
    subject: "Hello",
    from: { emailAddress: { address: "sender@ext.com" } },
    toRecipients: [{ emailAddress: { address: "me@co.cm" } }],
    body: { contentType: "HTML", content: "<p>hi</p>" },
    receivedDateTime: "2026-08-01T09:00:00Z",
    isRead: false,
  });
  expect(n.externalMessageId).toBe("AAMk-1");
  expect(n.threadKey).toBe("conv-9");
  expect(n.from).toBe("sender@ext.com");
  expect(n.to).toEqual(["me@co.cm"]);
  expect(n.bodyHtml).toBe("<p>hi</p>");
  expect(n.direction).toBe("IN");
});

test("fetchSince follows nextLink then persists the deltaLink as the cursor", async () => {
  axios
    .mockResolvedValueOnce({
      data: {
        value: [
          {
            id: "m1",
            conversationId: "c1",
            body: { contentType: "Text", content: "1" },
          },
        ],
        "@odata.nextLink": "https://graph/next",
      },
    })
    .mockResolvedValueOnce({
      data: {
        value: [
          {
            id: "m2",
            conversationId: "c2",
            body: { contentType: "Text", content: "2" },
          },
        ],
        "@odata.deltaLink": "https://graph/delta-NEXT",
      },
    });

  const { messages, nextCursor } = await provider().fetchSince(null, "inbox-id");

  expect(messages.map((m) => m.externalMessageId)).toEqual(["m1", "m2"]);
  expect(nextCursor).toEqual({ v: 2, delta_link: "https://graph/delta-NEXT" });
  expect(axios).toHaveBeenCalledTimes(2);
  // The folder it was asked for, not always the inbox.
  expect(axios.mock.calls[0][0].url).toContain("/me/mailFolders/inbox-id/messages/delta");
});

/* ── 14420: every folder, immutable ids, resumable ───────────────────────── */

const page = (value, more = {}) => ({ data: { value, ...more } });
const msg = (id, over = {}) => ({ id, conversationId: `c-${id}`, body: { contentType: "Text", content: id }, ...over });

test("every request asks for immutable ids", async () => {
  axios.mockResolvedValueOnce(page([], { "@odata.deltaLink": "https://graph/d" }));
  await provider().fetchSince(null, "f1");
  expect(axios.mock.calls[0][0].headers.Prefer).toMatch(/IdType="ImmutableId"/);
  expect(axios.mock.calls[0][0].headers.Prefer).toMatch(/odata\.maxpagesize=50/);
});

test("a first read stops after its page budget and resumes from the link it stopped at", async () => {
  for (let i = 0; i < 10; i += 1) axios.mockResolvedValueOnce(page([msg(`m${i}`)], { "@odata.nextLink": `https://graph/next-${i}` }));
  const first = await provider().fetchSince(null, "f1");
  expect(first.messages).toHaveLength(10);
  expect(first.more).toBe(true);
  expect(first.nextCursor).toMatchObject({ v: 2, next_link: "https://graph/next-9", delta_link: null, backfill: true });

  jest.clearAllMocks();
  axios
    .mockResolvedValueOnce(page([msg("new")])) // mail that arrived since the read began
    .mockResolvedValueOnce(page([msg("m10")], { "@odata.deltaLink": "https://graph/d" }));
  const second = await provider().fetchSince(first.nextCursor, "f1");
  expect(axios.mock.calls[0][0].url).toContain("/me/mailFolders/f1/messages?");
  expect(axios.mock.calls[0][0].url).toMatch(/\$filter=receivedDateTime%20ge%20\d{4}-/);
  expect(axios.mock.calls[0][0].url).toContain("$orderby=receivedDateTime%20desc");
  expect(axios.mock.calls[1][0].url).toBe("https://graph/next-9");
  expect(second.messages.map((m) => m.externalMessageId)).toEqual(["new", "m10"]);
  expect(second.nextCursor).toEqual({ v: 2, delta_link: "https://graph/d" });
});

test("a cursor from the inbox-only adapter is not resumed: its ids were the mutable kind", async () => {
  axios.mockResolvedValueOnce(page([], { "@odata.deltaLink": "https://graph/d" }));
  await provider().fetchSince({ delta_link: "https://graph/old" }, "f1");
  expect(axios.mock.calls[0][0].url).toContain("/me/mailFolders/f1/messages/delta");
});

test("a 410 reads the folder again from the top, once", async () => {
  axios
    .mockRejectedValueOnce({ response: { status: 410, data: { error: { code: "SyncStateNotFound" } } } })
    .mockResolvedValueOnce(page([msg("m1")], { "@odata.deltaLink": "https://graph/d2" }));
  const out = await provider().fetchSince({ v: 2, delta_link: "https://graph/stale" }, "f1");
  expect(axios.mock.calls[1][0].url).toContain("/me/mailFolders/f1/messages/delta");
  expect(out.nextCursor).toEqual({ v: 2, delta_link: "https://graph/d2" });
});

test("a message that left the folder comes back as removed from it", async () => {
  axios.mockResolvedValueOnce(page([{ id: "gone", "@removed": { reason: "deleted" } }], { "@odata.deltaLink": "https://graph/d" }));
  const { removed, messages } = await provider().fetchSince({ v: 2, delta_link: "https://graph/x" }, "f1");
  expect(messages).toEqual([]);
  expect(removed).toEqual([{ externalMessageId: "gone", fromPath: "f1" }]);
});

test("listFolders: the six by Microsoft's well-known names, the user's own beside them, no Outbox", async () => {
  axios
    .mockResolvedValueOnce({
      data: {
        responses: [
          { id: "0", status: 200, body: { id: "IN", displayName: "Boîte de réception" } },
          { id: "1", status: 200, body: { id: "SE", displayName: "Éléments envoyés" } },
          { id: "4", status: 404, body: { error: { code: "ErrorFolderNotFound" } } }, // no Archive
          { id: "6", status: 200, body: { id: "OUT", displayName: "Boîte d'envoi" } },
        ],
      },
    })
    .mockResolvedValueOnce(page([
      { id: "IN", displayName: "Boîte de réception" }, { id: "SE", displayName: "Éléments envoyés" },
      { id: "OUT", displayName: "Boîte d'envoi" }, { id: "U1", displayName: "Clients" },
    ]));
  const list = await provider().listFolders();
  expect(axios.mock.calls[0][0]).toMatchObject({ method: "POST", url: expect.stringContaining("/$batch") });
  expect(list).toEqual([
    { path: "IN", name: "Boîte de réception", displayName: "Boîte de réception", flags: ["\\inbox"] },
    { path: "SE", name: "Éléments envoyés", displayName: "Éléments envoyés", flags: ["\\sent"] },
    { path: "U1", name: "Clients", displayName: "Clients", flags: [] },
  ]);

  // And folders.js reads them the way it reads IMAP's.
  const { mapFolders } = require("../../src/modules/mail/mail/folders");
  const rows = mapFolders(list);
  expect(rows.map((r) => [r.canonical, r.display_name, r.is_syncable])).toEqual([
    ["INBOX", "Boîte de réception", true],
    ["SENT", "Éléments envoyés", true],
    [null, "Clients", false],
  ]);
});

test("capabilities: folders, moves, read state and delete are all on", () => {
  expect(provider().capabilities()).toMatchObject({ folders: true, folderMove: true, serverFlags: true, serverDelete: true });
});

test("move hands back the id Graph returns; delete is for good, and gone is a success", async () => {
  axios.mockResolvedValueOnce({ data: { id: "same-id" } });
  expect(await provider().moveMessage("same-id", "ARCH")).toEqual({ moved: true, externalMessageId: "same-id" });
  expect(axios.mock.calls[0][0]).toMatchObject({ url: expect.stringContaining("/me/messages/same-id/move"), data: { destinationId: "ARCH" } });

  axios.mockResolvedValueOnce({ data: {} });
  expect(await provider().deleteMessage("m1")).toEqual({ deleted: true });
  expect(axios.mock.calls[1][0].url).toContain("/me/messages/m1/permanentDelete");
  axios.mockRejectedValueOnce({ response: { status: 404 } });
  expect(await provider().deleteMessage("m2")).toEqual({ deleted: false });
});

test("locateMessage gives the folder, or null when the mailbox no longer has it", async () => {
  axios.mockResolvedValueOnce({ data: { id: "m1", parentFolderId: "ARCH" } });
  expect(await provider().locateMessage("m1")).toEqual({ path: "ARCH" });
  axios.mockRejectedValueOnce({ response: { status: 404 } });
  expect(await provider().locateMessage("m2")).toBeNull();
});

test("translateIds maps stored ids to immutable ones, in batches", async () => {
  axios.mockResolvedValueOnce({ data: { value: [{ sourceId: "a", targetId: "A" }, { sourceId: "b" }] } });
  const map = await provider().translateIds(["a", "b"]);
  expect([...map.entries()]).toEqual([["a", "A"]]);
  expect(axios.mock.calls[0][0].data).toEqual({ inputIds: ["a", "b"], sourceIdType: "restId", targetIdType: "restImmutableEntryId" });
});

test("the subscription watches every message; an Inbox-only one is replaced at renewal", async () => {
  axios.mockResolvedValueOnce({ data: { id: "sub-1", expirationDateTime: "2026-10-18T00:00:00Z" } });
  await provider().subscribe({ notificationUrl: "https://t/hook", clientState: "conn-1" });
  expect(axios.mock.calls[0][0].data).toMatchObject({ resource: "me/messages", changeType: "created,updated,deleted" });

  jest.clearAllMocks();
  axios
    .mockResolvedValueOnce({ data: { id: "old", resource: "me/mailFolders('Inbox')/messages", notificationUrl: "https://t/hook" } })
    .mockResolvedValueOnce({ data: { id: "new", expirationDateTime: "2026-10-18T00:00:00Z" } })
    .mockResolvedValueOnce({ data: {} });
  const r = await provider().renewSubscription("old", { clientState: "conn-1" });
  expect(r).toEqual({ subscriptionId: "new", expiresAt: "2026-10-18T00:00:00Z" });
  expect(axios.mock.calls[1][0].data).toMatchObject({ resource: "me/messages", clientState: "conn-1", notificationUrl: "https://t/hook" });
  expect(axios.mock.calls[2][0]).toMatchObject({ method: "DELETE", url: expect.stringContaining("/subscriptions/old") });
});

test("the sender's name, and not the address printed twice", () => {
  const p = provider();
  expect(p._normalize(msg("1", { from: { emailAddress: { address: "a@lau.com", name: "Angela Lau" } } })).fromName).toBe("Angela Lau");
  expect(p._normalize(msg("1", { from: { emailAddress: { address: "a@lau.com", name: "a@lau.com" } } })).fromName).toBeNull();
  expect(p._normalize(msg("1", { internetMessageId: "<x@ms>" })).messageIdHeader).toBe("<x@ms>");
});

test("fetchSince hydrates file attachments when hasAttachments is set", async () => {
  axios
    .mockResolvedValueOnce({
      data: {
        value: [
          {
            id: "m1",
            conversationId: "c1",
            hasAttachments: true,
            body: { contentType: "Text", content: "hi" },
          },
        ],
        "@odata.deltaLink": "https://graph/delta",
      },
    })
    .mockResolvedValueOnce({
      data: {
        value: [
          {
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: "f.pdf",
            contentType: "application/pdf",
            size: 3,
            contentBytes: Buffer.from("abc").toString("base64"),
          },
        ],
      },
    });

  const { messages } = await provider().fetchSince(null, "f1");

  expect(messages[0].attachments).toHaveLength(1);
  expect(messages[0].attachments[0]).toMatchObject({
    filename: "f.pdf",
    content_type: "application/pdf",
  });
  expect(messages[0].attachments[0].content.toString()).toBe("abc");
  expect(axios).toHaveBeenCalledTimes(2); // delta + attachments
});

test("createReply: createReply → patch body → send, returns new id + conversation", async () => {
  axios
    .mockResolvedValueOnce({
      data: { id: "draft-1", conversationId: "conv-1" },
    }) // createReply
    .mockResolvedValueOnce({ data: {} }) // PATCH body
    .mockResolvedValueOnce({ data: {} }); // send

  const res = await provider().createReply("orig-id", { bodyText: "thanks" });

  expect(res).toEqual({ externalMessageId: "draft-1", threadKey: "conv-1" });
  expect(axios).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      method: "POST",
      url: expect.stringContaining("/me/messages/orig-id/createReply"),
    }),
  );
  expect(axios).toHaveBeenNthCalledWith(
    3,
    expect.objectContaining({
      method: "POST",
      url: expect.stringContaining("/me/messages/draft-1/send"),
    }),
  );
});

test("an inline file attachment keeps its contentId and is marked inline", async () => {
  axios
    .mockResolvedValueOnce({
      data: {
        value: [{ id: "m2", conversationId: "c2", hasAttachments: true, body: { contentType: "HTML", content: '<img src="cid:image001.png@01DB">' } }],
        "@odata.deltaLink": "https://graph/delta",
      },
    })
    .mockResolvedValueOnce({
      data: {
        value: [{
          "@odata.type": "#microsoft.graph.fileAttachment", name: "image001.png", contentType: "image/png",
          size: 3, isInline: true, contentId: "image001.png@01DB", contentBytes: Buffer.from("png").toString("base64"),
        }],
      },
    });

  const { messages } = await provider().fetchSince(null);

  expect(messages[0].attachments[0]).toMatchObject({ content_id: "image001.png@01DB", disposition: "inline" });
});

test("getRawMessage reads $value as bytes", async () => {
  axios.mockResolvedValueOnce({ data: Buffer.from("From: a@b\r\n\r\nhi") });
  const raw = await provider().getRawMessage("m9");
  expect(raw.toString()).toBe("From: a@b\r\n\r\nhi");
  expect(axios.mock.calls.at(-1)[0]).toMatchObject({ url: expect.stringContaining("/me/messages/m9/$value"), responseType: "arraybuffer" });
});
