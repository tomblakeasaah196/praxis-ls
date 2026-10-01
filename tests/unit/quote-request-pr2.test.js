"use strict";
/**
 * One quote-request model across the website, the portal and the desk
 * (tenant review, meeting 6, PR 2). The orchestration rules the service layer
 * now owns, each asserted so it cannot come back quietly:
 *
 *   · a request names an ACTIVE service type (and, from the website, a
 *     PUBLISHED one), and stores its name as the display copy;
 *   · its Incoterm is one the service offers, or "Not sure" (TBD), or N/A;
 *   · a hinterland transit says which way it runs when a wizard asked;
 *   · a client link makes the client's account manager the owner and the
 *     client's name the requester's company — and is frozen once converted;
 *   · "Start review" makes the reviewer the owner of an unowned request;
 *   · a portal request's documents are the client's own, linked in the
 *     creating transaction, with the commercial invoice as PRIMARY;
 *   · a chat file is filed on a request only from that request's client.
 *
 * The repo, the vault, storage and the event emitter are mocked, as in
 * quote-request-f6.test.js; the shared rules are real.
 */
jest.mock("../../src/modules/sales/quote_request/quote_request.repo");
jest.mock("../../src/modules/vault/document_vault/document_vault.service");
jest.mock("../../src/services/storage.service");
jest.mock("../../src/shared/events/emit", () => ({
  resolveActorId: async (_c, id) => id || null,
  emitEvent: jest.fn(),
  audit: jest.fn(),
}));

const repo = require("../../src/modules/sales/quote_request/quote_request.repo");
const { emitEvent } = require("../../src/shared/events/emit");
const storage = require("../../src/services/storage.service");
const service = require("../../src/modules/sales/quote_request/quote_request.service");

const QR = "11111111-1111-4111-8111-111111111111";
const ENTITY = "22222222-2222-4222-8222-222222222222";
const SEA = "33333333-3333-4333-8333-333333333333";
const HINTERLAND = "44444444-4444-4444-8444-444444444444";
const CLIENT = "55555555-5555-4555-8555-555555555555";
const OTHER_CLIENT = "66666666-6666-4666-8666-666666666666";
const AM = "77777777-7777-4777-8777-777777777777";
const REVIEWER = "88888888-8888-4888-8888-888888888888";
const DOC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const SERVICES = {
  [SEA]: {
    service_type_id: SEA, key: "SEA_FREIGHT_IMPORT", name_en: "Sea Freight Import", name_fr: "Fret Maritime Import",
    territory: "INTERNATIONAL_IMPORT", transport_mode: "SEA", is_active: true, is_published: true,
    incoterms: ["EXW", "FCA", "FAS", "FOB", "CPT", "CIP", "CFR", "CIF", "DAP", "DPU", "DDP"],
  },
  [HINTERLAND]: {
    service_type_id: HINTERLAND, key: "HINTERLAND_TRANSIT", name_en: "Hinterland Transit", name_fr: "Transit Hinterland",
    territory: "TRANSIT_HINTERLAND", transport_mode: "ROAD", is_active: true, is_published: false,
    incoterms: ["EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP"],
  },
};

function makeClient() {
  let inTransaction = false;
  return {
    query: jest.fn(async (sql) => {
      const verb = String(sql).trim().split(/\s+/)[0].toUpperCase();
      if (verb === "SAVEPOINT" && !inTransaction) throw Object.assign(new Error("no transaction"), { code: "25P01" });
      if (verb === "BEGIN") inTransaction = true;
      if (verb === "COMMIT" || verb === "ROLLBACK") inTransaction = false;
      if (/INSERT INTO doc_sequence/i.test(sql)) return { rows: [{ seq: 7 }] };
      if (/FROM corporate_entity/i.test(sql)) return { rows: [{ doc_prefix: null }] };
      return { rows: [] };
    }),
  };
}

/** Run `fn` and return the AppError it threw. */
async function refusal(fn) {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected a refusal");
}

let client;
beforeEach(() => {
  jest.clearAllMocks();
  client = makeClient();
  repo.WRITABLE = jest.requireActual("../../src/modules/sales/quote_request/quote_request.repo").WRITABLE;
  repo.defaultEntityId.mockResolvedValue(ENTITY);
  repo.serviceTypeById.mockImplementation(async (_c, id) => (SERVICES[id] ? { ...SERVICES[id] } : null));
  repo.insert.mockImplementation(async (_c, data) => ({ quote_request_id: QR, ...data }));
  repo.update.mockImplementation(async (_c, id, fields) => ({ quote_request_id: id, ...fields }));
  repo.clientForLink.mockImplementation(async (_c, id) =>
    id === CLIENT ? { client_id: CLIENT, name: "Tema Shipping SARL", account_manager_user_id: AM } : null,
  );
  repo.addAttachment.mockImplementation(async (_c, d) => ({ quote_request_attachment_id: `att-${d.vault_id}`, ...d }));
  repo.hasPrimary.mockResolvedValue(false);
  repo.refileVault.mockResolvedValue(undefined);
});

