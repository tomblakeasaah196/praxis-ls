"use strict";

/**
 * Website messages (SmartLS website v2, PR 2): the bot check, the attachments,
 * the signed links and the two emails.
 */

jest.mock("../../src/services/turnstile.service", () => ({ verifyToken: jest.fn() }));
jest.mock("../../src/modules/sales/public_intake/website-messages.settings", () => ({
  turnstileKeys: jest.fn(),
  delivery: jest.fn(),
  senderMailbox: jest.fn(),
  publicConfig: jest.fn(),
}));
jest.mock("../../src/modules/sales/inbound_intake/inbound_intake.repo", () => ({
  getEnquiry: jest.fn(),
  listAttachments: jest.fn(),
  markDelivery: jest.fn(),
}));
jest.mock("../../src/modules/vault/document_vault/document_vault.service", () => ({
  fetchBytes: jest.fn(async () => ({ buffer: Buffer.from("%PDF-1.4 test") })),
  createDocument: jest.fn(),
}));
jest.mock("../../src/services/email.repo", () => ({ recordSend: jest.fn(async () => ({})) }));
jest.mock("../../src/services/email.service", () => ({ send: jest.fn() }));

const turnstile = require("../../src/services/turnstile.service");
const settings = require("../../src/modules/sales/public_intake/website-messages.settings");
const repo = require("../../src/modules/sales/inbound_intake/inbound_intake.repo");
const emailService = require("../../src/services/email.service");
const { requireHuman } = require("../../src/shared/http/human-check");
const attachments = require("../../src/modules/sales/public_intake/attachments");
const links = require("../../src/modules/sales/public_intake/attachment-link");
const mail = require("../../src/modules/sales/public_intake/enquiry-mail.service");
const { schemas } = require("../../src/modules/sales/public_intake/public_intake.validator");
const { websiteMessages } = require("@praxis/shared");

const ENQ = "0f8c2b1e-1111-4a4a-8b8b-123456789abc";
const DOC = "9a8b7c6d-2222-4b4b-8c8c-abcdef012345";

/* ── the bot check ─────────────────────────────────────────────────────── */

describe("requireHuman", () => {
  const run = (headers = {}) =>
    new Promise((resolve) => {
      const req = {
        ip: "102.244.33.7",
        tenant: { slug: "smartls" },
        tenantDbIn: (_env, fn) => fn({}),
        get: (h) => headers[h.toLowerCase()],
      };
      requireHuman("contact")(req, {}, (err) => resolve(err || null));
    });

  beforeEach(() => jest.clearAllMocks());

  it("lets everything through when the tenant has no keys (honeypot and timing still apply)", async () => {
    settings.turnstileKeys.mockResolvedValue(null);
    expect(await run()).toBeNull();
    expect(turnstile.verifyToken).not.toHaveBeenCalled();
  });

  it("refuses a submission with no token once keys exist", async () => {
    settings.turnstileKeys.mockResolvedValue({ siteKey: "k", secret: "s" });
    const err = await run();
    expect(err.code).toBe("HUMAN_CHECK_REQUIRED");
    expect(err.status).toBe(422);
  });

  it("asks Cloudflare, with the visitor's real address, and refuses what it refuses", async () => {
    settings.turnstileKeys.mockResolvedValue({ siteKey: "k", secret: "s" });
    turnstile.verifyToken.mockResolvedValue({ success: false, errorCodes: ["invalid-input-response"] });
    const err = await run({ "x-turnstile-token": "tok" });
    expect(turnstile.verifyToken).toHaveBeenCalledWith({ secret: "s", token: "tok", remoteIp: "102.244.33.7" });
    expect(err.code).toBe("HUMAN_CHECK_FAILED");
  });

  it("passes a token Cloudflare accepts", async () => {
    settings.turnstileKeys.mockResolvedValue({ siteKey: "k", secret: "s" });
    turnstile.verifyToken.mockResolvedValue({ success: true, errorCodes: [] });
    expect(await run({ "x-turnstile-token": "tok" })).toBeNull();
  });

  it("does not turn every visitor away when Cloudflare cannot be reached", async () => {
    settings.turnstileKeys.mockResolvedValue({ siteKey: "k", secret: "s" });
    turnstile.verifyToken.mockResolvedValue({ success: false, unreachable: true, errorCodes: [] });
    expect(await run({ "x-turnstile-token": "tok" })).toBeNull();
  });

  it("guards the message button, the contact form, the quote and both careers applications", () => {
    const fs = require("fs");
    const path = require("path");
    const read = (rel) => fs.readFileSync(path.join(__dirname, "../..", rel), "utf8");
    const intake = read("src/modules/sales/public_intake/public_intake.routes.js");
    for (const a of ['requireHuman("quote")', 'requireHuman("contact")', 'requireHuman("message")']) expect(intake).toContain(a);
    expect(read("src/modules/hr/careers/careers.routes.js").match(/requireHuman\("careers"\)/g)).toHaveLength(2);
  });
});

