/**
 * A website service's member types and its quote routing rules (14640): what
 * Master Data may and may not save. Each refusal names the field it is about.
 */
"use strict";

jest.mock("../../src/modules/operations/service_type_web/service_type_web.repo", () => ({
  serviceTypeExists: jest.fn(async () => true),
  lockProfile: jest.fn(async () => ({ service_type_id: "SEA" })),
  getProfile: jest.fn(async () => null),
  emptyProfile: jest.fn((id) => ({ service_type_id: id })),
  serviceTypeForPublish: jest.fn(async (_c, id) => ({ service_type_id: id, name_en: "Sea Freight Import", is_active: true, key: "SEA_FREIGHT_IMPORT", transport_mode: "SEA" })),
  listFaq: jest.fn(async () => []),
  listRelated: jest.fn(async () => []),
  membersOf: jest.fn(async () => []),
  listMembers: jest.fn(async () => []),
  routeRules: jest.fn(async () => []),
  memberHolders: jest.fn(async () => []),
  replaceMembers: jest.fn(async () => []),
  replaceRules: jest.fn(async () => []),
  IMAGE_TYPES: ["image/png"],
}));
jest.mock("../../src/modules/site/site_settings/site_switches", () => ({ load: jest.fn(async () => ({ languages: ["en"] })) }));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(), audit: jest.fn(), resolveActorId: jest.fn(async () => null),
}));
jest.mock("../../src/shared/db/tx", () => ({ atomically: jest.fn((client, fn) => fn(client)) }));
jest.mock("../../src/modules/vault/document_vault/document_vault.service", () => ({ createDocument: jest.fn() }));
jest.mock("../../src/services/storage.service", () => ({ get: jest.fn(), delete: jest.fn() }));

const { quoteEngine } = require("@praxis/shared");
const repo = require("../../src/modules/operations/service_type_web/service_type_web.repo");
const service = require("../../src/modules/operations/service_type_web/service_type_web.service");

const SEA = "11111111-1111-4111-8111-111111111111";
const EXP = "22222222-2222-4222-8222-222222222222";
const E2E = "33333333-3333-4333-8333-333333333333";
const client = (activeIds = [EXP, E2E]) => ({
  query: jest.fn(async (sql) => (/is_active = true/.test(sql) ? { rows: activeIds.map((service_type_id) => ({ service_type_id })) } : { rows: [] })),
});

beforeEach(() => jest.clearAllMocks());

describe("members", () => {
  test("a website service lists the other types it quotes for", async () => {
    await service.replaceMembers(client(), { serviceTypeId: SEA, memberIds: [EXP, E2E, EXP] });
    expect(repo.replaceMembers).toHaveBeenCalledWith(expect.anything(), SEA, [EXP, E2E]);
  });

  test("its own type is refused: it is always a member", async () => {
    await expect(service.replaceMembers(client(), { serviceTypeId: SEA, memberIds: [SEA] }))
      .rejects.toMatchObject({ code: "MEMBER_IS_SELF", status: 422 });
  });

  test("an inactive type is refused", async () => {
    await expect(service.replaceMembers(client([EXP]), { serviceTypeId: SEA, memberIds: [EXP, E2E] }))
      .rejects.toMatchObject({ code: "MEMBER_INVALID", details: { member_service_type_ids: [`${E2E} is not an active service type`] } });
  });

  test("a type already under another website service is refused, with the holder named", async () => {
    repo.memberHolders.mockResolvedValueOnce([{ service_type_id: EXP, held_as: "MEMBER", holder_name_en: "Air Freight Export" }]);
    await expect(service.replaceMembers(client(), { serviceTypeId: SEA, memberIds: [EXP] }))
      .rejects.toMatchObject({ code: "MEMBER_TAKEN", details: { member_service_type_ids: ["already quoted under Air Freight Export"] } });
    expect(repo.replaceMembers).not.toHaveBeenCalled();
  });
});

describe("routing rules", () => {
  test("the generic set must cover all twelve cells", async () => {
    await expect(service.replaceRules(client(), { rows: quoteEngine.DEFAULT_RULES.slice(1) }))
      .rejects.toMatchObject({ code: "ROUTING_INVALID", details: { rows: [expect.stringMatching(/no generic rule for IMPORT O/)] } });
    await service.replaceRules(client(), { rows: quoteEngine.DEFAULT_RULES });
    expect(repo.replaceRules).toHaveBeenCalledWith(expect.anything(), null, expect.any(Array));
  });

  test("a service's own rules may be partial, and may name one of its own types", async () => {
    repo.membersOf.mockResolvedValueOnce([{ service_type_id: SEA }, { service_type_id: E2E }]);
    await service.replaceRules(client(), {
      serviceTypeId: SEA,
      rows: [{ direction: "IMPORT", span: "D", outcome: "TYPE", service_type_id: E2E }],
    });
    expect(repo.replaceRules.mock.calls[0][2][0]).toMatchObject({ website_service_id: SEA, outcome: "TYPE", service_type_id: E2E });
  });

  test("naming a type that is not a member is refused", async () => {
    repo.membersOf.mockResolvedValueOnce([{ service_type_id: SEA }]);
    await expect(service.replaceRules(client(), {
      serviceTypeId: SEA,
      rows: [{ direction: "IMPORT", span: "D", outcome: "TYPE", service_type_id: E2E }],
    })).rejects.toMatchObject({ code: "ROUTING_INVALID", details: { "rows.0.service_type_id": expect.any(Array) } });
  });

  test("an export cell cannot route to an import service, and a cell is set once", async () => {
    await expect(service.replaceRules(client(), {
      serviceTypeId: SEA,
      rows: [{ direction: "EXPORT", span: "O", outcome: "IMPORT" }],
    })).rejects.toMatchObject({ details: { "rows.0.outcome": expect.any(Array) } });
    await expect(service.replaceRules(client(), {
      serviceTypeId: SEA,
      rows: [{ direction: "IMPORT", span: "D", outcome: "DESK" }, { direction: "IMPORT", span: "D", outcome: "IMPORT" }],
    })).rejects.toMatchObject({ details: { "rows.1.span": ["this cell already has a rule"] } });
  });
});

describe("the tab shows the website service", () => {
  test("members, rules, the engine's warnings and a preview of where each term lands", async () => {
    repo.membersOf.mockResolvedValueOnce([
      { service_type_id: SEA, name_en: "Sea Freight Import", territory: "INTERNATIONAL_IMPORT", incoterms: quoteEngine.INCOTERM_CODES },
      { service_type_id: E2E, name_en: "End-to-End Sea Freight", territory: "END_TO_END_INTERNATIONAL", incoterms: quoteEngine.INCOTERM_CODES },
    ]);
    repo.routeRules.mockResolvedValueOnce(quoteEngine.DEFAULT_RULES.map((r) => ({ ...r })));
    const tab = await service.getTab(client(), SEA);
    expect(tab.routing.kind).toBe("FREIGHT");
    const ddp = tab.routing.preview.find((p) => p.direction === "IMPORT" && p.incoterm === "DDP");
    expect(ddp).toMatchObject({ outcome: "RESOLVED", service_type_id: E2E, span: "OMD" });
    const cif = tab.routing.preview.find((p) => p.direction === "IMPORT" && p.incoterm === "CIF");
    expect(cif).toMatchObject({ outcome: "RESOLVED", service_type_id: SEA });
    expect(tab.engine_warnings).toEqual([]);
  });
});
