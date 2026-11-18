"use strict";
/**
 * F6 — Lead register & quote intake (MOD-20). The regression suite for the
 * seven defects the first pass shipped, each of which is asserted here so it
 * cannot come back quietly.
 *
 * The repo, the vault, object storage, the numbering service and the event
 * emitter are mocked, so what is under test is the ORCHESTRATION — which is
 * where every one of these defects lived. The one thing that is NOT mocked is
 * `quote_request.rules`, because the KPI arithmetic is the feature.
 */
jest.mock("../../src/modules/sales/quote_request/quote_request.repo");
// The company row a request lands on is the lead service's business (its own
// tests hold it); here it is found, so the request's own rules are under test.
jest.mock("../../src/modules/sales/lead/lead.service", () => ({
  findOrCreateForIntake: jest.fn(async () => ({ lead: { lead_id: "LEAD-1" }, created: false })),
  stepForArrival: jest.fn(async () => null),
}));
jest.mock("../../src/modules/vault/document_vault/document_vault.service");
jest.mock("../../src/services/storage.service");
jest.mock("../../src/shared/events/emit", () => ({
  resolveActorId: async (_c, id) => id || null,
  emitEvent: jest.fn(),
  audit: jest.fn(),
}));

const repo = require("../../src/modules/sales/quote_request/quote_request.repo");
const vault = require("../../src/modules/vault/document_vault/document_vault.service");
const storage = require("../../src/services/storage.service");
const service = require("../../src/modules/sales/quote_request/quote_request.service");
const rules = require("../../src/modules/sales/quote_request/quote_request.rules");
const numbering = require("../../src/services/documents/numbering.service");
const { atomically } = require("../../src/shared/db/tx");

const QR = "11111111-1111-4111-8111-111111111111";
const ENTITY = "22222222-2222-4222-8222-222222222222";

/** A client that records the transaction verbs it was asked to run. */
function makeClient() {
  const calls = [];
  let inTransaction = false;
  return {
    calls,
    query: jest.fn(async (sql, params) => {
      const verb = String(sql).trim().split(/\s+/)[0].toUpperCase();
      calls.push(verb);
      // Model PostgreSQL rather than treating an out-of-transaction SAVEPOINT
      // probe as successful (which would falsely tell atomically() it is nested).
      if (verb === "SAVEPOINT" && !inTransaction) throw Object.assign(new Error("no transaction"), { code: "25P01" });
      if (verb === "BEGIN") inTransaction = true;
      if (verb === "COMMIT" || verb === "ROLLBACK") inTransaction = false;
      if (/INSERT INTO doc_sequence/i.test(sql)) return { rows: [{ seq: 7 }] };
      if (/FROM corporate_entity/i.test(sql)) return { rows: [{ doc_prefix: null }] };
      if (/FROM setting/i.test(sql)) return { rows: [] };
      if (/FROM lead/i.test(sql)) return { rows: [{ entity_id: null }] };
      // The stage writes lock their row first; it is the row `repo.get` answers.
      if (/FROM quote_request WHERE quote_request_id = \$1 FOR UPDATE/i.test(sql)) {
        const row = await repo.get(null, params && params[0]);
        return { rows: row ? [row] : [] };
      }
      return { rows: [] };
    }),
  };
}

let client;
beforeEach(() => {
  jest.clearAllMocks();
  client = makeClient();
  repo.defaultEntityId.mockResolvedValue(ENTITY);
  repo.get.mockResolvedValue({ quote_request_id: QR, status: "QUOTED", stage: "QUOTED", lead_id: "LEAD-1", owner_user_id: null, converted_opportunity_id: null });
  repo.insert.mockImplementation(async (_c, data) => ({ quote_request_id: QR, ...data }));
  repo.update.mockImplementation(async (_c, id, fields) => ({ quote_request_id: id, ...fields }));
  repo.addAttachment.mockImplementation(async (_c, d) => ({ quote_request_attachment_id: "att-1", ...d }));
  repo.demotePrimary.mockResolvedValue(undefined);
  repo.WRITABLE = jest.requireActual("../../src/modules/sales/quote_request/quote_request.repo").WRITABLE;
});