describe("the Turnstile secret never reaches a browser", () => {
  it("publicConfig carries the site key and nothing else", () => {
    const real = jest.requireActual("../../src/modules/sales/public_intake/website-messages.settings");
    const src = require("fs").readFileSync(require.resolve("../../src/modules/sales/public_intake/website-messages.settings"), "utf8");
    expect(src).toContain("return { turnstile_site_key: keys ? keys.siteKey : null };");
    expect(typeof real.publicConfig).toBe("function");
  });
});

/* ── attachments ───────────────────────────────────────────────────────── */

const zipWith = (...names) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(names.join("\0") + "\0".repeat(16), "latin1")]);
const dataUrl = (buf, type = "application/octet-stream") => `data:${type};base64,${buf.toString("base64")}`;

describe("attachments are typed from their bytes", () => {
  it.each([
    [Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj"), "application/pdf"],
    [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]), "image/png"],
    [Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]), "image/jpeg"],
    [Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]), "image/webp"],
    [Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(8)]), "image/heic"],
    [zipWith("[Content_Types].xml", "word/document.xml"), websiteMessages.DOCX],
    [zipWith("[Content_Types].xml", "xl/workbook.xml"), websiteMessages.XLSX],
  ])("%#: reads as %s", (buf, type) => {
    expect(attachments.sniffAttachment(buf)).toBe(type);
  });

  it("refuses a zip that is not an Office document, and an executable named .pdf", () => {
    expect(attachments.sniffAttachment(zipWith("payload.exe"))).toBeNull();
    expect(attachments.sniffAttachment(zipWith("[Content_Types].xml", "ppt/presentation.xml"))).toBeNull();
    expect(() => attachments.prepare([{ data_url: dataUrl(Buffer.from("MZ\x90\x00 this is an exe"), "application/pdf"), filename: "invoice.pdf" }]))
      .toThrow(expect.objectContaining({ code: "BAD_FILE_TYPE" }));
  });

  it("holds the owner's numbers: 20 MB together and ten files", () => {
    const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(6 * 1024 * 1024)]);
    expect(() => attachments.prepare([pdf, pdf, pdf, pdf].map((b) => ({ data_url: dataUrl(b) }))))
      .toThrow(expect.objectContaining({ code: "FILES_TOO_LARGE", status: 413 }));
    const tiny = { data_url: dataUrl(Buffer.from("%PDF-1.4 tiny file")) };
    expect(() => attachments.prepare(Array(11).fill(tiny))).toThrow(expect.objectContaining({ code: "TOO_MANY_FILES" }));
    expect(attachments.prepare(Array(10).fill(tiny))).toHaveLength(10);
  });

  it("keeps a safe file name: no path, no quotes, no control characters", () => {
    expect(attachments.cleanName("C:\\Users\\x\\..\\evil\"<b>.pdf", "application/pdf")).toBe("evilb.pdf");
    expect(attachments.cleanName("", "image/jpeg")).toBe("attachment.jpg");
  });

  it("the message schema requires the email, the contact schema does not", () => {
    expect(schemas.message.safeParse({ message: "Hello" }).success).toBe(false);
    expect(schemas.message.safeParse({ email: "a@b.co", message: "Hello" }).success).toBe(true);
    expect(schemas.contact.safeParse({ message: "Hello" }).success).toBe(true);
    expect(schemas.message.safeParse({ email: "a@b.co", message: "Hi", origin_page: "https://evil.example" }).success).toBe(false);
    expect(schemas.message.safeParse({ email: "a@b.co", message: "Hi", origin_page: "/services/sea-freight" }).success).toBe(true);
    expect(schemas.message.safeParse({ email: "a@b.co", message: "Hi", turnstile: "x" }).success).toBe(false);
  });
});

