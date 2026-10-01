"use strict";

/**
 * Tenant review of 29 Sep 2026, PR 1 — section A (register 1.1, 1.2; owner
 * decisions D1, D2), against the service with its collaborators mocked:
 *
 *   1. Accepting a client's KYC upload FILES it: the Documents tab's own path
 *      (nested.fileVerifiedDocument) writes a VERIFIED client_document of the
 *      type it was asked for, the request records which, and the compliance
 *      engine runs in the same request.
 *   2. The reviewer is asked for expiry / authority only when the type requires
 *      them — and the API refuses an accept without them, from the same rule
 *      the dialog draws.
 *   3. A shipment's paperwork keeps today's behaviour; a client-level file with
 *      no type of its own files under OTHER.
 *   4. "Request from client" makes one request per type from the client
 *      document types, refuses a type already asked for, and tells the client.
 *   5. What the portal asks a client for is the compliance engine's activation
 *      set plus the rules, and never bank details.
 */

let mockRepo;
let mockEvents = [];
let mockAudits = [];
let mockFiled = [];
let mockSynced = [];
let mockActivation = [];

jest.mock("../../src/modules/portal/portal_client.repo", () => new Proxy({}, {
  get: (_t, name) => {
    if (name === "NEVER_ASK_CODES") return ["BANK_DETAILS"];
    if (name === "NEVER_ASK_TYPES") return ["BANK_RIB"];
    return (...args) => {
      if (!mockRepo[name]) throw new Error(`repo.${String(name)} not mocked`);
      return mockRepo[name](...args);
    };
  },
}));
jest.mock("../../src/modules/master/_shared/nested", () => ({
  fileVerifiedDocument: async (c, args) => {
    mockFiled.push(args);
    return { document_id: `cd-${mockFiled.length}`, verification_status: "VERIFIED" };
  },
}));
jest.mock("../../src/modules/master/compliance/compliance.service", () => ({
  sync: async (c, args) => {
    mockSynced.push(args);
    return { compliance_state: "OK", flags: [] };
  },
  activationDocTypes: async () => mockActivation,
}));
jest.mock("../../src/modules/vault/document_vault/document_vault.service", () => ({
  createDocument: async () => ({ doc_id: "doc-new" }),
  fetchBytes: async () => ({ doc: { original_name: "x.pdf" }, buffer: Buffer.from("x") }),
  hasBytes: () => true,
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: async (c, e) => {
    mockEvents.push(e);
  },
  audit: async (c, a) => {
    mockAudits.push(a);
  },
  resolveActorId: async (c, id) => id || null,
}));
jest.mock("../../src/modules/portal/portal.service", () => ({
  clientChain: async () => ({ milestones: [], assumptions: [] }),
  clientDocuments: async () => [],
}));

const svc = require("../../src/modules/portal/portal_client.service");
const { clientPortal } = require("@praxis/shared");

const c = { query: async () => ({ rows: [] }) };

const RCCM = {
  document_type_id: "pt-rccm", code: "BUSINESS_LICENSE", name: "Business Licence / RCCM",
  portal_doc_code: "RCCM", requires_expiry: true, requires_issuing_authority: true,
};
const OTHER = {
  document_type_id: "pt-other", code: "OTHER", name: "Other",
  portal_doc_code: null, requires_expiry: false, requires_issuing_authority: false,
};

async function rejection(promise) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("expected a rejection, the call resolved");
}

/** A SUBMITTED client-level RCCM, as REQUEST_SELECT reads it. */
const submittedRccm = (over = {}) => ({
  client_request_id: "rq-1", client_id: "cl-1", dossier_id: null, kind: "DOCUMENT", status: "SUBMITTED",
  doc_type_code: "RCCM", party_document_type_id: "pt-rccm", answer_doc_id: "doc-9",
  files_as_type_id: "pt-rccm", files_as_code: "BUSINESS_LICENSE", files_as_name: RCCM.name,
  files_as_requires_expiry: true, files_as_requires_authority: true,
  ...over,
});

beforeEach(() => {
  mockEvents = [];
  mockAudits = [];
  mockFiled = [];
  mockSynced = [];
  mockActivation = [];
  mockRepo = {
    reviewRequest: async (_c, { status }) => ({ client_request_id: "rq-1", client_id: "cl-1", status }),
    setVaultReview: jest.fn(async () => {}),
    linkClientDocument: jest.fn(async () => {}),
    clientDocumentType: async (_c, id) => ({ "pt-rccm": RCCM, "pt-other": OTHER }[id] || null),
    clientDocumentTypeByCode: async (_c, code) => (code === "OTHER" ? OTHER : null),
  };
});

