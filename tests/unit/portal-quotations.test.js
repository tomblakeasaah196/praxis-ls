"use strict";

/**
 * Meeting 6, PR 4 — commercial quotations in the client portal (G3, G4).
 *
 *   1. A client sees only THEIR quotations, and never a draft.
 *   2. The offer page shows the families exactly as the PDF prints them —
 *      the template's own record, grouped by the template's own groupLines,
 *      in the document's family order.
 *   3. Accepting is signing, exactly like proposals: the signature programme's
 *      request for THIS portal user, the code verified before signing, the
 *      quotation accepted after — with who signed it, never converted.
 *   4. A confirmed accept only where the tenant offers no digital card.
 *   5. Declining takes a reason from the list, and the quotation keeps it.
 *   6. The request page shows the quotation that answers it.
 */

let mockQuotation;
let mockMenu;
let mockCalls = [];
let mockParty = null;

jest.mock("../../src/modules/commercial/quotation/quotation.repo", () => ({
  get: async (c, id) => (mockQuotation && mockQuotation.quotation_id === id ? mockQuotation : null),
}));
jest.mock("../../src/modules/commercial/quotation/quotation.service", () => ({
  accept: async (c, opts) => {
    mockCalls.push(["accept", opts.id, opts.convert, opts.via, opts.by]);
    mockQuotation.status = "ACCEPTED";
    return { quotation: mockQuotation };
  },
  decline: async (c, opts) => {
    mockCalls.push(["decline", opts.id, opts.reasonCode, opts.reason]);
    mockQuotation.status = "REJECTED";
    mockQuotation.decline_reason = opts.reason;
    return mockQuotation;
  },
}));
jest.mock("../../src/modules/vault/signature_request/signature_request.service", () => ({
  create: async (c, opts) => {
    mockCalls.push(["create", opts]);
    mockParty = { party_id: "party-1", request_id: "req-1", status: "PENDING" };
    return { request_id: "req-1" };
  },
  dispatch: async (c, opts) => {
    mockCalls.push(["dispatch", opts]);
    mockParty.status = "SENT";
    return { token: "t-dispatch" };
  },
  remintSignToken: async () => ({ token: "t-fresh" }),
}));
jest.mock("../../src/modules/vault/signature_public/signature_public.service", () => ({
  resolve: async () => ({
    signer: { full_name: "Elisha Godwin", email_masked: "e••••@goum.cm" },
    menu: { cards: [{ preset_code: "STAMP", label: "Digital stamp" }, { preset_code: "DRAWN", label: "Draw" }] },
  }),
  sendOtp: async (c, { token }) => {
    mockCalls.push(["sendOtp", token]);
    return { status: "SENT" };
  },
  verifyOtp: async (c, { code }) => {
    mockCalls.push(["verifyOtp", code]);
    if (code !== "123456") {
      const e = new Error("wrong code");
      e.code = "OTP_INVALID";
      throw e;
    }
    return { status: "VERIFIED" };
  },
  complete: async (c, opts) => {
    mockCalls.push(["complete", opts.presetCode]);
    return { signed: true, verify_code: "ABCD-EFGH" };
  },
  declineSigning: async (c, { reasonCode }) => {
    mockCalls.push(["declineSigning", reasonCode]);
    return { declined: true };
  },
}));
jest.mock("../../src/services/signatures/presets", () => ({
  resolveMenu: async (c, { docType }) => {
    mockCalls.push(["menu", docType]);
    return mockMenu;
  },
  reasons: async () => [{ reason_code: "PRICE", label_en: "The price", label_fr: "Le prix" }],
}));
jest.mock("../../src/modules/notification/notification.repo", () => ({
  requesterFor: async () => "pricer-1",
}));
jest.mock("../../src/modules/vault/document_vault/document_vault.service", () => ({
  fetchBytes: async () => ({ buffer: Buffer.from("%PDF") }),
}));
jest.mock("../../src/modules/documents/template/template.service", () => ({
  // The QUOTATION record exactly as the printer loads it.
  loadRecord: async () => ({
    entity_id: "e1",
    data: {
      lines: [
        { label: "Customs duties", qty: 1, unit: 450000, amount: 450000, tax: 19.25, tax_rate: null, is_disbursement: true, client_heading_code: "CUSTOMS", client_heading_en: "Customs Formalities", client_heading_fr: "Formalités Douanières", client_heading_sort: 10 },
        { label: "Clearance fee", qty: 2, unit: 125000, amount: 250000, tax: 19.25, tax_rate: 19.25, is_disbursement: false, client_heading_code: "CUSTOMS", client_heading_en: "Customs Formalities", client_heading_fr: "Formalités Douanières", client_heading_sort: 10 },
        { label: "Transportation", qty: 1, unit: 200000, amount: 200000, tax: 19.25, tax_rate: 19.25, is_disbursement: false, client_heading_code: "TRANSPORT", client_heading_en: "Transport", client_heading_fr: "Transport", client_heading_sort: 30 },
      ],
      client_headings: [
        { code: "CUSTOMS", fr: "Formalités Douanières", en: "Customs Formalities", sort: 10 },
        { code: "TRANSPORT", fr: "Transport", en: "Transport", sort: 30 },
      ],
      family_order: ["TRANSPORT", "CUSTOMS"],
      totals: { service_ht: 900000, vat_total: 86625, total_ttc: 986625 },
    },
  }),
  generate: async () => ({ doc_id: "doc-1" }),
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: async () => {},
  audit: async () => {},
}));