/* ── signed links ──────────────────────────────────────────────────────── */

describe("attachment links", () => {
  const now = Date.UTC(2026, 10, 25);
  const token = links.sign({ slug: "smartls", enquiryId: ENQ, docId: DOC, now });

  it("open the file they were made for, for the tenant they were made for", () => {
    expect(links.verify(token, { slug: "smartls", now })).toEqual(expect.objectContaining({ enquiryId: ENQ, docId: DOC }));
    expect(links.verify(token, { slug: "othertenant", now })).toBeNull();
  });

  it("stop working when they expire", () => {
    const later = now + (websiteMessages.ATTACHMENT_LINK_DAYS + 1) * 24 * 3600 * 1000;
    expect(links.verify(token, { slug: "smartls", now: later })).toBeNull();
  });

  it("cannot be altered or forged", () => {
    const [payload, sig] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    const stretched = Buffer.from(JSON.stringify({ ...claims, x: claims.x + 999999 })).toString("base64url");
    expect(links.verify(`${stretched}.${sig}`, { slug: "smartls", now })).toBeNull();
    expect(links.verify(`${payload}.AAAA`, { slug: "smartls", now })).toBeNull();
    expect(links.verify("nonsense", { slug: "smartls", now })).toBeNull();
  });
});

/* ── the two emails ────────────────────────────────────────────────────── */

const ROW = {
  contact_enquiry_id: ENQ,
  public_ref: "MSG-7Z3K9QW2",
  name: "Amina Bello",
  email: "amina@example.org",
  company_name: "Relief Freight Ltd",
  phone: "+237 6 00 00 00 00",
  enquiry_type: "GENERAL_ENQUIRY",
  message: "We have two 40 ft containers for Bangui.\nCan you quote?",
  origin_page: "/services/hinterland-transit",
};

describe("composing", () => {
  it("puts the reference in the inbox subject, and never an em dash anywhere", () => {
    const m = mail.composeInbox({ row: ROW, attachments: [], mode: "none", siteOrigin: "https://staging.smartls.cm", tenantName: "SMART LOGISTICS AND SERVICES" });
    expect(m.subject).toBe("Website message MSG-7Z3K9QW2 from Amina Bello, Relief Freight Ltd");
    expect(m.text).toContain("Written on: https://staging.smartls.cm/services/hinterland-transit");
    expect(m.text).toContain("Reply to this email to answer Amina Bello directly.");
    const ack = mail.composeAck({ row: ROW, tenantName: "SMART LOGISTICS AND SERVICES" });
    expect(ack.subject).toContain("MSG-7Z3K9QW2");
    for (const s of [m.subject, m.text, m.html, ack.subject, ack.text, ack.html]) {
      expect(s).not.toMatch(/\u2014|\u2013|--/);
    }
  });

  it("escapes what the visitor typed in the HTML", () => {
    const m = mail.composeInbox({ row: { ...ROW, message: "<img src=x onerror=alert(1)>" }, attachments: [], mode: "none", tenantName: "X" });
    expect(m.html).not.toContain("<img src=x");
    expect(m.html).toContain("&lt;img src=x");
  });

  it("lists links, with how long they last, when the files are too big to attach", () => {
    const m = mail.composeInbox({
      row: ROW, mode: "link", tenantName: "X",
      attachments: [{ doc_id: DOC, original_name: "manifest.pdf", byte_size: 12 * 1024 * 1024 }],
      linkFor: () => "https://staging.smartls.cm/api/tenant/public/intake/attachments/tok",
    });
    expect(m.text).toContain(`for ${websiteMessages.ATTACHMENT_LINK_DAYS} days`);
    expect(m.text).toContain("- manifest.pdf (12.0 MB): https://staging.smartls.cm/api/tenant/public/intake/attachments/tok");
  });
});

