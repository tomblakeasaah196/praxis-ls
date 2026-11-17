"use strict";
/**
 * A request is WON through ONE function (src/modules/sales/quote_request/
 * quote_request.win.js; doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §5.2), whether a
 * quotation was accepted or a person pressed Mark Won. These are the rules that
 * make it safe to run from an at-least-once outbox:
 *
 *   · the row is locked FOR UPDATE before anything is read, and a request
 *     already won with its file is left alone (a retry opens no second file);
 *   · the file and the request's link to it commit together, and the file's
 *     milestones are set up only AFTER that commit;
 *   · a tenant rule the row cannot meet (making the client, opening the file)
 *     rolls back that step under a savepoint and is reported, never failing
 *     the win the client already made;
 *   · Mark Won is refused on a lost request; an acceptance is not.
 *
 * The repos, the lead service and the operations-file service are mocked; the
 * database's own behaviour under concurrency is tests/integration/
 * sales-lean-revamp.test.js's.
 */
jest.mock("../../src/modules/sales/quote_request/quote_request.repo");
jest.mock("../../src/modules/operations/operations_file/operations_file.service", () => ({
  insertForCreate: jest.fn(),
  initializeCreated: jest.fn(async () => undefined),
}));
jest.mock("../../src/modules/sales/lead/lead.service", () => ({ makeClient: jest.fn() }));
jest.mock("../../src/modules/notification/notification.service", () => ({ notify: jest.fn(async () => null) }));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => undefined),
  audit: jest.fn(async () => undefined),
  resolveActorId: async (_c, id) => id || null,
}));

const repo = require("../../src/modules/sales/quote_request/quote_request.repo");
const dossierSvc = require("../../src/modules/operations/operations_file/operations_file.service");
const leads = require("../../src/modules/sales/lead/lead.service");
const { notify } = require("../../src/modules/notification/notification.service");
const { AppError } = require("../../src/utils/errors");
const { win, routeOf } = require("../../src/modules/sales/quote_request/quote_request.win");
const handler = require("../../src/orchestration/handlers/quotation-accepted-win-request");

const QR = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";
const ENTITY = "33333333-3333-4333-8333-333333333333";
const FILE = "44444444-4444-4444-8444-444444444444";
const CLIENT = "55555555-5555-4555-8555-555555555555";

/** A client that records every statement and answers the few the win reads. */
function makeClient({ request, lead = { lead_id: LEAD, company_name: "Sahel Traders", client_id: null, entity_id: ENTITY, owner_user_id: "U1" } }) {
  const calls = [];
  let inTransaction = false;
  return {
    calls,
    query: jest.fn(async (sql, params) => {
      const text = String(sql).trim();
      const verb = text.split(/\s+/)[0].toUpperCase();
      calls.push(text);
      if (verb === "SAVEPOINT" && !inTransaction && /praxis_tx_probe/.test(text)) throw Object.assign(new Error("no transaction"), { code: "25P01" });
      if (verb === "BEGIN") inTransaction = true;
      if (verb === "COMMIT" || verb === "ROLLBACK") inTransaction = false;
      if (/FROM quote_request WHERE quote_request_id = \$1 FOR UPDATE/.test(text)) return { rows: request ? [request] : [] };
      if (/FROM lead WHERE lead_id/.test(text)) return { rows: [lead] };
      if (/FROM quotation WHERE quotation_id/.test(text)) return { rows: [{ quotation_id: params[0], quote_request_id: QR, status: "ACCEPTED" }] };
      return { rows: [] };
    }),
  };
}

const openRequest = (extra = {}) => ({
  quote_request_id: QR, lead_id: LEAD, stage: "QUOTED", status: "QUOTED", dossier_id: null,
  client_id: null, entity_id: null, service_type_id: null, title: "Reefers to Douala",
  incoterm: "CIF", origin_location: "Antwerp", destination_location: "Douala",
  estimated_weight: "12000", cargo_description: "Frozen fish", owner_user_id: "U1", ...extra,
});

