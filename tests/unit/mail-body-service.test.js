"use strict";

/**
 * Repair on open, and the original on request (body.service).
 *
 * The sanitizer itself is proven against the real library in
 * mail-body-html.test.js; here it is a marker, because what is under test is
 * WHICH road a stored message takes and what each road writes, and a marker
 * makes "this was re-cleaned from that" visible in the assertion.
 */

jest.mock("../../src/modules/mail/mail/body-html", () => ({
  BODY_POLICY: 1,
  cleanHtml: (h) => (h ? `CLEAN:${h}` : null),
}));
const mockGetConnection = jest.fn();
jest.mock("../../src/modules/mail/mail/mail.repo", () => ({
  getConnection: (...a) => mockGetConnection(...a),
}));
const mockResolveAdapter = jest.fn();
jest.mock("../../src/modules/mail/mail/mail.service", () => ({
  resolveAdapter: (...a) => mockResolveAdapter(...a),
}));

const crypto = require("crypto");
const body = require("../../src/modules/mail/mail/body.service");

/** A client that answers the four statements body.service issues. */
function fakeClient(row, { sentPath = "Sent" } = {}) {
  const writes = [];
  const query = jest.fn(async (sql, params) => {
    if (/^SELECT email_message_id/.test(sql.trim())) return { rows: row ? [{ ...row }] : [] };
    if (/FROM email_folder/.test(sql)) return { rows: sentPath ? [{ provider_path: sentPath }] : [] };
    if (/^UPDATE/.test(sql.trim())) {
      writes.push({ sql, params });
      return { rowCount: 1, rows: [] };
    }
    return { rows: [] };
  });
  return { query, writes };
}

const LEGACY_IN = {
  email_message_id: "m1", email_connection_id: "c1", direction: "IN", provider_folder: "Archive",
  external_message_id: "<x@y>", subject: "Brief", body_html: "<p>flat</p>", body_html_original: null,
  body_policy: null, body_repair_failed_at: null,
};

let adapter;
beforeEach(() => {
  jest.clearAllMocks();
  adapter = { getMessage: jest.fn(), getRawMessage: jest.fn() };
  mockGetConnection.mockResolvedValue({ email_connection_id: "c1", status: "CONNECTED", provider: "imap_smtp" });
  mockResolveAdapter.mockResolvedValue(adapter);
});