const service = require("../../src/modules/portal/portal_quotation.service");

const ID = "11111111-1111-4111-8111-111111111111";
const REQ = "22222222-2222-4222-8222-222222222222";
const ME = { portal_user_id: "pu-1", email: "elisha@goum.cm", full_name: "Elisha Godwin" };

const contextRow = () => ({
  ...mockQuotation, request_ref: "SQ-2026-0003", service_en: "Sea Freight Import", service_fr: "Fret Maritime Import",
  origin: "Shanghai", destination: "Douala", incoterm: "CIF", dossier_ref: "PRX-2026-0418",
});
const client = {
  query: async (sql) => {
    if (/FROM signature_party/.test(sql)) return { rows: mockParty ? [mockParty] : [] };
    if (/FROM document_signature/.test(sql)) return { rows: [{ signer_name: "Elisha Godwin", created_at: "2026-10-02T10:00:00Z", visual_mark: "STAMP", assurance_level: "AES_OTP", verify_code: "ABCDEFGH" }] };
    if (/FROM client_master/.test(sql)) return { rows: [{ name: "GOUM INTERNATIONAL COMPANY SARL", payment_terms_days: 30 }] };
    if (/FROM quotation q/.test(sql)) return { rows: mockQuotation.client_id === "c1" && mockQuotation.status !== "DRAFT" ? [contextRow()] : [] };
    return { rows: [] };
  },
};

beforeEach(() => {
  mockCalls = [];
  mockParty = null;
  mockMenu = { cards: [{ preset_code: "STAMP", label: "Digital stamp" }, { preset_code: "DRAWN", label: "Draw" }], blocked: [] };
  mockQuotation = {
    quotation_id: ID, client_id: "c1", status: "SENT", doc_number: "QT-2026-0004", currency: "XAF",
    total_ht: 900000, total_ttc: 986625, valid_until: "2099-12-31", quote_request_id: REQ,
    created_at: new Date(), updated_at: new Date(), sent_at: new Date(), viewed_at: null,
  };
});

