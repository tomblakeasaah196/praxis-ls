/**
 * GmailProvider unit tests — hermetic (axios mocked, no network). Covers
 * capabilities, Gmail payload → NormalizedEmail (base64url body decode, header
 * parsing), and the history-delta fetch + cursor. See EMAIL_ENGINE_PLAN Phase 2.
 */
"use strict";

jest.mock("axios");
const axios = require("axios");
const {
  GmailProvider,
} = require("../../src/modules/mail/mail/providers/gmail.provider");

const provider = () =>
  new GmailProvider({
    getAccessToken: async () => "tok",
    emailAddress: "me@co.cm",
  });

const b64url = (s) =>
  Buffer.from(s)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const B64_TEXT = b64url("hello");
const B64_HTML = b64url("<p>hi</p>");

const GMSG = {
  id: "m1",
  threadId: "t1",
  labelIds: ["INBOX", "UNREAD"],
  internalDate: "1754040000000",
  snippet: "hi",
  payload: {
    mimeType: "multipart/alternative",
    headers: [
      { name: "From", value: "Sender <sender@ext.com>" },
      { name: "To", value: "me@co.cm" },
      { name: "Subject", value: "Hey" },
      { name: "Message-ID", value: "<mid@ext>" },
    ],
    parts: [
      { mimeType: "text/plain", body: { data: B64_TEXT } },
      { mimeType: "text/html", body: { data: B64_HTML } },
    ],
  },
};

beforeEach(() => jest.clearAllMocks());

test("capabilities: delta + server threads, no push, no appendSent (Gmail files Sent)", () => {
  expect(provider().capabilities()).toMatchObject({
    push: false,
    delta: true,
    serverThreads: true,
    appendSent: false,
  });
});

test("_normalize decodes base64url bodies and parses headers; threadKey = threadId", () => {
  const n = provider()._normalize(GMSG);
  expect(n.externalMessageId).toBe("m1");
  expect(n.threadKey).toBe("t1");
  expect(n.from).toBe("sender@ext.com");
  expect(n.to).toEqual(["me@co.cm"]);
  expect(n.subject).toBe("Hey");
  expect(n.bodyText).toBe("hello");
  expect(n.bodyHtml).toBe("<p>hi</p>");
  expect(n.isRead).toBe(false); // UNREAD present
});

test("fetchSince(history) reads the mailbox-wide history on INBOX and advances the cursor", async () => {
  axios
    .mockResolvedValueOnce({
      data: {
        history: [{ id: "990", messagesAdded: [{ message: { id: "m1" } }] }],
        historyId: "999",
      },
    }) // /history
    .mockResolvedValueOnce({ data: GMSG }); // /messages/m1

  const { messages, nextCursor } = await provider().fetchSince(
    { v: 2, history_id: "100", page_token: null, backfill: false }, "INBOX",
  );

  expect(messages.map((m) => m.externalMessageId)).toEqual(["m1"]);
  expect(messages[0]).toMatchObject({ folder: "INBOX", providerPath: "INBOX" });
  expect(nextCursor).toEqual({ v: 2, history_id: "999", page_token: null, backfill: false });
  // No label filter: one history for every folder, not six.
  expect(axios.mock.calls[0][0].params).toMatchObject({ startHistoryId: "100" });
  expect(axios.mock.calls[0][0].params.labelId).toBeUndefined();
  expect(axios.mock.calls[0][0].params.historyTypes).toEqual(["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"]);
});

test("getMessage hydrates attachment bytes from the attachmentId ref", async () => {
  const withAtt = {
    id: "m2",
    threadId: "t2",
    labelIds: ["INBOX"],
    internalDate: "1754040000000",
    snippet: "doc",
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "From", value: "s@ext.com" },
        { name: "Subject", value: "Doc" },
      ],
      parts: [
        { mimeType: "text/plain", body: { data: B64_TEXT } },
        {
          mimeType: "application/pdf",
          filename: "f.pdf",
          body: { attachmentId: "att1", size: 3 },
        },
      ],
    },
  };
  axios
    .mockResolvedValueOnce({ data: withAtt }) // /messages/m2 full
    .mockResolvedValueOnce({ data: { data: b64url("PDF") } }); // /messages/m2/attachments/att1

  const n = await provider().getMessage("m2");

  expect(n.attachments).toHaveLength(1);
  expect(n.attachments[0]).toMatchObject({
    filename: "f.pdf",
    content_type: "application/pdf",
  });
  expect(n.attachments[0].content.toString()).toBe("PDF");
});