/* ── the service a request names ──────────────────────────────────────────── */

describe("the service type", () => {
  test("a create stores the service and its name as the display copy", async () => {
    const row = await service.create(client, { data: { service_type_id: SEA, incoterm: "FOB" } });
    expect(row.service_type_id).toBe(SEA);
    expect(row.service_category).toBe("Sea Freight Import");
  });

  test("an unknown or archived service is a 422 on service_type_id", async () => {
    const e = await refusal(() => service.create(client, { data: { service_type_id: DOC_A, incoterm: "TBD" } }));
    expect(e.code).toBe("SERVICE_TYPE_INVALID");
    expect(e.details).toHaveProperty("service_type_id");

    repo.serviceTypeById.mockResolvedValueOnce({ ...SERVICES[SEA], is_active: false });
    const archived = await refusal(() => service.create(client, { data: { service_type_id: SEA, incoterm: "TBD" } }));
    expect(archived.code).toBe("SERVICE_TYPE_INVALID");
    expect(repo.insert).not.toHaveBeenCalled();
  });

  test("the website may only name a PUBLISHED service; the desk and the portal any active one", async () => {
    const e = await refusal(() =>
      service.create(client, { data: { service_type_id: HINTERLAND, incoterm: "TBD", hinterland_direction: "INTO" }, options: { publishedOnly: true } }),
    );
    expect(e.code).toBe("SERVICE_TYPE_INVALID");
    const row = await service.create(client, { data: { service_type_id: HINTERLAND, incoterm: "TBD", hinterland_direction: "INTO" } });
    expect(row.service_type_id).toBe(HINTERLAND);
  });

  test("the quote created event is still emitted, as before PR 2", async () => {
    await service.create(client, { data: { service_type_id: SEA, incoterm: "FOB" } });
    expect(emitEvent).toHaveBeenCalledWith(client, expect.objectContaining({ eventTypeKey: "quote_request.created" }));
  });
});

/* ── Incoterms per service (owner decision Q3) ────────────────────────────── */

describe("Incoterms", () => {
  test("a sea-only term is refused on a road service, naming what is offered", async () => {
    const e = await refusal(() =>
      service.create(client, { data: { service_type_id: HINTERLAND, incoterm: "FOB", hinterland_direction: "INTO" } }),
    );
    expect(e.code).toBe("INCOTERM_NOT_OFFERED");
    expect(e.details.incoterm[0]).toMatch(/EXW, FCA, CPT/);
  });

  test.each(["TBD", "N/A", "dap"])("%s is accepted on any service that offers it", async (term) => {
    await expect(
      service.create(client, { data: { service_type_id: HINTERLAND, incoterm: term, hinterland_direction: "OUT_OF" } }),
    ).resolves.toBeTruthy();
  });

  test("an edit that leaves a legacy term untouched is not re-checked", async () => {
    repo.get.mockResolvedValue({ quote_request_id: QR, status: "RECEIVED", service_type_id: HINTERLAND, incoterm: "FOB" });
    await expect(service.update(client, { id: QR, patch: { cargo_description: "two crates" } })).resolves.toBeTruthy();
  });

  test("moving a request to a service that does not offer its term is refused", async () => {
    repo.get.mockResolvedValue({ quote_request_id: QR, status: "RECEIVED", service_type_id: SEA, incoterm: "CIF" });
    const e = await refusal(() => service.update(client, { id: QR, patch: { service_type_id: HINTERLAND } }));
    expect(e.code).toBe("INCOTERM_NOT_OFFERED");
  });
});

/* ── which way a hinterland transit runs (owner decision Q2) ──────────────── */

describe("hinterland direction", () => {
  test("a wizard that asked must have an answer", async () => {
    const e = await refusal(() =>
      service.create(client, { data: { service_type_id: HINTERLAND, incoterm: "TBD" }, options: { requireDirection: true } }),
    );
    expect(e.code).toBe("HINTERLAND_DIRECTION_REQUIRED");
  });

  test("the desk may not know yet", async () => {
    const row = await service.create(client, { data: { service_type_id: HINTERLAND, incoterm: "TBD" } });
    expect(row.hinterland_direction).toBeNull();
  });

  test("a direction on a service that is not a hinterland transit is dropped, not stored", async () => {
    const row = await service.create(client, { data: { service_type_id: SEA, incoterm: "FOB", hinterland_direction: "INTO" } });
    expect(row.hinterland_direction).toBeNull();
  });
});