describe("accepting a client's KYC upload files it on the Client 360 (D1)", () => {
  it("writes a VERIFIED client_document of the requested type, links it and re-runs compliance", async () => {
    mockRepo.requestById = async () => submittedRccm();
    await svc.reviewRequest(c, {
      requestId: "rq-1", decision: "ACCEPT", actor: { user_id: "u-rev" },
      document: { issued_on: "2024-02-01", expires_on: "2029-02-01", issuing_authority: "Greffe du Tribunal de Douala" },
    });

    expect(mockRepo.setVaultReview).toHaveBeenCalledWith(c, { docId: "doc-9", status: "VERIFIED", verifiedBy: "u-rev" });
    expect(mockFiled).toEqual([
      expect.objectContaining({
        kind: "client", parentId: "cl-1", documentTypeId: "pt-rccm", vaultId: "doc-9",
        fields: expect.objectContaining({ expires_on: "2029-02-01", issuing_authority: "Greffe du Tribunal de Douala" }),
        actor: expect.objectContaining({ user_id: "u-rev" }),
      }),
    ]);
    expect(mockRepo.linkClientDocument).toHaveBeenCalledWith(c, { requestId: "rq-1", documentId: "cd-1", documentTypeId: "pt-rccm" });
    expect(mockSynced).toEqual([{ kind: "client", partyId: "cl-1" }]);
    const audit = mockAudits.find((a) => a.action === "client_request.accepted");
    expect(audit.after.client_document_id).toBe("cd-1");
  });

  it("refuses an accept without the fields the type requires, and writes nothing", async () => {
    mockRepo.requestById = async () => submittedRccm();
    const err = await rejection(svc.reviewRequest(c, { requestId: "rq-1", decision: "ACCEPT", document: { expires_on: "2029-02-01" } }));
    expect(err.code).toBe("ACCEPT_FIELDS_REQUIRED");
    expect(err.details).toHaveProperty(["document.issuing_authority"]);
    expect(mockFiled).toEqual([]);
    expect(mockRepo.setVaultReview).not.toHaveBeenCalled();
  });

  it("a shipment's paperwork is accepted on the file and goes no further", async () => {
    mockRepo.requestById = async () => submittedRccm({ dossier_id: "dos-1", doc_type_code: "BL", files_as_type_id: null });
    await svc.reviewRequest(c, { requestId: "rq-1", decision: "ACCEPT" });
    expect(mockRepo.setVaultReview).toHaveBeenCalled();
    expect(mockFiled).toEqual([]);
    expect(mockSynced).toEqual([]);
  });

  it("a client-level file with no type of its own files under OTHER, with no fields asked", async () => {
    mockRepo.requestById = async () => submittedRccm({
      doc_type_code: null, party_document_type_id: null, files_as_type_id: null, files_as_code: null,
      files_as_requires_expiry: null, files_as_requires_authority: null,
    });
    await svc.reviewRequest(c, { requestId: "rq-1", decision: "ACCEPT" });
    expect(mockFiled[0]).toEqual(expect.objectContaining({ documentTypeId: "pt-other", fields: {} }));
  });

  it("a rejection files nothing", async () => {
    mockRepo.requestById = async () => submittedRccm();
    await svc.reviewRequest(c, { requestId: "rq-1", decision: "REJECT", note: "Page 2 is missing" });
    expect(mockFiled).toEqual([]);
    expect(mockRepo.setVaultReview).toHaveBeenCalledWith(c, expect.objectContaining({ status: "REJECTED" }));
  });

  it("the staff list says what Accept files it as, and which fields it will ask for", async () => {
    mockRepo.staffRequests = async () => [{ ...submittedRccm(), client_name: "GOUM" }];
    const [row] = await svc.staffRequests(c, { clientId: "cl-1" });
    expect(row.files_as).toEqual(expect.objectContaining({ code: "BUSINESS_LICENSE", requires_expiry: true }));
    expect(row.accept_fields).toEqual({ asks: true, issued_on: true, expires_on: true, issuing_authority: true });
  });
});

describe("the accept fields are one rule, shared by the dialog and the API", () => {
  it("asks only for what the type requires", () => {
    expect(clientPortal.acceptFieldsFor({ requires_expiry: false, requires_issuing_authority: false }).asks).toBe(false);
    expect(clientPortal.acceptFieldsFor({ requires_expiry: true, requires_issuing_authority: false })).toEqual({
      asks: true, issued_on: true, expires_on: true, issuing_authority: false,
    });
    expect(clientPortal.missingAcceptFields({ requires_expiry: true }, { expires_on: "  " })).toEqual(["expires_on"]);
    expect(clientPortal.missingAcceptFields({ requires_expiry: true }, { expires_on: "2030-01-01" })).toEqual([]);
  });

  it("the review body accepts the document fields and nothing else inside them", () => {
    expect(clientPortal.reviewRequest.safeParse({ decision: "ACCEPT", document: { expires_on: "2030-01-31" } }).success).toBe(true);
    expect(clientPortal.reviewRequest.safeParse({ decision: "ACCEPT", document: { verification_status: "VERIFIED" } }).success).toBe(false);
  });
});