test("fetchSince(no cursor) anchors on the profile, then reads the folder in resumable pages", async () => {
  axios
    .mockResolvedValueOnce({ data: { emailAddress: "me@co.cm", historyId: "555" } }) // /profile
    .mockResolvedValueOnce({ data: { messages: [{ id: "m1" }], nextPageToken: "p2" } }) // page 1
    .mockResolvedValueOnce({ data: { messages: [], nextPageToken: "p3" } }) // page 2
    .mockResolvedValueOnce({ data: { messages: [], nextPageToken: "p4" } }) // page 3: budget spent
    .mockResolvedValueOnce({ data: GMSG }); // /messages/m1

  const { messages, nextCursor, more } = await provider().fetchSince(null, "INBOX");

  expect(messages).toHaveLength(1);
  // The whole folder, not the newest 25: it stops for this sync and says where.
  expect(nextCursor).toEqual({ v: 2, history_id: "555", page_token: "p4", backfill: true });
  expect(more).toBe(true);
});

test("a first read resumes from its page token and finishes", async () => {
  axios.mockResolvedValueOnce({ data: { messages: [] } }); // last page: no token
  const { nextCursor } = await provider().fetchSince(
    { v: 2, history_id: "555", page_token: "p4", backfill: true }, "SENT",
  );
  expect(axios.mock.calls[0][0].params).toMatchObject({ labelIds: "SENT", pageToken: "p4" });
  expect(nextCursor).toEqual({ v: 2, history_id: "555", page_token: null, backfill: false });
});

test("a folder other than the inbox has nothing to do once its first read is done", async () => {
  const cursor = { v: 2, history_id: "555", page_token: null, backfill: false };
  const out = await provider().fetchSince(cursor, "SENT");
  expect(out.messages).toEqual([]);
  expect(out.nextCursor).toEqual(cursor);
  expect(axios).not.toHaveBeenCalled();
});

test("Archive is everything no longer in the inbox, and Spam and Trash are asked for explicitly", async () => {
  axios.mockResolvedValue({ data: { messages: [] } });
  await provider().fetchSince({ v: 2, history_id: "1", backfill: true }, "praxis:archive");
  expect(axios.mock.calls[0][0].params.q).toMatch(/-in:inbox/);
  await provider().fetchSince({ v: 2, history_id: "1", backfill: true }, "TRASH");
  expect(axios.mock.calls[1][0].params).toMatchObject({ labelIds: "TRASH", includeSpamTrash: true });
});

test("a history that aged out reads the inbox again from the top", async () => {
  axios
    .mockRejectedValueOnce({ response: { status: 404 } }) // /history
    .mockResolvedValueOnce({ data: { historyId: "777" } }) // /profile
    .mockResolvedValueOnce({ data: { messages: [] } }); // page 1, last
  const { nextCursor } = await provider().fetchSince({ v: 2, history_id: "1", backfill: false }, "INBOX");
  expect(nextCursor).toEqual({ v: 2, history_id: "777", page_token: null, backfill: false });
});

test("a message deleted between the history and the read is skipped, not fatal", async () => {
  axios
    .mockResolvedValueOnce({ data: { history: [{ id: "5", messagesAdded: [{ message: { id: "gone" } }] }], historyId: "6" } })
    .mockRejectedValueOnce({ response: { status: 404 } });
  const { messages } = await provider().fetchSince({ v: 2, history_id: "1", backfill: false }, "INBOX");
  expect(messages).toEqual([]);
});

test("a message deleted for good comes back as removed, from the mailbox", async () => {
  axios.mockResolvedValueOnce({ data: { history: [{ id: "5", messagesDeleted: [{ message: { id: "m9" } }] }], historyId: "6" } });
  const { removed } = await provider().fetchSince({ v: 2, history_id: "1", backfill: false }, "INBOX");
  expect(removed).toEqual([{ externalMessageId: "m9", fromPath: null }]);
});