/* ── the client a request is for (owner decision Q5) ──────────────────────── */

describe("client link", () => {
  test("the client's account manager owns it, and its name fills a blank company", async () => {
    const row = await service.create(client, { data: { service_type_id: SEA, incoterm: "FOB", client_id: CLIENT } });
    expect(row.client_id).toBe(CLIENT);
    expect(row.owner_user_id).toBe(AM);
    expect(row.requester_company).toBe("Tema Shipping SARL");
  });

  test("an owner or a company already given is kept", async () => {
    const row = await service.create(client, {
      data: { service_type_id: SEA, incoterm: "FOB", client_id: CLIENT, owner_user_id: REVIEWER, requester_company: "Tema (Douala branch)" },
    });
    expect(row.owner_user_id).toBe(REVIEWER);
    expect(row.requester_company).toBe("Tema (Douala branch)");
  });

  test("an unknown client is a 422 on client_id", async () => {
    const e = await refusal(() => service.create(client, { data: { service_type_id: SEA, incoterm: "FOB", client_id: OTHER_CLIENT } }));
    expect(e.code).toBe("CLIENT_NOT_FOUND");
  });

  test("linking an open request later applies the same rule", async () => {
    repo.get.mockResolvedValue({ quote_request_id: QR, status: "UNDER_REVIEW", service_type_id: SEA, incoterm: "FOB", owner_user_id: null, requester_company: "" });
    const row = await service.update(client, { id: QR, patch: { client_id: CLIENT } });
    expect(repo.update).toHaveBeenCalledWith(client, QR, expect.objectContaining({ client_id: CLIENT, owner_user_id: AM, requester_company: "Tema Shipping SARL" }));
    expect(row.client_id).toBe(CLIENT);
  });

  test.each(["CONVERTED_TO_OPPORTUNITY", "CLOSED_NO_ACTION"])("a %s request keeps the client it had", async (status) => {
    repo.get.mockResolvedValue({ quote_request_id: QR, status, client_id: OTHER_CLIENT });
    const e = await refusal(() => service.update(client, { id: QR, patch: { client_id: CLIENT } }));
    expect(e.code).toBe("LOCKED");
    expect(repo.update).not.toHaveBeenCalled();
  });
});

/* ── "Start review" takes an unowned request ──────────────────────────────── */

describe("owner on Start review", () => {
  test("the reviewer becomes the owner of a prospect's request", async () => {
    repo.get.mockResolvedValue({ quote_request_id: QR, status: "RECEIVED", owner_user_id: null });
    await service.transition(client, { id: QR, to: "UNDER_REVIEW", actor: { user_id: REVIEWER } });
    expect(repo.update).toHaveBeenCalledWith(client, QR, { status: "UNDER_REVIEW", owner_user_id: REVIEWER });
    expect(emitEvent).toHaveBeenCalledWith(client, expect.objectContaining({ eventTypeKey: "quote_request.under_review" }));
  });

  test("an owner already set — the account manager — is not replaced", async () => {
    repo.get.mockResolvedValue({ quote_request_id: QR, status: "RECEIVED", owner_user_id: AM });
    await service.transition(client, { id: QR, to: "UNDER_REVIEW", actor: { user_id: REVIEWER } });
    expect(repo.update).toHaveBeenCalledWith(client, QR, { status: "UNDER_REVIEW" });
  });
});

/* ── the documents a portal request is sent with (owner decision Q4) ──────── */

