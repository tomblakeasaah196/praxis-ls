/**
 * Gmail sync and Google's per-minute quota. Hermetic: axios mocked, no network.
 *
 * Since May 2026 a mailbox gets 6,000 quota units a minute and a full message
 * read costs 60: about a hundred reads. The first read of a folder used to list
 * 300 messages and read them all before returning any, so Google's 403 around
 * the hundredth discarded the lot, the cursor never moved, and a mailbox with a
 * real inbox never synced ("Inbox: Request failed with status code 403").
 *
 * These pin the three things that stop that: a run spends a budget, unread ids
 * ride in the cursor, and "slow down" from Google stops the read without
 * throwing away what is already in hand.
 */
"use strict";

jest.mock("axios");
const axios = require("axios");
const {
  GmailProvider, isRateLimit, UNITS, RUN_BUDGET,
} = require("../../src/modules/mail/mail/providers/gmail.provider");

const b64url = (s) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

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
    parts: [{ mimeType: "text/plain", body: { data: b64url("hello") } }],
  },
};

const rateLimited = () => ({
  response: {
    status: 403,
    data: { error: { code: 403, message: "User Rate Limit Exceeded", errors: [{ domain: "usageLimits", reason: "userRateLimitExceeded" }] } },
  },
});
const noScope = () => ({
  response: {
    status: 403,
    data: { error: { code: 403, message: "Request had insufficient authentication scopes.", status: "PERMISSION_DENIED", errors: [{ domain: "global", reason: "insufficientPermissions" }] } },
  },
});
const msg = (id) => ({ data: { ...GMSG, id } });
const page = (ids, nextPageToken) => ({ data: { messages: ids.map((id) => ({ id })), nextPageToken } });
const profile = { data: { emailAddress: "me@co.cm", historyId: "555" } };
const budgeted = (runBudget, sleep = jest.fn(async () => {})) =>
  new GmailProvider({ getAccessToken: async () => "tok", emailAddress: "me@co.cm", runBudget, sleep });
const ids = (out) => out.messages.map((m) => m.externalMessageId);

// 200 units: after the profile and one listing page there is room for two full
// reads in the Inbox's half.
const SMALL = 200;

beforeEach(() => axios.mockReset());

test("the default run budget leaves part of Google's minute for the person using the mailbox", () => {
  expect(UNITS.read).toBe(60);
  expect(RUN_BUDGET).toBeLessThan(6000);
  expect(RUN_BUDGET).toBeGreaterThanOrEqual(UNITS.read * 50);
});

test("a first read stops at the run's budget and carries the unread ids in the cursor", async () => {
  axios
    .mockResolvedValueOnce(profile)
    .mockResolvedValueOnce(page(["m1", "m2", "m3", "m4", "m5"], "p2"))
    .mockResolvedValueOnce(msg("m1"))
    .mockResolvedValueOnce(msg("m2"));

  const out = await budgeted(SMALL).fetchSince(null, "INBOX");

  expect(ids(out)).toEqual(["m1", "m2"]);
  expect(out.nextCursor).toEqual({ v: 2, history_id: "555", page_token: "p2", backfill: true, pending: ["m3", "m4", "m5"] });
  expect(out.more).toBe(true);
  // One page listed, not three: a page nobody can afford to read is not asked for.
  expect(axios).toHaveBeenCalledTimes(4);
});

// On the Inbox every run asks the history first ("what changed?"); nothing has.
const quietHistory = { data: { historyId: "555" } };

test("the next run reads what was carried before it lists any more", async () => {
  axios.mockResolvedValueOnce(quietHistory).mockResolvedValueOnce(msg("m3")).mockResolvedValueOnce(msg("m4"));

  const out = await budgeted(SMALL).fetchSince(
    { v: 2, history_id: "555", page_token: "p2", backfill: true, pending: ["m3", "m4", "m5"] }, "INBOX",
  );

  expect(ids(out)).toEqual(["m3", "m4"]);
  expect(out.nextCursor).toEqual({ v: 2, history_id: "555", page_token: "p2", backfill: true, pending: ["m5"] });
  // The history, then the two carried messages: no listing call.
  expect(axios.mock.calls.map((c) => c[0].url.split("/users/me")[1])).toEqual(["/history", "/messages/m3", "/messages/m4"]);
});