/* ── 1. The reference. Create used to 422 on every call. ─────────────────── */

describe("public reference", () => {
  test("a create allocates a reference instead of failing on a null entity", async () => {
    const row = await service.create(client, { data: { incoterm: "FOB" }, actor: { user_id: null } });
    // The tenant's seeded scheme supplies the SQ prefix; with no `setting` row
    // (as here) the module token still puts SQ in the reference, and the
    // sequence and year come from doc_sequence. What matters is that a
    // reference exists at all — this call used to throw 422 NO_ENTITY.
    expect(row.public_ref).toMatch(/SQ/);
    expect(row.public_ref).toMatch(new RegExp(`${new Date().getUTCFullYear()}-0007$`));
    expect(row.entity_id).toBe(ENTITY);
  });

  test("the reference is written in the SAME statement as the row, not by a follow-up update", async () => {
    await service.create(client, { data: { incoterm: "FOB" }, actor: {} });
    expect(repo.insert).toHaveBeenCalledTimes(1);
    expect(repo.insert.mock.calls[0][1].public_ref).toEqual(expect.stringContaining("SQ-"));
    expect(repo.update).not.toHaveBeenCalled();
  });

  test("allocation happens inside the transaction, so a rolled-back create burns no number", async () => {
    repo.insert.mockRejectedValueOnce(new Error("boom"));
    await expect(service.create(client, { data: { incoterm: "FOB" }, actor: {} })).rejects.toThrow("boom");
    expect(client.calls).toContain("BEGIN");
    expect(client.calls).toContain("ROLLBACK");
    const beganBeforeAllocating = client.calls.indexOf("BEGIN") < client.calls.indexOf("INSERT");
    expect(beganBeforeAllocating).toBe(true);
  });

  test("a tenant with two corporate entities is asked, not guessed at", async () => {
    repo.defaultEntityId.mockResolvedValue(null);
    await expect(service.create(client, { data: { incoterm: "FOB" }, actor: {} }))
      .rejects.toMatchObject({ code: "ENTITY_REQUIRED", status: 422 });
  });

  test("the intake register has its own numbering token — it does not share the lead counter", async () => {
    const cfg = await numbering.schemeFor(client, "MOD-20-INTAKE");
    expect(cfg.code).toBe("SQ");
    const leadCfg = await numbering.schemeFor(client, "MOD-20");
    expect(leadCfg.code).not.toBe(cfg.code);
  });
});

/* ── 2. The KPI tiles must partition the set. ────────────────────────────── */