/** The row as the repo holds it: updates land, and a re-read sees them. */
let stored;
beforeEach(() => {
  jest.clearAllMocks();
  stored = openRequest();
  repo.update.mockImplementation(async (_c, id, f) => { stored = { ...stored, quote_request_id: id, ...f }; return stored; });
  // Make Client ties the row's requests to the new client.
  repo.get.mockImplementation(async () => ({ ...stored, client_id: stored.client_id || CLIENT }));
  leads.makeClient.mockResolvedValue({ client_id: CLIENT, created: true });
  dossierSvc.insertForCreate.mockResolvedValue({ dossier_id: FILE, ref: "IMP-2026-0007" });
});

describe("the win", () => {
  test("wins the request, makes the client, opens the file from the request, and tells the owner", async () => {
    const c = makeClient({ request: openRequest() });
    const out = await win(c, { id: QR, via: "QUOTATION", quotationId: "Q1", actor: {} });

    expect(repo.update.mock.calls[0][2]).toMatchObject({ stage: "WON", status: "CONVERTED_TO_OPPORTUNITY", lost_reason_code: null });
    expect(leads.makeClient).toHaveBeenCalledWith(c, expect.objectContaining({ id: LEAD, strict: false }));
    const data = dossierSvc.insertForCreate.mock.calls[0][1].data;
    expect(data).toMatchObject({
      entity_id: ENTITY, client_id: CLIENT, title: "Reefers to Douala", owner_sales_id: "U1",
      incoterm: "CIF", pol: "Antwerp", pod: "Douala", gross_weight: 12000, weight_unit: "KG", commodity_desc: "Frozen fish",
    });
    expect(repo.update).toHaveBeenCalledWith(c, QR, { dossier_id: FILE });
    expect(out).toMatchObject({ dossier_id: FILE, client_id: CLIENT, file_pending: null, client_pending: null, already: false });
    expect(notify).toHaveBeenCalledWith(c, expect.objectContaining({ userId: "U1", priority: "NORMAL" }));
  });

  test("the file's milestones are set up only AFTER the win commits", async () => {
    const c = makeClient({ request: openRequest() });
    dossierSvc.initializeCreated.mockImplementationOnce(async () => {
      expect(c.calls.map((s) => s.split(/\s+/)[0].toUpperCase())).toContain("COMMIT");
    });
    await win(c, { id: QR, actor: {} });
    expect(dossierSvc.initializeCreated).toHaveBeenCalledTimes(1);
  });

  test("a request already won with its file is left alone: a retry opens no second file", async () => {
    const c = makeClient({ request: openRequest({ stage: "WON", dossier_id: FILE, settled_at: "2026-11-17" }) });
    const out = await win(c, { id: QR, via: "QUOTATION", actor: {} });
    expect(out.already).toBe(true);
    expect(dossierSvc.insertForCreate).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
    expect(c.calls[0]).toMatch(/SAVEPOINT praxis_tx_probe|BEGIN/);
    expect(c.calls.some((s) => /FOR UPDATE/.test(s))).toBe(true);
  });

  test("a won request whose file could not open gets its file on the next delivery, and is not won twice", async () => {
    const c = makeClient({ request: openRequest({ stage: "WON", dossier_id: null, settled_at: "2026-11-17", client_id: CLIENT }), lead: { lead_id: LEAD, client_id: CLIENT, entity_id: ENTITY } });
    await win(c, { id: QR, via: "QUOTATION", actor: {} });
    expect(dossierSvc.insertForCreate).toHaveBeenCalledTimes(1);
    expect(repo.update.mock.calls.map((x) => x[2])).toEqual([{ dossier_id: FILE }]);
  });

  test("a file the tenant's rules refuse rolls back that step alone, and the owner is told what to finish", async () => {
    dossierSvc.insertForCreate.mockRejectedValueOnce(new AppError("REQUIRED_FIELDS_MISSING", "Missing required field(s): bl_mawb", 422));
    const c = makeClient({ request: openRequest() });
    const out = await win(c, { id: QR, actor: {} });
    expect(c.calls).toEqual(expect.arrayContaining(["SAVEPOINT win_open_file", "ROLLBACK TO SAVEPOINT win_open_file"]));
    expect(out.file_pending).toMatchObject({ code: "REQUIRED_FIELDS_MISSING" });
    expect(out.request.stage).toBe("WON");
    expect(dossierSvc.initializeCreated).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(c, expect.objectContaining({ priority: "HIGH", body: expect.stringMatching(/Open the operations file by hand/) }));
  });

  test("a client the tenant's rules refuse is reported, and the file still opens", async () => {
    leads.makeClient.mockRejectedValueOnce(new AppError("REQUIRED_FIELDS_MISSING", "Missing required field(s): phone", 422));
    const c = makeClient({ request: openRequest() });
    const out = await win(c, { id: QR, actor: {} });
    expect(c.calls).toEqual(expect.arrayContaining(["ROLLBACK TO SAVEPOINT win_make_client"]));
    expect(out.client_pending).toMatchObject({ code: "REQUIRED_FIELDS_MISSING" });
    expect(out.dossier_id).toBe(FILE);
  });

  test("a fault that is not a refusal rolls the whole win back, for the outbox to retry", async () => {
    dossierSvc.insertForCreate.mockRejectedValueOnce(new Error("connection reset"));
    const c = makeClient({ request: openRequest() });
    await expect(win(c, { id: QR, actor: {} })).rejects.toThrow("connection reset");
    expect(c.calls).toContain("ROLLBACK");
    expect(c.calls).not.toContain("COMMIT");
  });

  test("Mark Won is refused on a lost request; an acceptance wins it", async () => {
    const lost = openRequest({ stage: "LOST", settled_at: "2026-11-01", lost_reason_code: "PRICE" });
    await expect(win(makeClient({ request: lost }), { id: QR, via: "MANUAL", actor: {} })).rejects.toMatchObject({ code: "REQUEST_SETTLED" });
    const out = await win(makeClient({ request: lost }), { id: QR, via: "QUOTATION", actor: {} });
    expect(out.request.stage).toBe("WON");
  });

  test("the file carries only what the request holds: 'Not sure' is not a term", () => {
    expect(routeOf({ incoterm: "TBD" })).toEqual({});
    expect(routeOf({ incoterm: "N/A", origin_location: "Kribi" })).toEqual({ pol: "Kribi" });
  });
});