test("a folder is not finished while listed messages are still waiting, and is once they are read", async () => {
  axios
    .mockResolvedValueOnce(quietHistory)
    .mockResolvedValueOnce(page(["m6", "m7"])) // the last listing page
    .mockResolvedValueOnce(msg("m5"))
    .mockResolvedValueOnce(msg("m6"));
  const first = await budgeted(SMALL).fetchSince(
    { v: 2, history_id: "555", page_token: "p2", backfill: true, pending: ["m5"] }, "INBOX",
  );
  expect(first.nextCursor).toEqual({ v: 2, history_id: "555", page_token: null, backfill: true, pending: ["m7"], listed: true });

  axios.mockReset();
  axios.mockResolvedValueOnce(quietHistory).mockResolvedValueOnce(msg("m7"));
  const second = await budgeted(SMALL).fetchSince(first.nextCursor, "INBOX");

  // The history and the one waiting message. Not listed again from the top:
  // `listed` says the listing is over.
  expect(axios).toHaveBeenCalledTimes(2);
  expect(ids(second)).toEqual(["m7"]);
  // A finished folder's cursor is the same shape it always was.
  expect(second.nextCursor).toEqual({ v: 2, history_id: "555", page_token: null, backfill: false });
  expect(second.more).toBe(false);
});

test("new mail is read before the backlog", async () => {
  axios
    .mockResolvedValueOnce({ data: { history: [{ id: "600", messagesAdded: [{ message: { id: "new1" } }] }], historyId: "601" } })
    .mockResolvedValueOnce(msg("new1"))
    .mockResolvedValueOnce(msg("old1"));

  const out = await budgeted(SMALL).fetchSince(
    { v: 2, history_id: "555", page_token: "p2", backfill: true, pending: ["old1", "old2", "old3"] }, "INBOX",
  );

  expect(ids(out)).toEqual(["new1", "old1"]);
  expect(out.nextCursor).toMatchObject({ history_id: "601", pending: ["old2", "old3"] });
});

test("new mail that cannot be afforded this run is carried, not lost", async () => {
  axios.mockResolvedValueOnce({
    data: { history: [{ id: "600", messagesAdded: [{ message: { id: "new1" } }] }], historyId: "601" },
  });

  // Room for the history call and nothing else.
  const out = await budgeted(UNITS.history).fetchSince({ v: 2, history_id: "555", page_token: null, backfill: false }, "INBOX");

  expect(out.messages).toEqual([]);
  expect(out.nextCursor).toEqual({ v: 2, history_id: "601", page_token: null, backfill: true, pending: ["new1"], listed: true });
});

test("Google saying slow down stops the read, keeps what it has, and quiets the rest of the run", async () => {
  const sleep = jest.fn(async () => {});
  const p = budgeted(RUN_BUDGET, sleep);
  axios
    .mockResolvedValueOnce(profile)
    .mockResolvedValueOnce(page(["m1", "m2", "m3"]))
    .mockResolvedValueOnce(msg("m1"))
    .mockRejectedValueOnce(rateLimited());

  const inbox = await p.fetchSince(null, "INBOX");

  // Not thrown: m1 is handed back, and the cursor says m2 and m3 are next.
  expect(ids(inbox)).toEqual(["m1"]);
  expect(inbox.nextCursor).toEqual({ v: 2, history_id: "555", page_token: null, backfill: true, pending: ["m2", "m3"], listed: true });
  // The sync does not sit waiting inside a job; the next run carries on.
  expect(sleep).not.toHaveBeenCalled();

  // Every later folder in this run is left exactly as it was, unasked.
  const sentCursor = { v: 2, history_id: "555", page_token: "p9", backfill: true };
  expect(await p.fetchSince(sentCursor, "SENT")).toMatchObject({ messages: [], nextCursor: sentCursor, more: true });
  expect(await p.fetchSince(null, "TRASH")).toMatchObject({ messages: [], nextCursor: null });
  expect(axios).toHaveBeenCalledTimes(4);
});