describe("documents", () => {
  const docs = [
    { doc_id: DOC_A, document_kind: "PACKING_LIST" },
    { doc_id: DOC_B, document_kind: "COMMERCIAL_INVOICE" },
  ];

  test("linked in the creating transaction, the commercial invoice as PRIMARY, re-filed under the request", async () => {
    repo.stagedDocuments.mockResolvedValue([{ doc_id: DOC_A }, { doc_id: DOC_B }]);
    await service.create(client, {
      data: { service_type_id: SEA, incoterm: "TBD", client_id: CLIENT },
      options: { documents: { docs, fromRef: repo.STAGED_REF, clientId: CLIENT } },
    });
    expect(repo.stagedDocuments).toHaveBeenCalledWith(client, { clientId: CLIENT, docIds: [DOC_A, DOC_B] });
    expect(repo.addAttachment).toHaveBeenCalledWith(client, expect.objectContaining({ vault_id: DOC_A, kind: "ADDITIONAL", document_kind: "PACKING_LIST" }));
    expect(repo.addAttachment).toHaveBeenCalledWith(client, expect.objectContaining({ vault_id: DOC_B, kind: "PRIMARY", document_kind: "COMMERCIAL_INVOICE" }));
    expect(repo.refileVault).toHaveBeenCalledWith(client, { docIds: [DOC_A, DOC_B], from: repo.STAGED_REF, to: `quote_request:${QR}` });
  });

  test("a document that is not this client's staged upload refuses the whole request", async () => {
    repo.stagedDocuments.mockResolvedValue([{ doc_id: DOC_A }]);
    const e = await refusal(() =>
      service.create(client, {
        data: { service_type_id: SEA, incoterm: "TBD", client_id: CLIENT },
        options: { documents: { docs, fromRef: repo.STAGED_REF, clientId: CLIENT } },
      }),
    );
    expect(e.code).toBe("DOCUMENT_NOT_YOURS");
    expect(repo.addAttachment).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });

  test("with no commercial invoice the first document is PRIMARY", async () => {
    repo.stagedDocuments.mockResolvedValue([{ doc_id: DOC_A }]);
    await service.create(client, {
      data: { service_type_id: SEA, incoterm: "TBD", client_id: CLIENT },
      options: { documents: { docs: [{ doc_id: DOC_A, document_kind: "OTHER" }], fromRef: repo.STAGED_REF, clientId: CLIENT } },
    });
    expect(repo.addAttachment).toHaveBeenCalledWith(client, expect.objectContaining({ vault_id: DOC_A, kind: "PRIMARY" }));
  });

  test("abandoned staged uploads are archived and their bytes deleted", async () => {
    repo.abandonedStaged.mockResolvedValue([
      { doc_id: DOC_A, storage_path: "tenant/x/a.pdf" },
      { doc_id: DOC_B, storage_path: "tenant/x/b.pdf" },
    ]);
    // DOC_B was linked by a request while the sweep ran: the guarded archive loses.
    repo.archiveAbandonedStaged.mockImplementation(async (_c, id) => id === DOC_A);
    storage.delete.mockResolvedValue(undefined);
    const out = await service.sweepStagedDocuments(client);
    expect(out).toEqual({ staged_archived: 1, staged_bytes_deleted: 1, staged_delete_failed: 0 });
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith("tenant/x/a.pdf");
  });
});

/* ── "File on a quote request" from a client conversation ─────────────────── */

describe("filing a chat file", () => {
  const open = { quote_request_id: QR, status: "UNDER_REVIEW", client_id: CLIENT };

  test("the client's own file is linked — the same vault row — PRIMARY when the request has none", async () => {
    repo.get.mockResolvedValue(open);
    repo.chatAttachment.mockResolvedValue({ client_id: CLIENT, doc_id: DOC_A, kind: "FILE", file_name: "invoice.pdf" });
    repo.attachmentByVault.mockResolvedValue(null);
    const out = await service.fileFromChat(client, { id: QR, chatAttachmentId: "chat-1", documentKind: "COMMERCIAL_INVOICE", actor: { user_id: REVIEWER } });
    expect(repo.addAttachment).toHaveBeenCalledWith(client, {
      quote_request_id: QR, vault_id: DOC_A, kind: "PRIMARY", document_kind: "COMMERCIAL_INVOICE", uploaded_by_user_id: REVIEWER,
    });
    expect(out.original_name).toBe("invoice.pdf");
  });

  test("another client's file reads as no such file", async () => {
    repo.get.mockResolvedValue(open);
    repo.chatAttachment.mockResolvedValue({ client_id: OTHER_CLIENT, doc_id: DOC_A, kind: "FILE" });
    const e = await refusal(() => service.fileFromChat(client, { id: QR, chatAttachmentId: "chat-1" }));
    expect(e.code).toBe("NOT_FOUND");
    expect(repo.addAttachment).not.toHaveBeenCalled();
  });

  test("a request with no client takes no chat file", async () => {
    repo.get.mockResolvedValue({ ...open, client_id: null });
    const e = await refusal(() => service.fileFromChat(client, { id: QR, chatAttachmentId: "chat-1" }));
    expect(e.code).toBe("NOT_LINKED");
  });

  test("a voice note is not a document", async () => {
    repo.get.mockResolvedValue(open);
    repo.chatAttachment.mockResolvedValue({ client_id: CLIENT, doc_id: DOC_A, kind: "VOICE" });
    const e = await refusal(() => service.fileFromChat(client, { id: QR, chatAttachmentId: "chat-1" }));
    expect(e.code).toBe("NOT_A_DOCUMENT");
  });

  test("filing the same file twice is a no-op", async () => {
    repo.get.mockResolvedValue(open);
    repo.chatAttachment.mockResolvedValue({ client_id: CLIENT, doc_id: DOC_A, kind: "IMAGE", file_name: "crate.jpg" });
    repo.attachmentByVault.mockResolvedValue({ quote_request_attachment_id: "att-1", vault_id: DOC_A });
    const out = await service.fileFromChat(client, { id: QR, chatAttachmentId: "chat-1" });
    expect(out.already).toBe(true);
    expect(repo.addAttachment).not.toHaveBeenCalled();
  });
});