describe("quotation.accepted:win-request", () => {
  test("is the handler on quotation.accepted, and wins the request the quotation answers", async () => {
    expect(handler.eventKey).toBe("quotation.accepted");
    expect(handler.handlerKey).toBe("quotation.accepted:win-request");
    const c = makeClient({ request: openRequest() });
    const out = await handler.run(c, { entity_ref: "quotation:Q1" });
    expect(out).toMatchObject({ won: true, dossier_id: FILE });
  });

  test("delivered twice, it opens one file", async () => {
    const first = makeClient({ request: openRequest() });
    await handler.run(first, { entity_ref: "quotation:Q1" });
    const second = makeClient({ request: openRequest({ stage: "WON", dossier_id: FILE, settled_at: "2026-11-17" }) });
    const out = await handler.run(second, { entity_ref: "quotation:Q1" });
    expect(out.won).toBe(false);
    expect(dossierSvc.insertForCreate).toHaveBeenCalledTimes(1);
  });

  test("a quotation that answers no request has nothing to win", async () => {
    const c = { query: jest.fn(async () => ({ rows: [{ quotation_id: "Q2", quote_request_id: null, status: "ACCEPTED" }] })) };
    await expect(handler.run(c, { entity_ref: "quotation:Q2" })).resolves.toEqual({ skipped: "answers no request" });
  });

  test("the retired opportunity hand-off is not registered any more", () => {
    const registry = require("../../src/orchestration/registry");
    require("../../src/orchestration/handlers");
    expect(registry.getHandlers("opportunity.won")).toEqual([]);
    expect(registry.getHandlers("quotation.accepted").map((h) => h.handlerKey)).toContain("quotation.accepted:win-request");
  });
});