test("a rate limit before anything was read is a pause, not a failed folder", async () => {
  axios.mockRejectedValueOnce(rateLimited()); // the profile itself
  const out = await budgeted(RUN_BUDGET).fetchSince(null, "INBOX");
  expect(out).toMatchObject({ messages: [], nextCursor: null, more: true });
});

test("a refusal that is not about rate is still an error, in Google's own words", async () => {
  axios
    .mockResolvedValueOnce(profile)
    .mockResolvedValueOnce(page(["m1"]))
    .mockRejectedValueOnce(noScope());
  await expect(budgeted(RUN_BUDGET).fetchSince(null, "INBOX")).rejects.toMatchObject({
    message: "Gmail: Request had insufficient authentication scopes.",
  });
});

test("a later folder gets a share of what is left, so a deep Inbox cannot starve it", async () => {
  // Four folders and room for 8 reads: the Inbox takes half, Sent a share of the rest.
  const p = budgeted(UNITS.read * 8 + 20);
  axios.mockResolvedValueOnce({ data: { labels: [{ id: "INBOX" }, { id: "SENT" }, { id: "TRASH" }] } });
  await p.listFolders(); // three labels and the virtual Archive
  axios.mockReset();
  axios.mockImplementation(async (req) => {
    if (req.url.endsWith("/profile")) return profile;
    if (req.url.endsWith("/messages")) return page(Array.from({ length: 20 }, (_, i) => `${req.params.labelIds}-${i}`), "more");
    return msg(req.url.split("/").pop());
  });

  const inbox = await p.fetchSince(null, "INBOX");
  const sent = await p.fetchSince(null, "SENT");

  expect(inbox.messages).toHaveLength(4);
  expect(sent.messages.length).toBeGreaterThanOrEqual(1);
  expect(sent.messages.length).toBeLessThan(4);
});

test("an attachment waits a rate limit out instead of being skipped", async () => {
  const sleep = jest.fn(async () => {});
  const withAtt = {
    ...GMSG, id: "m5",
    payload: { ...GMSG.payload, parts: [...GMSG.payload.parts, { mimeType: "application/pdf", filename: "f.pdf", body: { attachmentId: "a1", size: 3 } }] },
  };
  axios
    .mockResolvedValueOnce({ data: withAtt })
    .mockRejectedValueOnce(rateLimited())
    .mockResolvedValueOnce({ data: { data: b64url("PDF") } });

  const n = await budgeted(RUN_BUDGET, sleep).getMessage("m5");

  expect(sleep).toHaveBeenCalledTimes(1);
  expect(n.attachments).toHaveLength(1);
  expect(n.attachments[0].content.toString()).toBe("PDF");
});

test("an action during a busy minute is retried a little, then fails in Google's words", async () => {
  const sleep = jest.fn(async () => {});
  axios.mockRejectedValue(rateLimited());
  await expect(budgeted(RUN_BUDGET, sleep).markAsRead("m1")).rejects.toMatchObject({ message: "Gmail: User Rate Limit Exceeded" });
  expect(sleep).toHaveBeenCalledTimes(2);
});

test.each([
  ["the legacy usageLimits body", rateLimited(), true],
  ["a 429", { response: { status: 429, data: {} } }, true],
  ["the newer RATE_LIMIT_EXCEEDED detail", { response: { status: 403, data: { error: { message: "Quota exceeded for quota metric 'Queries'", status: "PERMISSION_DENIED", details: [{ reason: "RATE_LIMIT_EXCEEDED" }] } } } }, true],
  ["a missing permission", noScope(), false],
  ["a 403 with no body", { response: { status: 403 } }, false],
  ["a 404", { response: { status: 404 } }, false],
])("isRateLimit: %s", (_name, err, expected) => {
  expect(isRateLimit(err)).toBe(expected);
});