test("a list parameter is sent the way Google reads it", async () => {
  axios.mockResolvedValueOnce({ data: { history: [], historyId: "2" } });
  await provider().fetchSince({ v: 2, history_id: "1", backfill: false }, "INBOX");
  expect(axios.mock.calls[0][0].paramsSerializer).toEqual({ indexes: null });
});

describe("labels are folders", () => {
  const { folderOf, ARCHIVE_PATH } = require("../../src/modules/mail/mail/providers/gmail.provider");

  test.each([
    [["INBOX", "UNREAD"], "INBOX", "INBOX"],
    [["SENT"], "SENT", "SENT"],
    [["SENT", "INBOX"], "INBOX", "INBOX"], // sent to yourself
    [["TRASH", "INBOX"], "TRASH", "TRASH"],
    [["SPAM"], "SPAM", "SPAM"],
    [["DRAFT"], "DRAFTS", "DRAFT"],
    [["Label_7"], "ARCHIVE", "Label_7"],
    [[], "ARCHIVE", ARCHIVE_PATH],
  ])("%j is %s", (labels, folder, path) => {
    expect(folderOf(labels)).toEqual({ folder, path });
  });

  test("listFolders: the five system labels, the user's own, and a virtual Archive", async () => {
    axios.mockResolvedValueOnce({
      data: {
        labels: [
          { id: "INBOX", type: "system" }, { id: "SENT", type: "system" }, { id: "UNREAD", type: "system" },
          { id: "CATEGORY_SOCIAL", type: "system" }, { id: "Label_7", name: "Clients", type: "user" },
        ],
      },
    });
    const list = await provider().listFolders();
    expect(list.map((f) => f.path)).toEqual(["INBOX", "SENT", "Label_7", ARCHIVE_PATH]);
    expect(list[0].flags).toEqual(["\\inbox"]);
    expect(list[2]).toMatchObject({ displayName: "Clients", flags: [] });
    expect(list[3].flags).toEqual(["\\archive"]);
  });
});

describe("two-way", () => {
  test("capabilities: folders, moves, read state and delete are all on", () => {
    expect(provider().capabilities()).toMatchObject({ folders: true, folderMove: true, serverFlags: true, serverDelete: true });
  });

  test("archive takes the message out of the inbox", async () => {
    axios.mockResolvedValue({ data: {} });
    await provider().moveMessage("m1", "praxis:archive", "INBOX");
    expect(axios.mock.calls[0][0]).toMatchObject({
      method: "POST", url: expect.stringContaining("/messages/m1/modify"),
      data: { addLabelIds: [], removeLabelIds: ["INBOX", "SPAM"] },
    });
  });

  test("out of Trash, the message is untrashed first", async () => {
    axios.mockResolvedValue({ data: {} });
    await provider().moveMessage("m1", "INBOX", "TRASH");
    expect(axios.mock.calls[0][0].url).toMatch(/\/messages\/m1\/untrash$/);
    expect(axios.mock.calls[1][0].data).toEqual({ addLabelIds: ["INBOX"], removeLabelIds: ["SPAM"] });
  });

  test("to Trash uses Gmail's trash, and Sent cannot be filed into", async () => {
    axios.mockResolvedValue({ data: {} });
    await provider().moveMessage("m1", "TRASH", "INBOX");
    expect(axios.mock.calls[0][0].url).toMatch(/\/messages\/m1\/trash$/);
    expect(await provider().moveMessage("m1", "SENT", "INBOX")).toEqual({ moved: false });
    expect(axios).toHaveBeenCalledTimes(1);
  });

  test("delete is a move to Trash, which is all gmail.modify allows", async () => {
    axios.mockResolvedValueOnce({ data: {} });
    expect(await provider().deleteMessage("m1")).toEqual({ deleted: true, trashed: true });
    expect(axios.mock.calls[0][0].url).toMatch(/\/messages\/m1\/trash$/);
    axios.mockRejectedValueOnce({ response: { status: 404 } });
    expect(await provider().deleteMessage("m2")).toEqual({ deleted: false });
  });

  test("locateMessage answers from the labels, and null when Gmail no longer has it", async () => {
    axios.mockResolvedValueOnce({ data: { labelIds: ["SPAM"] } });
    expect(await provider().locateMessage("m1")).toEqual({ path: "SPAM" });
    axios.mockRejectedValueOnce({ response: { status: 404 } });
    expect(await provider().locateMessage("m2")).toBeNull();
  });

  test("the watch covers every label", async () => {
    axios.mockResolvedValueOnce({ data: { historyId: "1", expiration: "1754040000000" } });
    await provider().watch({ topicName: "projects/p/topics/t" });
    expect(axios.mock.calls[0][0].data).toEqual({ topicName: "projects/p/topics/t" });
  });
});

