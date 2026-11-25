"use strict";
/**
 * Files on a reply to a website enquiry, and which mailbox sends it (14623).
 *
 * Asked for on 25 Nov 2026, testing the first website message on staging: the
 * desk could answer only in text. Now a reply carries files staged first
 * against THIS enquiry, and goes out from the website's sending mailbox (SmartLS:
 * support@) with the website inbox as Reply-To, when that mailbox is set up.
 */

jest.mock("../../src/modules/sales/inbound_intake/inbound_intake.repo");
jest.mock("../../src/services/email.service");
jest.mock("../../src/modules/vault/document_vault/document_vault.service", () => ({
  fetchBytes: jest.fn(async (_c, docId) => ({ buffer: Buffer.from(`%PDF-1.4 ${docId}`) })),
  createDocument: jest.fn(async () => ({ doc_id: "99999999-9999-4999-8999-999999999999", storage_path: "k.pdf" })),
}));
jest.mock("../../src/modules/sales/public_intake/website-messages.settings", () => ({
  senderMailbox: jest.fn(async () => null),
  delivery: jest.fn(async () => ({ inbox: "info@smartlsgroup.com" })),
}));
jest.mock("../../src/modules/sales/public_intake/enquiry-mail.service", () => ({
  sendVia: jest.fn(async () => ({ via: "website", messageId: "<w@x>" })),
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn().mockResolvedValue(undefined),
  audit: jest.fn().mockResolvedValue(undefined),
}));

const repo = require("../../src/modules/sales/inbound_intake/inbound_intake.repo");
const emailService = require("../../src/services/email.service");
const vault = require("../../src/modules/vault/document_vault/document_vault.service");
const settings = require("../../src/modules/sales/public_intake/website-messages.settings");
const enquiryMail = require("../../src/modules/sales/public_intake/enquiry-mail.service");
const service = require("../../src/modules/sales/inbound_intake/inbound_intake.service");

const ID = "11111111-1111-4111-8111-111111111111";
const ATTEMPT = "22222222-2222-4222-8222-222222222222";
const DOC = "44444444-4444-4444-8444-444444444444";
const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
const actor = { user_id: "33333333-3333-4333-8333-333333333333" };

beforeEach(() => {
  jest.clearAllMocks();
  repo.getEnquiry.mockResolvedValue({ contact_enquiry_id: ID, status: "READ", email: "amina@example.org", subject: null, public_ref: "MSG-8Z2GQS82" });
  repo.insertResponse.mockResolvedValue({ contact_enquiry_response_id: ATTEMPT });
  repo.settleResponse.mockImplementation((_c, id, f) => Promise.resolve({ contact_enquiry_response_id: id, ...f }));
  repo.updEnquiry.mockImplementation((_c, _id, f) => Promise.resolve(f));
  repo.stagedReplyFiles.mockResolvedValue([{ doc_id: DOC, original_name: "rates.pdf", storage_path: "tenant_x/vault/doc_1.pdf" }]);
  repo.refileVault.mockResolvedValue(1);
  emailService.send.mockResolvedValue({ messageId: "<m@x>" });
});

describe("a reply with files", () => {
  test("attaches the staged files and records them on the reply", async () => {
    await service.respond(client, { id: ID, body: "Our rates attached.", attachmentDocIds: [DOC], actor });
    const sent = emailService.send.mock.calls[0][1];
    expect(sent.attachments).toEqual([expect.objectContaining({ filename: "rates.pdf", contentType: "application/pdf" })]);
    const settled = repo.settleResponse.mock.calls.find((c) => c[2].send_status === "SENT")[2];
    expect(JSON.parse(settled.attachments)).toEqual([expect.objectContaining({ doc_id: DOC, original_name: "rates.pdf" })]);
    expect(repo.refileVault).toHaveBeenCalledWith(client, {
      docIds: [DOC], from: `contact_enquiry:${ID}:reply-staged`, to: `contact_enquiry_response:${ATTEMPT}`,
    });
  });

  test("quotes the message reference in the default subject", async () => {
    await service.respond(client, { id: ID, body: "Hello", actor });
    expect(emailService.send.mock.calls[0][1].subject).toBe("Re: your message MSG-8Z2GQS82");
  });

  test("refuses a file that is not staged for THIS enquiry, before anything is written", async () => {
    repo.stagedReplyFiles.mockResolvedValue([]);
    await expect(service.respond(client, { id: ID, body: "x", attachmentDocIds: [DOC], actor }))
      .rejects.toMatchObject({ code: "BAD_ATTACHMENT", status: 422 });
    expect(repo.insertResponse).not.toHaveBeenCalled();
    expect(emailService.send).not.toHaveBeenCalled();
  });

  test("refuses more than 15 MB of files in all", async () => {
    vault.fetchBytes.mockResolvedValueOnce({ buffer: Buffer.alloc(16 * 1024 * 1024) });
    await expect(service.respond(client, { id: ID, body: "x", attachmentDocIds: [DOC], actor }))
      .rejects.toMatchObject({ code: "FILES_TOO_LARGE", status: 413 });
  });
});

describe("which mailbox answers", () => {
  test("the website sending mailbox, replying to the website inbox, when it is set up", async () => {
    settings.senderMailbox.mockResolvedValueOnce({ host: "smtppro.zoho.com", from_address: "support@smartlsgroup.com" });
    await service.respond(client, { id: ID, body: "Hello", actor });
    expect(emailService.send).not.toHaveBeenCalled();
    const call = enquiryMail.sendVia.mock.calls[0][1];
    expect(call).toMatchObject({ to: "amina@example.org", replyTo: "info@smartlsgroup.com", sendPoint: "intake.reply" });
  });

  test("the tenant's usual mail chain otherwise", async () => {
    await service.respond(client, { id: ID, body: "Hello", actor });
    expect(enquiryMail.sendVia).not.toHaveBeenCalled();
    expect(emailService.send).toHaveBeenCalled();
  });
});

describe("staging a file for a reply", () => {
  test("types it from its bytes and files it under the enquiry's staging reference", async () => {
    const out = await service.stageReplyAttachment(client, {
      id: ID, file: { buffer: Buffer.from("%PDF-1.7 rate sheet"), originalname: "rates.pdf", mimetype: "application/octet-stream" }, slug: "smartls", actor,
    });
    expect(out).toMatchObject({ original_name: "rates.pdf", content_type: "application/pdf" });
    expect(vault.createDocument).toHaveBeenCalledWith(client, expect.objectContaining({
      entityRef: `contact_enquiry:${ID}:reply-staged`, docType: "ENQUIRY_REPLY_ATTACHMENT", slug: "smartls",
    }));
  });

  test("refuses an executable dressed as a PDF", async () => {
    await expect(service.stageReplyAttachment(client, {
      id: ID, file: { buffer: Buffer.from("MZ\u0090\u0000 not a pdf at all"), originalname: "rates.pdf" }, actor,
    })).rejects.toMatchObject({ code: "BAD_FILE_TYPE" });
  });
});