describe("KPI tiles", () => {
  // Since the Sales lean revamp (PR 6) the tiles are the request's STAGES:
  // `status` is written in step until PR 7 drops it, and read by nothing.
  test("every stage has a tile — the set is derived, not hand-listed", () => {
    for (const s of rules.STAGES) expect(rules.KPI_TILES).toContain(s);
    expect(rules.KPI_TILES).toContain("TOTAL");
    for (const s of rules.STATUSES.filter((x) => !rules.STAGES.includes(x))) expect(rules.KPI_TILES).not.toContain(s);
  });

  test("the settled stages are counted beside the open ones", () => {
    const kpi = rules.kpiFrom([
      { stage: "NEW", c: 3 },
      { stage: "WON", c: 2 },
      { stage: "LOST", c: 4 },
    ]);
    expect(kpi.WON).toBe(2);
    expect(kpi.LOST).toBe(4);
    expect(kpi.TOTAL).toBe(9);
  });

  test("the tiles sum to TOTAL for every stage", () => {
    const kpi = rules.kpiFrom(rules.STAGES.map((s, i) => ({ stage: s, c: i + 1 })));
    expect(rules.assertPartitions(kpi)).toBe(true);
    const sum = rules.STAGES.reduce((n, s) => n + kpi[s], 0);
    expect(sum).toBe(kpi.TOTAL);
  });

  test("an unrecognised stage surfaces as OTHER rather than unbalancing the tiles", () => {
    const kpi = rules.kpiFrom([{ stage: "NEW", c: 1 }, { stage: "LEGACY_JUNK", c: 5 }]);
    expect(kpi.OTHER).toBe(5);
    expect(rules.assertPartitions(kpi)).toBe(true);
  });

  test("the service refuses to answer with tiles that do not add up", async () => {
    repo.list.mockResolvedValue({ rows: [], total: 0, kpiRows: [{ stage: "NEW", c: 2 }], limit: 50, offset: 0 });
    const spy = jest.spyOn(rules, "kpiFrom").mockReturnValue({ TOTAL: 9, NEW: 2 });
    await expect(service.list(client, {})).rejects.toMatchObject({ code: "KPI_NOT_PARTITIONED" });
    spy.mockRestore();
  });

  test("the KPI query keeps every filter EXCEPT stage, and status is no filter at all", () => {
    // The repo is mocked for the service tests, so assert on the real builder —
    // one WHERE function serves the list, the total, the KPI and the export, and
    // `includeStage` is the only thing that differs between them.
    const real = jest.requireActual("../../src/modules/sales/quote_request/quote_request.repo");
    const listed = real.buildWhere({ stage: "QUOTED", intake_channel: "WEBSITE" });
    const kpiOnly = real.buildWhere({ stage: "QUOTED", intake_channel: "WEBSITE" }, { includeStage: false });
    expect(listed.where).toContain("q.stage =");
    expect(kpiOnly.where).not.toContain("stage =");
    expect(kpiOnly.where).toContain("intake_channel =");
    // The old intake vocabulary filters nothing (lean revamp PR 6).
    expect(real.buildWhere({ status: "QUOTED" }).where).toBe("");
  });

  test("an old opportunity link finds the request it became, and a bad id finds nothing", () => {
    // PR 3: /sales/opportunities/:id resolves through ?converted_opportunity_id=
    // (14512 set it on every request an opportunity became).
    const real = jest.requireActual("../../src/modules/sales/quote_request/quote_request.repo");
    const id = "11111111-2222-4333-8444-555555555555";
    const hit = real.buildWhere({ converted_opportunity_id: id });
    expect(hit.where).toContain("q.converted_opportunity_id = $1");
    expect(hit.params).toEqual([id]);
    // Not a uuid: no filter rather than a 22P02 from Postgres.
    expect(real.buildWhere({ converted_opportunity_id: "x'; drop" }).params).toEqual([]);
  });
});

/* ── 3. The request is the deal (lean revamp PR 2): its stage. ───────────── */