describe("deliverEnquiry", () => {
  const sent = [];
  const tx = { sendMail: jest.fn(async (p) => { sent.push(p); return { messageId: "<id@x>" }; }) };

  beforeEach(() => {
    jest.clearAllMocks();
    sent.length = 0;
    repo.getEnquiry.mockResolvedValue({ ...ROW, inbox_notified_at: null, visitor_acked_at: null });
    repo.listAttachments.mockResolvedValue([{ doc_id: DOC, original_name: "invoice.pdf", content_type: "application/pdf", byte_size: 2048 }]);
    settings.delivery.mockResolvedValue({ inbox: "info@smartlsgroup.com" });
    settings.senderMailbox.mockResolvedValue({
      host: "smtppro.zoho.com", port: 465, secure: true, user: "support@smartlsgroup.com", pass: "x",
      from_address: "support@smartlsgroup.com", from_name: "SMART LOGISTICS AND SERVICES",
    });
  });

  it("sends the inbox copy with the visitor as Reply-To and the file attached, then the acknowledgement", async () => {
    const out = await mail.deliverEnquiry({}, { enquiryId: ENQ, slug: "smartls", tenantName: "SMART LOGISTICS AND SERVICES", siteOrigin: "https://staging.smartls.cm" }, tx);
    expect(out).toEqual({ inbox: "sent", ack: "sent" });
    expect(sent).toHaveLength(2);
    const [inbox, ack] = sent;
    expect(inbox.to).toBe("info@smartlsgroup.com");
    expect(inbox.replyTo).toBe("amina@example.org");
    expect(inbox.from).toBe('"SMART LOGISTICS AND SERVICES" <support@smartlsgroup.com>');
    expect(inbox.subject).toContain("MSG-7Z3K9QW2");
    expect(inbox.attachments).toEqual([expect.objectContaining({ filename: "invoice.pdf", contentType: "application/pdf" })]);
    expect(ack.to).toBe("amina@example.org");
    expect(ack.replyTo).toBe("info@smartlsgroup.com");
    expect(repo.markDelivery).toHaveBeenCalledWith({}, ENQ, { inbox: true });
    expect(repo.markDelivery).toHaveBeenCalledWith({}, ENQ, { ack: true });
  });

  it("never sends an email twice: a retry sends only what has not left", async () => {
    repo.getEnquiry.mockResolvedValue({ ...ROW, inbox_notified_at: new Date(), visitor_acked_at: null });
    const out = await mail.deliverEnquiry({}, { enquiryId: ENQ, slug: "smartls" }, tx);
    expect(out).toEqual({ inbox: "already", ack: "sent" });
    expect(sent.map((m) => m.to)).toEqual(["amina@example.org"]);
  });

  it("records a failure and throws so the worker retries, keeping what did go out", async () => {
    tx.sendMail.mockImplementationOnce(async () => { throw new Error("535 auth failed"); });
    await expect(mail.deliverEnquiry({}, { enquiryId: ENQ, slug: "smartls" }, tx)).rejects.toThrow(/inbox: 535/);
    expect(repo.markDelivery).toHaveBeenCalledWith({}, ENQ, { ack: true });
    expect(repo.markDelivery).toHaveBeenCalledWith({}, ENQ, { error: expect.stringContaining("535") });
  });

  it("uses the tenant's ordinary sender when no website mailbox is set", async () => {
    settings.senderMailbox.mockResolvedValue(null);
    emailService.send.mockResolvedValue({ messageId: "<m@x>" });
    await mail.deliverEnquiry({}, { enquiryId: ENQ, slug: "smartls" }, tx);
    expect(emailService.send).toHaveBeenCalledWith({}, expect.objectContaining({ sendPoint: "site.enquiry.notify", replyTo: "amina@example.org" }), tx);
    expect(emailService.send).toHaveBeenCalledWith({}, expect.objectContaining({ sendPoint: "site.enquiry.ack" }), tx);
  });

  it("sends no inbox copy when no inbox is set, and still acknowledges the visitor", async () => {
    settings.delivery.mockResolvedValue({ inbox: null });
    const out = await mail.deliverEnquiry({}, { enquiryId: ENQ, slug: "smartls" }, tx);
    expect(out).toEqual({ inbox: "no_inbox", ack: "sent" });
  });
});