describe("getBody: the cheapest road that works", () => {
  test("a current body is the answer, and nothing is asked of the provider", async () => {
    const c = fakeClient({ ...LEGACY_IN, body_policy: 1 });
    const out = await body.getBody(c, "m1");
    expect(out).toMatchObject({ source: "stored", body_html: "<p>flat</p>", body_policy: 1 });
    expect(adapter.getMessage).not.toHaveBeenCalled();
    expect(c.writes).toHaveLength(0);
  });

  test("a message that never had HTML has nothing to repair", async () => {
    const c = fakeClient({ ...LEGACY_IN, body_html: null });
    expect((await body.getBody(c, "m1")).source).toBe("stored");
    expect(adapter.getMessage).not.toHaveBeenCalled();
  });

  test("an older policy with the original stored is re-cleaned from it, offline", async () => {
    const c = fakeClient({ ...LEGACY_IN, body_policy: 0, body_html_original: "<td style='x'>orig</td>" });
    const out = await body.getBody(c, "m1");
    expect(out).toMatchObject({ source: "recleaned", body_html: "CLEAN:<td style='x'>orig</td>", body_policy: 1 });
    expect(adapter.getMessage).not.toHaveBeenCalled();
    expect(c.writes[0].params).toEqual(["m1", "<td style='x'>orig</td>", "CLEAN:<td style='x'>orig</td>", 1]);
  });

  test("a row Praxis wrote on send is its own original: no provider call", async () => {
    // recordOutbound stored the serializer's output as it was, unsanitized,
    // before 14410, so its body_html is what was sent.
    const c = fakeClient({ ...LEGACY_IN, direction: "OUT", provider_folder: null, body_html: "<table>sent</table>" });
    const out = await body.getBody(c, "m1");
    expect(out.source).toBe("recleaned");
    expect(c.writes[0].params.slice(1, 3)).toEqual(["<table>sent</table>", "CLEAN:<table>sent</table>"]);
    expect(adapter.getMessage).not.toHaveBeenCalled();
  });

  test("a legacy message is fetched once, from the folder it was synced from, and stored with its original", async () => {
    const png = Buffer.from("png-bytes");
    adapter.getMessage.mockResolvedValue({
      bodyHtml: '<td style="background:#0b3d2e"><img src="cid:logo@x"></td>',
      attachments: [{ content_id: "logo@x", content: png }],
    });
    const c = fakeClient(LEGACY_IN);

    const out = await body.getBody(c, "m1");

    expect(adapter.getMessage).toHaveBeenCalledWith("<x@y>", { folderPath: "Archive" });
    expect(out).toMatchObject({ source: "provider", body_policy: 1 });
    expect(out.body_html).toBe('CLEAN:<td style="background:#0b3d2e"><img src="cid:logo@x"></td>');
    const [stored, linked] = c.writes;
    expect(stored.params[1]).toBe('<td style="background:#0b3d2e"><img src="cid:logo@x"></td>');
    // The inline part is linked to the attachment already stored, by checksum.
    expect(linked.sql).toMatch(/UPDATE email_attachment SET content_id/);
    expect(linked.params).toEqual(["m1", crypto.createHash("sha256").update(png).digest("hex"), "logo@x"]);
  });

  test("the provider no longer has it: the flat body stands, and the failure is recorded", async () => {
    adapter.getMessage.mockResolvedValue(null);
    const c = fakeClient(LEGACY_IN);
    const out = await body.getBody(c, "m1");
    expect(out).toMatchObject({ source: "unavailable", body_html: "<p>flat</p>" });
    expect(c.writes[0].sql).toMatch(/body_repair_failed_at = now\(\)/);
  });

  test("a provider error never reaches the reader", async () => {
    adapter.getMessage.mockRejectedValue(new Error("token revoked"));
    const out = await body.getBody(fakeClient(LEGACY_IN), "m1");
    expect(out.source).toBe("unavailable");
  });

  test("a failure inside the last day is not retried", async () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    const c = fakeClient({ ...LEGACY_IN, body_repair_failed_at: new Date(now - 60 * 60 * 1000).toISOString() });
    expect((await body.getBody(c, "m1", { now })).source).toBe("unavailable");
    expect(adapter.getMessage).not.toHaveBeenCalled();
  });

  test("a failure older than a day is tried again", async () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    adapter.getMessage.mockResolvedValue({ bodyHtml: "<p>back</p>", attachments: [] });
    const c = fakeClient({ ...LEGACY_IN, body_repair_failed_at: new Date(now - body.RETRY_MS - 1000).toISOString() });
    expect((await body.getBody(c, "m1", { now })).source).toBe("provider");
  });

  test("a disabled mailbox is not contacted", async () => {
    mockGetConnection.mockResolvedValue({ status: "DISABLED" });
    expect((await body.getBody(fakeClient(LEGACY_IN), "m1")).source).toBe("unavailable");
    expect(mockResolveAdapter).not.toHaveBeenCalled();
  });

  test("an unknown message is a 404", async () => {
    await expect(body.getBody(fakeClient(null), "nope")).rejects.toMatchObject({ status: 404 });
  });

  test("the original is never in the answer", async () => {
    const out = await body.getBody(fakeClient({ ...LEGACY_IN, body_policy: 1, body_html_original: "<secret>" }), "m1");
    expect(JSON.stringify(out)).not.toContain("secret");
  });
});

describe("getSource: the message as the provider holds it", () => {
  test("returns the raw bytes and a filename built from the subject", async () => {
    adapter.getRawMessage.mockResolvedValue(Buffer.from("From: a@b\r\n\r\nhi"));
    const out = await body.getSource(fakeClient(LEGACY_IN), "m1");
    expect(out.buffer.toString()).toBe("From: a@b\r\n\r\nhi");
    expect(out.filename).toBe("Brief.eml");
    expect(adapter.getRawMessage).toHaveBeenCalledWith("<x@y>", { folderPath: "Archive" });
  });

  test("a message Praxis sent is looked for in the mailbox's Sent folder", async () => {
    adapter.getRawMessage.mockResolvedValue(Buffer.from("x"));
    await body.getSource(fakeClient({ ...LEGACY_IN, direction: "OUT", provider_folder: null }, { sentPath: "INBOX.Sent" }), "m1");
    expect(adapter.getRawMessage).toHaveBeenCalledWith("<x@y>", { folderPath: "INBOX.Sent" });
  });

  test("gone from the server is its own 404, so the pane can say so", async () => {
    adapter.getRawMessage.mockResolvedValue(null);
    await expect(body.getSource(fakeClient(LEGACY_IN), "m1"))
      .rejects.toMatchObject({ code: "MAIL_SOURCE_UNAVAILABLE", status: 404 });
  });
});

describe("emlFilename", () => {
  test("folds to printable ASCII and drops what no file system accepts", () => {
    expect(body.emlFilename("Réponse: devis / cotation?")).toBe("Reponse devis cotation.eml");
    expect(body.emlFilename("")).toBe("message.eml");
    expect(body.emlFilename("a".repeat(200))).toHaveLength(84);
  });
});