describe("the deal's stage", () => {
  const row = (stage, extra = {}) => ({ quote_request_id: QR, lead_id: "LEAD-1", stage, status: rules.statusForStage(stage), ...extra });

  test("a click on the bar moves the stage, and the old status follows it", async () => {
    repo.get.mockResolvedValue(row("CONTACTED"));
    await service.moveStage(client, { id: QR, stage: "MEETING", actor: {} });
    expect(repo.update).toHaveBeenCalledWith(client, QR, { stage: "MEETING", status: "UNDER_REVIEW" });
  });

  test("an automatic move only goes forward, and is nothing on a request further along", async () => {
    repo.get.mockResolvedValue(row("QUOTED"));
    await service.moveStage(client, { id: QR, stage: "MEETING", actor: {}, auto: true });
    expect(repo.update).not.toHaveBeenCalled();
    repo.get.mockResolvedValue(row("WON", { settled_at: "2026-11-01" }));
    await service.moveStage(client, { id: QR, stage: "QUOTED", actor: {}, auto: true });
    expect(repo.update).not.toHaveBeenCalled();
  });

  test("nothing leaves Won or Lost, and nothing clicks into Won", async () => {
    repo.get.mockResolvedValue(row("LOST", { settled_at: "2026-11-01" }));
    await expect(service.moveStage(client, { id: QR, stage: "CONTACTED", actor: {} })).rejects.toMatchObject({ code: "REQUEST_SETTLED" });
    repo.get.mockResolvedValue(row("QUOTED"));
    await expect(service.moveStage(client, { id: QR, stage: "WON", actor: {} })).rejects.toMatchObject({ code: "BAD_STATE" });
  });

  test("Lost says why, and is dated", async () => {
    repo.get.mockResolvedValue(row("QUOTED"));
    await expect(service.markLost(client, { id: QR, reasonCode: null, actor: {} })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await service.markLost(client, { id: QR, reasonCode: "PRICE", reason: "Cheaper elsewhere", actor: {} });
    const fields = repo.update.mock.calls[0][2];
    expect(fields).toMatchObject({ stage: "LOST", status: "CLOSED_NO_ACTION", lost_reason_code: "PRICE", lost_reason: "Cheaper elsewhere" });
    expect(fields.settled_at).toBeTruthy();
  });

  test("an old intake transition moves the stage forward with it", async () => {
    repo.get.mockResolvedValue(row("NEW", { status: "RECEIVED" }));
    await service.transition(client, { id: QR, to: "UNDER_REVIEW", actor: {} });
    expect(repo.update.mock.calls[0][2]).toMatchObject({ status: "UNDER_REVIEW", stage: "CONTACTED" });
  });

  test("joining an outer transaction never commits it early", async () => {
    repo.get.mockResolvedValue(row("NEW"));
    await atomically(client, () => service.moveStage(client, { id: QR, stage: "CONTACTED", actor: {} }));
    expect(client.calls.filter((v) => v === "BEGIN")).toHaveLength(1);
    expect(client.calls.filter((v) => v === "COMMIT")).toHaveLength(1);
  });

  test("convert-to-opportunity is gone: the request is won, not converted", () => {
    expect(service.convertToOpportunity).toBeUndefined();
  });
});

/* ── 4. An attachment upload that fails leaves no orphan. ────────────────── */

describe("attachments", () => {
  const dataUrl = "data:application/pdf;base64," + Buffer.from("%PDF-1.4 hello").toString("base64");

  beforeEach(() => {
    repo.get.mockResolvedValue({ quote_request_id: QR, status: "UNDER_REVIEW", converted_opportunity_id: null });
    vault.createDocument.mockResolvedValue({ doc_id: "doc-1", storage_path: "tenant_x/vault/doc_ab.pdf", original_name: "packing.pdf", content_hash: "hash" });
    storage.delete.mockResolvedValue(undefined);
  });

  test("bytes and link are written in one transaction", async () => {
    const out = await service.uploadAttachment(client, { id: QR, dataUrl, filename: "packing.pdf", slug: "x", actor: {} });
    expect(out.vault_id).toBe("doc-1");
    expect(client.calls).toContain("BEGIN");
    expect(client.calls).toContain("COMMIT");
  });

  test("a failure after the bytes are stored deletes the stored object", async () => {
    repo.addAttachment.mockRejectedValueOnce(new Error("link failed"));
    await expect(service.uploadAttachment(client, { id: QR, dataUrl, slug: "x", actor: {} })).rejects.toThrow("link failed");
    expect(client.calls).toContain("ROLLBACK");
    expect(storage.delete).toHaveBeenCalledWith("tenant_x/vault/doc_ab.pdf");
  });

  test("a cleanup that itself fails does not mask the original error", async () => {
    repo.addAttachment.mockRejectedValueOnce(new Error("link failed"));
    storage.delete.mockRejectedValueOnce(new Error("storage down"));
    await expect(service.uploadAttachment(client, { id: QR, dataUrl, slug: "x", actor: {} })).rejects.toThrow("link failed");
  });

  test("a rejected file stores nothing at all", async () => {
    vault.createDocument.mockRejectedValueOnce(Object.assign(new Error("bad type"), { code: "BAD_FILE_TYPE" }));
    await expect(service.uploadAttachment(client, { id: QR, dataUrl, slug: "x", actor: {} })).rejects.toThrow("bad type");
    expect(storage.delete).not.toHaveBeenCalled();
    expect(repo.addAttachment).not.toHaveBeenCalled();
  });

  test("uploads are sniffed — the vault is asked to check the bytes, not the label", async () => {
    await service.uploadAttachment(client, { id: QR, dataUrl, slug: "x", actor: {} });
    expect(vault.createDocument.mock.calls[0][1]).toMatchObject({ sniff: true, docType: "QUOTE_REQUEST_ATTACHMENT" });
  });

  test("promoting a new PRIMARY demotes the old one, so there is never two", async () => {
    await service.uploadAttachment(client, { id: QR, dataUrl, kind: "PRIMARY", slug: "x", actor: {} });
    expect(repo.demotePrimary).toHaveBeenCalledWith(client, QR);
  });

  test("a won request refuses new attachments", async () => {
    repo.get.mockResolvedValue({ quote_request_id: QR, status: "CONVERTED_TO_OPPORTUNITY", stage: "WON" });
    await expect(service.uploadAttachment(client, { id: QR, dataUrl, slug: "x", actor: {} }))
      .rejects.toMatchObject({ code: "LOCKED" });
    expect(vault.createDocument).not.toHaveBeenCalled();
  });
});

/* ── 5. The CSV export is not silently truncated. ────────────────────────── */

describe("CSV export", () => {
  test("the export path is unpaginated — it does not go through the 200-row clamp", async () => {
    repo.listForExport.mockResolvedValue({ rows: [{ public_ref: "SQ-1" }], truncated: false });
    await service.listForExport(client, { status: "QUOTED" });
    expect(repo.listForExport).toHaveBeenCalledWith(client, { status: "QUOTED" }, service.EXPORT_CAP);
    expect(repo.list).not.toHaveBeenCalled();
  });

  test("truncation is reported rather than hidden", async () => {
    repo.listForExport.mockResolvedValue({ rows: [], truncated: true });
    const out = await service.listForExport(client, {});
    expect(out.truncated).toBe(true);
  });
});

/* ── 6. The lifecycle stays an INTAKE lifecycle. ─────────────────────────── */

describe("intake status is not a pipeline stage", () => {
  test("no intake status is also a pipeline stage code", () => {
    // The seeded pipeline stages (9030_seed_reference + F7's PRICING_IN_PROGRESS).
    const PIPELINE = ["NEW", "QUALIFIED", "PROPOSAL", "PRICING_IN_PROGRESS", "QUOTATION_SENT", "NEGOTIATION", "WON", "LOST"];
    for (const s of rules.STATUSES) expect(PIPELINE).not.toContain(s);
  });

  test("no intake status is also a lead funnel state", () => {
    const LEAD = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST"];
    for (const s of rules.STATUSES) expect(LEAD).not.toContain(s);
  });

  test("a settled deal (won or lost) is locked against edits", async () => {
    repo.get.mockResolvedValue({ quote_request_id: QR, status: "CLOSED_NO_ACTION", stage: "LOST" });
    await expect(service.update(client, { id: QR, patch: { incoterm: "CIF" }, actor: {} }))
      .rejects.toMatchObject({ code: "LOCKED" });
  });

  test("the reference and the entity are not patchable after allocation", async () => {
    repo.get.mockResolvedValue({ quote_request_id: QR, status: "RECEIVED", stage: "NEW" });
    await service.update(client, { id: QR, patch: { public_ref: "SQ-9999", entity_id: ENTITY, incoterm: "CIF" }, actor: {} });
    const fields = repo.update.mock.calls[0][2];
    expect(fields).not.toHaveProperty("public_ref");
    expect(fields).not.toHaveProperty("entity_id");
    expect(fields.incoterm).toBe("CIF");
  });
});