/* ── which client an address belongs to ───────────────────────────────────── */

describe("client match", () => {
  test("one exact address match is the suggestion", async () => {
    repo.clientCandidates.mockResolvedValue([
      { client_id: CLIENT, name: "Tema Shipping SARL", matched_on: "CONTACT_EMAIL", rank: 1 },
      { client_id: OTHER_CLIENT, name: "Tema Logistics", matched_on: "DOMAIN", rank: 2 },
    ]);
    const out = await service.clientMatch(client, { email: "ops@tema-shipping.com" });
    expect(out.suggestion).toEqual({ client_id: CLIENT, name: "Tema Shipping SARL", matched_on: "CONTACT_EMAIL" });
    expect(repo.clientCandidates).toHaveBeenCalledWith(client, { email: "ops@tema-shipping.com", domain: "tema-shipping.com" });
  });

  test("a public webmail address is never matched by its domain", async () => {
    repo.clientCandidates.mockResolvedValue([]);
    const out = await service.clientMatch(client, { email: "someone@gmail.com" });
    expect(repo.clientCandidates).toHaveBeenCalledWith(client, { email: "someone@gmail.com", domain: null });
    expect(out).toMatchObject({ suggestion: null, domain: null, public_webmail: true });
  });

  test("two clients on one domain suggest neither", async () => {
    repo.clientCandidates.mockResolvedValue([
      { client_id: CLIENT, name: "A", matched_on: "DOMAIN", rank: 2 },
      { client_id: OTHER_CLIENT, name: "B", matched_on: "DOMAIN", rank: 2 },
    ]);
    const out = await service.clientMatch(client, { email: "x@shared.cm" });
    expect(out.suggestion).toBeNull();
    expect(out.candidates).toHaveLength(2);
  });
});

/* ── what a client reads in their portal ──────────────────────────────────── */

describe("the client's view", () => {
  test("another company's request is a 404", async () => {
    repo.get.mockResolvedValue({ quote_request_id: QR, client_id: OTHER_CLIENT });
    const e = await refusal(() => service.clientView(client, { clientId: CLIENT, id: QR }));
    expect(e.statusCode || e.status).toBe(404);
  });

  test("scope, documents and a timeline — no owner, no notes", async () => {
    repo.get.mockResolvedValue({
      quote_request_id: QR, client_id: CLIENT, status: "UNDER_REVIEW", service_type_id: SEA, public_ref: "SQ-2026-0007",
      owner_user_id: AM, internal_notes: "margin is thin", created_at: "2026-09-01T08:00:00Z", updated_at: "2026-09-02T08:00:00Z",
    });
    repo.listAttachments.mockResolvedValue([{ id: "att-1", original_name: "invoice.pdf", document_kind: "COMMERCIAL_INVOICE", kind: "PRIMARY", created_at: "x" }]);
    repo.lifecycle.mockResolvedValue([{ action: "quote_request.created", at: "2026-09-01T08:00:00Z" }]);
    const v = await service.clientView(client, { clientId: CLIENT, id: QR });
    expect(v.service).toMatchObject({ service_type_id: SEA, card: "SEA", flow: "IMPORT" });
    expect(v.documents).toEqual([{ id: "att-1", name: "invoice.pdf", document_kind: "COMMERCIAL_INVOICE", kind: "PRIMARY", created_at: "x" }]);
    expect(v.timeline.map((t) => t.status)).toEqual(["RECEIVED", "UNDER_REVIEW"]);
    expect(v).not.toHaveProperty("owner_user_id");
    expect(v).not.toHaveProperty("internal_notes");
    expect(v.quotation).toBeNull();
  });
});