describe("cards and the offer page", () => {
  it("a card names the offer: number, service, route, total, validity, the request it answers", async () => {
    const [card] = await service.list(client, { clientId: "c1" });
    expect(card).toMatchObject({
      doc_number: "QT-2026-0004", status: "SENT", waiting: true, service: "Sea Freight Import",
      route: { from: "Shanghai", to: "Douala" }, total: 986625, currency: "XAF", valid_until: "2099-12-31",
      request: { quote_request_id: REQ, public_ref: "SQ-2026-0003" },
    });
  });

  it("shows the families exactly as the PDF prints them, in the document's order", async () => {
    const out = await service.get(client, { clientId: "c1", quotationId: ID });
    expect(out.quotation.lines.map((l) => [l.label, l.amount])).toEqual([
      ["Transport", 200000],
      ["Customs Formalities — Disbursements", 450000],
      ["Customs Formalities — Service Fee", 250000],
    ]);
    expect(out.quotation).toMatchObject({ incoterm: "CIF", payment_terms_days: 30, totals: { ht: 900000, vat: 86625, ttc: 986625 } });
    expect(out.signing).toMatchObject({ available: true });
    expect(out.decline_reasons).toEqual([{ reason_code: "PRICE", label: "The price" }]);
    // The menu is the QUOTATION type's own.
    expect(mockCalls).toContainEqual(["menu", "QUOTATION"]);
  });

  it("never shows another company's quotation, nor a draft", async () => {
    await expect(service.get(client, { clientId: "c2", quotationId: ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
    mockQuotation.status = "DRAFT";
    await expect(service.get(client, { clientId: "c1", quotationId: ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a SENT quotation past its validity reads as EXPIRED and cannot be answered", async () => {
    mockQuotation.valid_until = "2020-01-01";
    const [card] = await service.list(client, { clientId: "c1" });
    expect(card.status).toBe("EXPIRED");
    await expect(service.startSigning(client, { clientId: "c1", quotationId: ID, me: ME })).rejects.toMatchObject({ code: "QUOTATION_EXPIRED" });
  });

  it("downloads the QUOTATION template's PDF", async () => {
    const out = await service.pdf(client, { clientId: "c1", quotationId: ID });
    expect(out).toMatchObject({ name: "QT-2026-0004.pdf", type: "application/pdf" });
  });
});

describe("accepting is signing — exactly like proposals", () => {
  it("opens the request for this portal user, on behalf of whoever sent it, and sends only the code", async () => {
    await service.startSigning(client, { clientId: "c1", quotationId: ID, me: ME, grantId: "grant-1" });
    const create = mockCalls.find((x) => x[0] === "create")[1];
    expect(create).toMatchObject({ entityRef: `quotation:${ID}`, docType: "QUOTATION", allowPaper: false, actor: { user_id: "pricer-1" } });
    expect(create.parties).toEqual([expect.objectContaining({ source: "ON_FILE", source_ref: "portal_access:grant-1", email: "elisha@goum.cm" })]);
    expect(mockCalls.find((x) => x[0] === "dispatch")[1].sendEmail).toBeNull();
  });

  it("verifies the code, signs, then accepts — with who signed, and never converts", async () => {
    await service.startSigning(client, { clientId: "c1", quotationId: ID, me: ME });
    mockCalls = [];
    const out = await service.completeSigning(client, { clientId: "c1", quotationId: ID, me: ME, code: "123456", presetCode: "STAMP" });
    expect(mockCalls.map((x) => x[0])).toEqual(["verifyOtp", "complete", "accept"]);
    expect(mockCalls[2]).toEqual(["accept", ID, false, "PORTAL", { name: "Elisha Godwin", email: "elisha@goum.cm" }]);
    expect(out).toMatchObject({ accepted: true, signature: { signer_name: "Elisha Godwin", verify_code: "ABCDEFGH" } });
  });

  it("accepts nothing when the code is wrong", async () => {
    await service.startSigning(client, { clientId: "c1", quotationId: ID, me: ME });
    await expect(service.completeSigning(client, { clientId: "c1", quotationId: ID, me: ME, code: "000000", presetCode: "STAMP" })).rejects.toMatchObject({ code: "OTP_INVALID" });
    expect(mockQuotation.status).toBe("SENT");
  });

  it("a click is refused where the tenant offers a signature, and is the accept where it does not", async () => {
    await expect(service.accept(client, { clientId: "c1", quotationId: ID, me: ME })).rejects.toMatchObject({ code: "SIGNATURE_REQUIRED" });
    mockMenu = { cards: [], blocked: [] };
    await expect(service.accept(client, { clientId: "c1", quotationId: ID, me: ME })).resolves.toEqual({ accepted: true, signature: null });
  });
});

describe("declining", () => {
  it("takes a reason from the list, and the quotation keeps it", async () => {
    await expect(service.decline(client, { clientId: "c1", quotationId: ID, me: ME, reasonCode: "WHATEVER" })).rejects.toMatchObject({ code: "UNKNOWN_DECLINE_REASON" });
    await service.decline(client, { clientId: "c1", quotationId: ID, me: ME, reasonCode: "PRICE", note: "Too high for Q4" });
    expect(mockCalls).toContainEqual(["decline", ID, "PRICE", "The price — Too high for Q4"]);
  });

  it("an answered quotation cannot be answered again", async () => {
    mockQuotation.status = "ACCEPTED";
    await expect(service.decline(client, { clientId: "c1", quotationId: ID, me: ME, reasonCode: "PRICE" })).rejects.toMatchObject({ code: "QUOTATION_ANSWERED" });
  });
});
