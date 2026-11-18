"use strict";
/**
 * The Quotations list and staff Decline (lean revamp PR 6, §3.4).
 *
 *   list     one page and its total; the totals are money-gated as the Leads
 *            list gates its value: without finance visibility a total is null,
 *            never zero, and the share token's hash never leaves
 *   decline  staff record a client's no with a reason from the SAME list the
 *            link offers, stored with the reason's words, answered via STAFF
 */
jest.mock("../../src/modules/commercial/quotation/quotation.repo", () => ({
  list: jest.fn(),
  get: jest.fn(),
  update: jest.fn(),
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => undefined),
  audit: jest.fn(async () => undefined),
  resolveActorId: jest.fn(async (_c, id) => id || null),
}));
jest.mock("../../src/shared/db/tx", () => ({ atomically: async (_c, fn) => fn() }));
jest.mock("../../src/services/signatures/presets", () => ({
  reasons: jest.fn(async () => [
    { reason_code: "PRICE", label_en: "Price too high", label_fr: "Prix trop élevé", kind: "DECLINE" },
    { reason_code: "OTHER", label_en: "Other", label_fr: "Autre", kind: "DECLINE" },
  ]),
}));

const repo = require("../../src/modules/commercial/quotation/quotation.repo");
const { emitEvent } = require("../../src/shared/events/emit");
const service = require("../../src/modules/commercial/quotation/quotation.service");

const ROW = { quotation_id: "q1", status: "SENT", total_ht: 100, total_ttc: 119.25, share_token_hash: "secret", share_expires_at: "2099-01-01", valid_until: "2099-01-01" };

describe("the Quotations list", () => {
  beforeEach(() => repo.list.mockResolvedValue({ rows: [ROW], total: 7 }));

  test("a reader with finance visibility sees the totals and the true count", async () => {
    const out = await service.listPage({}, { status: "SENT" }, { canSeeFinancials: true });
    expect(out.total).toBe(7);
    expect(out.money_visible).toBe(true);
    expect(out.rows[0]).toMatchObject({ total_ht: 100, total_ttc: 119.25, share_active: true });
    expect(out.rows[0]).not.toHaveProperty("share_token_hash");
  });

  test("without it the totals are null, never zero", async () => {
    const out = await service.listPage({}, {}, { canSeeFinancials: false });
    expect(out.money_visible).toBe(false);
    expect(out.rows[0].total_ht).toBeNull();
    expect(out.rows[0].total_ttc).toBeNull();
  });

  test("the plain list still answers rows, for the callers that read it so", async () => {
    const rows = await service.list({}, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("share_token_hash");
  });
});

describe("Decline with a reason, recorded by staff", () => {
  const client = { query: jest.fn(async () => ({ rows: [{ ...ROW }] })) };

  beforeEach(() => {
    repo.get.mockResolvedValue({ ...ROW });
    repo.update.mockImplementation(async (_c, id, fields) => ({ ...ROW, ...fields }));
    emitEvent.mockClear();
  });

  test("the reasons are the link's own list, in both languages", async () => {
    expect(await service.declineReasons(client)).toEqual([
      { reason_code: "PRICE", label_en: "Price too high", label_fr: "Prix trop élevé" },
      { reason_code: "OTHER", label_en: "Other", label_fr: "Autre" },
    ]);
  });

  test("stores the reason's words and the note, answered via STAFF by the actor", async () => {
    const out = await service.declineByStaff(client, { id: "q1", reasonCode: "PRICE", note: "Went with the incumbent", actor: { user_id: "u1" } });
    expect(out.status).toBe("REJECTED");
    const fields = repo.update.mock.calls[0][2];
    expect(fields).toMatchObject({
      status: "REJECTED", answered_via: "STAFF", decline_reason_code: "PRICE", decline_reason: "Price too high: Went with the incumbent",
    });
    expect(emitEvent.mock.calls[0][1]).toMatchObject({ actorUserId: "u1" });
  });

  test("a code that is not on the list is refused, naming the ones there are", async () => {
    await expect(service.declineByStaff(client, { id: "q1", reasonCode: "NOPE" })).rejects.toMatchObject({ code: "UNKNOWN_DECLINE_REASON", status: 422 });
    expect(repo.update).not.toHaveBeenCalled();
  });

  test("only a SENT quotation can be declined", async () => {
    repo.get.mockResolvedValue({ ...ROW, status: "DRAFT" });
    await expect(service.declineByStaff(client, { id: "q1", reasonCode: "PRICE" })).rejects.toMatchObject({ code: "BAD_STATE" });
  });
});