test("the sender's display name is kept, and a bare address has none", () => {
  const n = provider()._normalize(GMSG);
  expect(n.fromName).toBe("Sender");
  const bare = provider()._normalize({ ...GMSG, payload: { ...GMSG.payload, headers: [{ name: "From", value: "s@ext.com" }] } });
  expect(bare.fromName).toBeNull();
});

test("a send carries the engine's Message-ID and stamp", async () => {
  axios.mockResolvedValueOnce({ data: { id: "s1", threadId: "t1" } });
  await provider().sendEmail({ to: "a@b.c", subject: "x", bodyText: "y", messageId: "<praxis-1@co.cm>", headers: { "X-Praxis-Origin": "1" } });
  const raw = Buffer.from(axios.mock.calls[0][0].data.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
  expect(raw).toMatch(/Message-ID: <praxis-1@co\.cm>/i);
  expect(raw).toMatch(/X-Praxis-Origin: 1/);
});

test("an inline image with a Content-ID and no filename is kept, and marked inline", async () => {
  // Requiring a filename dropped exactly these parts, so the cid: in the HTML
  // pointed at nothing that was ever stored.
  const withInline = {
    id: "m3", threadId: "t3", labelIds: ["INBOX"], internalDate: "1754040000000",
    payload: {
      mimeType: "multipart/related",
      headers: [{ name: "From", value: "s@ext.com" }],
      parts: [
        { mimeType: "text/html", body: { data: b64url('<img src="cid:logo@x">') } },
        {
          mimeType: "image/png", filename: "",
          headers: [{ name: "Content-ID", value: "<logo@x>" }, { name: "Content-Disposition", value: "inline" }],
          body: { attachmentId: "att9", size: 3 },
        },
      ],
    },
  };
  axios
    .mockResolvedValueOnce({ data: withInline })
    .mockResolvedValueOnce({ data: { data: b64url("PNG") } });

  const n = await provider().getMessage("m3");

  expect(n.attachments).toHaveLength(1);
  expect(n.attachments[0]).toMatchObject({ content_id: "logo@x", disposition: "inline", filename: "logo@x" });
});

test("getRawMessage asks for format=raw and decodes the base64url MIME", async () => {
  axios.mockResolvedValueOnce({ data: { raw: b64url("From: a@b\r\n\r\nhi") } });
  const raw = await provider().getRawMessage("m4");
  expect(raw.toString()).toBe("From: a@b\r\n\r\nhi");
  expect(axios.mock.calls.at(-1)[0]).toMatchObject({ params: { format: "raw" } });
});

test("a synced message's attachments wait until the engine knows it is new", async () => {
  const withAtt = {
    ...GMSG, id: "m5",
    payload: { ...GMSG.payload, parts: [...GMSG.payload.parts, { mimeType: "application/pdf", filename: "f.pdf", body: { attachmentId: "a1", size: 3 } }] },
  };
  axios
    .mockResolvedValueOnce({ data: { history: [{ id: "5", messagesAdded: [{ message: { id: "m5" } }] }], historyId: "6" } })
    .mockResolvedValueOnce({ data: withAtt });
  const { messages } = await provider().fetchSince({ v: 2, history_id: "1", backfill: false }, "INBOX");
  expect(messages[0].attachments).toEqual([]);
  expect(axios).toHaveBeenCalledTimes(2);

  axios.mockResolvedValueOnce({ data: { data: b64url("PDF") } });
  const files = await messages[0].loadAttachments();
  expect(files[0]).toMatchObject({ filename: "f.pdf" });
  expect(files[0].content.toString()).toBe("PDF");
});