describe("Request from client (D2)", () => {
  beforeEach(() => {
    mockRepo.clientIdentity = async () => ({ client_id: "cl-1", name: "GOUM" });
    mockRepo.openRequestTypes = async () => new Set();
    let n = 0;
    mockRepo.insertRequest = jest.fn(async () => ({ client_request_id: `rq-${++n}` }));
    mockRepo.requestById = async (_c, id) => ({ client_request_id: id, client_id: "cl-1", status: "OPEN" });
  });

  it("makes one request per type picked, keyed to the client document type, and tells the client", async () => {
    const out = await svc.requestDocuments(c, {
      clientId: "cl-1", items: [{ document_type_id: "pt-rccm" }, { other: "Lease of the warehouse" }],
      note: "For your file", dueOn: "2026-10-15", actor: { user_id: "u-1" },
    });
    expect(out).toHaveLength(2);
    expect(mockRepo.insertRequest.mock.calls[0][1]).toEqual(expect.objectContaining({
      client_id: "cl-1", dossier_id: null, source: "STAFF", kind: "DOCUMENT",
      party_document_type_id: "pt-rccm", doc_type_code: "RCCM", due_on: "2026-10-15",
    }));
    expect(mockRepo.insertRequest.mock.calls[1][1]).toEqual(expect.objectContaining({
      party_document_type_id: "pt-other", title: "Lease of the warehouse",
    }));
    expect(mockEvents.filter((e) => e.eventTypeKey === "client_request.created")).toHaveLength(2);
  });

  it("refuses a type that is already requested — one question per document", async () => {
    mockRepo.openRequestTypes = async () => new Set(["pt-rccm"]);
    const err = await rejection(svc.requestDocuments(c, { clientId: "cl-1", items: [{ document_type_id: "pt-rccm" }] }));
    expect(err.code).toBe("ALREADY_REQUESTED");
    expect(mockRepo.insertRequest).not.toHaveBeenCalled();
  });

  it("refuses a type that is not a client document type", async () => {
    const err = await rejection(svc.requestDocuments(c, { clientId: "cl-1", items: [{ document_type_id: "pt-supplier-only" }] }));
    expect(err.code).toBe("BAD_DOC_TYPE");
  });

  it("the batch body is one shared shape", () => {
    expect(clientPortal.documentRequests.safeParse({ items: [] }).success).toBe(false);
    expect(clientPortal.documentRequests.safeParse({ items: [{ document_type_id: "00000000-0000-4000-8000-000000000001" }], due_on: "" }).success).toBe(true);
    expect(clientPortal.documentRequests.safeParse({ items: [{ other: "x" }] }).success).toBe(false);
  });
});

describe("what the portal asks a client for (D2)", () => {
  it("is the compliance engine's activation set handed to the rule sync — exemptions are the engine's", async () => {
    mockActivation = [{ document_type_id: "pt-rccm" }, { document_type_id: "pt-acf" }];
    mockRepo.syncRuleRequests = jest.fn(async () => {});
    mockRepo.clientRequests = async () => [];
    await svc.requests(c, { clientId: "cl-1" });
    expect(mockRepo.syncRuleRequests).toHaveBeenCalledWith(c, "cl-1", { activationTypeIds: ["pt-rccm", "pt-acf"] });
  });

  it("never bank details: the sync passes both the code and the client document type it must skip", async () => {
    jest.resetModules();
    const sql = [];
    jest.isolateModules(() => {
      jest.unmock("../../src/modules/portal/portal_client.repo");
      const realRepo = jest.requireActual("../../src/modules/portal/portal_client.repo");
      expect(realRepo.NEVER_ASK_CODES).toContain("BANK_DETAILS");
      expect(realRepo.NEVER_ASK_TYPES).toContain("BANK_RIB");
      const client = { query: async (text, params) => { sql.push({ text, params }); return { rows: [] }; } };
      return realRepo.syncRuleRequests(client, "cl-1", { activationTypeIds: ["pt-rccm"] });
    });
    await new Promise((r) => setImmediate(r));
    const insert = sql.find((q) => /INSERT INTO client_request/.test(q.text));
    expect(insert.params).toEqual(["cl-1", ["pt-rccm"], ["BANK_DETAILS"], ["BANK_RIB"]]);
    const cancel = sql.find((q) => /SET status = 'CANCELLED'/.test(q.text));
    expect(cancel.params).toEqual(["cl-1", ["BANK_DETAILS"], ["BANK_RIB"]]);
  });
});
