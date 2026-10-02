"use strict";

/**
 * Meeting 6, PR 4, owner decision G1 — "Create quotation" on a costing.
 *
 * One click on a validated or approved costing opens a DRAFT quotation priced
 * with the margin simulator's own rules:
 *
 *   · débours pass through AT COST, with no margin and no VAT;
 *   · our services are priced at the tenant's target margin (priceForMargin);
 *   · own-cost lines (the catalogue's EXPENSE / ASSET siblings) are NOT billed —
 *     they set the floor the services must cover, and are shown as such;
 *   · families, container types, tax codes and quantities cross intact;
 *   · the workings are kept as a margin simulation linked both ways.
 *
 * The property the owner asked to be pinned: a quotation priced directly
 * EQUALS what the simulator would produce for the same costing at the same
 * margin.
 */
const {
  computeMargin,
  priceForMargin,
  priceCostingLines,
  classifyLine,
} = require("../../src/modules/commercial/margin_simulation/margin_simulation.rules");
const { computeTotals } = require("../../src/modules/commercial/quotation/quotation.rules");

jest.mock("../../src/shared/events/emit", () => ({
  audit: jest.fn(async () => {}),
  emitEvent: jest.fn(async () => {}),
  resolveActorId: jest.fn(async (_c, id) => id),
}));

// Settings: the tenant VAT rate falls back to 19.25, the target margin is 20 %.
jest.mock("../../src/shared/config/settings", () => ({
  getRule: jest.fn(async (_c, section, key, field, fallback) =>
    section === "commercial" && key === "quotation" && field === "target_margin_percent" ? 20 : fallback),
  getSetting: jest.fn(async () => null),
  putSetting: jest.fn(async () => {}),
}));

const { emitEvent } = require("../../src/shared/events/emit");
const quotation = require("../../src/modules/commercial/quotation/quotation.service");

const UUID = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

/** A costing line as the LINK COSTING read returns it, with its catalogue nature. */
const costingLines = () => [
  // A service we sell (REVENUE), taxed, in the "Customs Formalities" family.
  { dictionary_item_id: UUID(11), label: "Clearance fee", qty: 2, unit_cost: 100000, is_disbursement: false, tax_code_id: UUID(90), client_heading: "CUSTOMS", container_type_ref_id: UUID(70), dict_direction: "REVENUE", dict_category: "service", dict_is_disbursement: false },
  // A débours: money advanced for the client. The costing even carries a tax
  // code on it — the catalogue wins, and a débours is never taxed.
  { dictionary_item_id: UUID(12), label: "Customs duties", qty: 1, unit_cost: 450000, is_disbursement: true, tax_code_id: null, client_heading: "CUSTOMS", container_type_ref_id: null, dict_direction: "DISBURSEMENT", dict_category: "disbursement", dict_is_disbursement: true },
  // Our own cost: the truck we hire in. Not billed; the floor.
  { dictionary_item_id: UUID(13), label: "Transportation — Own Cost", qty: 1, unit_cost: 150000, is_disbursement: false, tax_code_id: UUID(90), client_heading: null, container_type_ref_id: UUID(70), dict_direction: "EXPENSE", dict_category: "expense", dict_is_disbursement: false },
  // The service the client is billed for that movement.
  { dictionary_item_id: UUID(14), label: "Transportation", qty: 1, unit_cost: 160000, is_disbursement: false, tax_code_id: UUID(90), client_heading: "TRANSPORT", container_type_ref_id: UUID(70), dict_direction: "REVENUE", dict_category: "service", dict_is_disbursement: false },
];

/** The same mapping `margin_simulation.service.fromCosting` applies. */
const asLinked = (rows) => rows.map((l) => {
  const n = classifyLine({ is_disbursement: l.is_disbursement, vat_applicable: !!l.tax_code_id }, { direction: l.dict_direction, category: l.dict_category, is_disbursement: l.dict_is_disbursement });
  return {
    dictionary_item_id: l.dictionary_item_id, label: l.label, qty: l.qty, unit_cost: l.unit_cost, unit_price: 0,
    is_disbursement: n.is_disbursement, vat_applicable: n.vat_applicable, cost_nature: n.nature,
    client_heading: l.client_heading, container_type_ref_id: l.container_type_ref_id, tax_code_id: n.vat_applicable ? l.tax_code_id : null,
  };
});

describe("priceCostingLines — the simulator's rules in one pass", () => {
  const out = priceCostingLines(asLinked(costingLines()), { targetMarginPercent: 20, vatRatePercent: 19.25 });

  it("bills débours at cost, without VAT", () => {
    const d = out.billed.find((l) => l.label === "Customs duties");
    expect(d.unit_price).toBe(450000);
    expect(d.is_disbursement).toBe(true);
    expect(d.vat_applicable).toBe(false);
  });

  it("prices services at the target margin (margin on price)", () => {
    const fee = out.billed.find((l) => l.label === "Clearance fee");
    expect(fee.unit_price).toBe(125000); // 100 000 / (1 − 0.20)
    expect(fee.unit_price).toBe(priceForMargin(100000, 20));
    const svc = out.billed.find((l) => l.label === "Transportation");
    expect(svc.unit_price).toBe(200000);
  });

  it("does not bill own costs, and keeps them as the floor", () => {
    expect(out.billed.map((l) => l.label)).not.toContain("Transportation — Own Cost");
    expect(out.own.map((l) => l.label)).toEqual(["Transportation — Own Cost"]);
    expect(out.floor.own_cost_total).toBe(150000);
    expect(out.floor.service_total).toBe(450000); // 2 × 125 000 + 200 000
    expect(out.floor.covered).toBe(true);
  });

  it("warns when the services do not cover the own costs", () => {
    const thin = priceCostingLines(asLinked([
      { ...costingLines()[2], unit_cost: 900000 },
      costingLines()[0],
    ]), { targetMarginPercent: 0 });
    expect(thin.floor.covered).toBe(false);
    expect(thin.floor.shortfall).toBe(700000); // 900 000 − 2 × 100 000
  });

  it("carries families, container types, tax codes and quantities intact", () => {
    const fee = out.billed.find((l) => l.label === "Clearance fee");
    expect(fee).toMatchObject({ qty: 2, client_heading: "CUSTOMS", container_type_ref_id: UUID(70), tax_code_id: UUID(90) });
  });

  it("keeps the own costs in the workings at price 0, so the margin is the file's real margin", () => {
    const own = out.workings.find((l) => l.label === "Transportation — Own Cost");
    expect(own.unit_price).toBe(0);
    // service cost 200 000 + 160 000 + 150 000 own; service price 450 000.
    expect(out.totals.service_cost).toBe(510000);
    expect(out.totals.margin_amount).toBe(-60000);
  });

  it("refuses a margin outside [0, 100)", () => {
    expect(() => priceCostingLines(asLinked(costingLines()), { targetMarginPercent: 100 })).toThrow(/below 100/);
  });

  it("refuses a costing that is all own cost — nothing to bill", () => {
    expect(() => priceCostingLines(asLinked([costingLines()[2]]), { targetMarginPercent: 10 })).toThrow(/nothing to bill/);
  });
});

describe("priced directly = what the simulator produces at the same margin", () => {
  /**
   * The simulator path, by hand, exactly as a pricer walks it: LINK COSTING,
   * price each service with "target margin %", leave each débours at cost,
   * then computeMargin — and `quote` maps the priced lines to the quotation.
   * Own-cost lines are not billed on either path.
   */
  function viaSimulator(lines, margin, vat) {
    const priced = lines
      .filter((l) => !(l.is_disbursement !== true && ["EXPENSE", "ASSET"].includes(l.cost_nature)))
      .map((l) => ({ ...l, unit_price: l.is_disbursement ? l.unit_cost : priceForMargin(l.unit_cost, margin) }));
    return {
      totals: computeMargin(priced, { vatRatePercent: vat }),
      quoteLines: priced.map((l) => ({ label: l.label, qty: l.qty, unit_price: l.unit_price, is_disbursement: l.is_disbursement, tax_code_id: l.vat_applicable && !l.is_disbursement ? l.tax_code_id : null })),
    };
  }

  it.each([0, 12.5, 20, 35])("at %s %%", (margin) => {
    const lines = asLinked(costingLines());
    const direct = priceCostingLines(lines, { targetMarginPercent: margin, vatRatePercent: 19.25 });
    const sim = viaSimulator(lines, margin, 19.25);
    const directLines = direct.billed.map((l) => ({ label: l.label, qty: l.qty, unit_price: l.unit_price, is_disbursement: l.is_disbursement, tax_code_id: l.is_disbursement ? null : l.tax_code_id }));
    expect(directLines).toEqual(sim.quoteLines);
    expect(computeTotals(directLines, 19.25)).toEqual(computeTotals(sim.quoteLines, 19.25));
    expect(computeMargin(direct.billed, { vatRatePercent: 19.25 })).toEqual(sim.totals);
  });
});

/* ── the service: one click, one transaction ───────────────────────────────── */

function fakeDb({ status = "APPROVED_LOCKED", requests = [] } = {}) {
  const store = { quotation: [], quotation_line: [], margin_simulation: [], margin_simulation_line: [] };
  const queries = [];
  let seq = 100;
  const next = () => UUID((seq += 1));
  const insertRow = (table, sql, params) => {
    const cols = sql.match(/\(([^)]*)\) VALUES/)[1].split(",").map((s) => s.trim().replace(/"/g, ""));
    const row = Object.fromEntries(cols.map((c, i) => [c, params[i]]));
    const pk = { quotation: "quotation_id", quotation_line: "quotation_line_id", margin_simulation: "margin_simulation_id", margin_simulation_line: "margin_simulation_line_id" }[table];
    row[pk] = row[pk] || next();
    store[table].push(row);
    return { rows: [row] };
  };
  const client = {
    store,
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params });
      let m;
      if ((m = sql.match(/^INSERT INTO (quotation_line|quotation|margin_simulation_line|margin_simulation) \(/))) return insertRow(m[1], sql, params);
      if (/FROM costing WHERE costing_id/.test(sql)) {
        return { rows: [{ costing_id: UUID(1), doc_number: "CST-2026-0043", dossier_id: UUID(2), currency: "XAF", exchange_rate_to_xaf: 1, status, family_order: ["TRANSPORT", "CUSTOMS"] }] };
      }
      if (/FROM dossier WHERE dossier_id/.test(sql)) return { rows: [{ client_id: UUID(3), entity_id: UUID(4), service_type_id: UUID(5), ref: "SBX-2026-0001" }] };
      if (/FROM costing_line/.test(sql)) return { rows: costingLines() };
      if (/FROM quote_request qr/.test(sql)) return { rows: requests };
      if (/FROM quote_request WHERE quote_request_id/.test(sql)) {
        const r = requests.find((x) => x.quote_request_id === params[0]);
        return { rows: r ? [{ ...r, client_id: UUID(3) }] : [] };
      }
      if (/FROM dictionary_item WHERE dictionary_item_id = ANY/.test(sql)) {
        return { rows: costingLines().map((l) => ({ dictionary_item_id: l.dictionary_item_id, code: l.label, direction: l.dict_direction, category: l.dict_category, is_disbursement: l.dict_is_disbursement })) };
      }
      if (/DELETE FROM quotation_line/.test(sql)) { store.quotation_line = store.quotation_line.filter((l) => l.quotation_id !== params[0]); return { rows: [] }; }
      if (/FROM quotation_line ql/.test(sql)) return { rows: store.quotation_line.filter((l) => l.quotation_id === params[0]) };
      if (/^UPDATE "?quotation"? SET/.test(sql) || /^UPDATE quotation SET/.test(sql)) {
        const row = store.quotation.find((q) => q.quotation_id === params[0]);
        return { rows: row ? [row] : [] };
      }
      if (/FROM "?quotation"? WHERE "?quotation_id"?/.test(sql)) return { rows: store.quotation.filter((q) => q.quotation_id === params[0]) };
      if (/FROM margin_simulation WHERE quotation_id/.test(sql)) return { rows: store.margin_simulation.filter((s) => s.quotation_id === params[0]) };
      if (/FROM "?margin_simulation"? WHERE "?margin_simulation_id"?/.test(sql)) return { rows: store.margin_simulation.filter((s) => s.margin_simulation_id === params[0]) };
      if (/FROM margin_simulation_line WHERE/.test(sql)) return { rows: store.margin_simulation_line.filter((l) => l.margin_simulation_id === params[0]) };
      return { rows: [] };
    },
  };
  return client;
}

describe("createFromCosting — one click", () => {
  beforeEach(() => jest.clearAllMocks());
  const actor = { user_id: UUID(9) };

  it("opens a DRAFT linked to the costing, priced at the target margin, with its workings", async () => {
    const db = fakeDb();
    const out = await quotation.createFromCosting(db, { costingId: UUID(1), actor });
    const q = db.store.quotation[0];
    expect(q).toMatchObject({ status: "DRAFT", costing_id: UUID(1), client_id: UUID(3), entity_id: UUID(4), dossier_id: UUID(2), created_from: "COSTING", margin_percent: 20, own_cost_total: 150000 });
    expect(JSON.parse(q.family_order)).toEqual(["TRANSPORT", "CUSTOMS"]);

    const lines = db.store.quotation_line;
    expect(lines.map((l) => l.label)).toEqual(["Clearance fee", "Customs duties", "Transportation"]);
    expect(lines.find((l) => l.label === "Customs duties")).toMatchObject({ unit_price: 450000, is_disbursement: true, tax_code_id: null });
    expect(lines.find((l) => l.label === "Clearance fee")).toMatchObject({ unit_price: 125000, qty: 2, tax_code_id: UUID(90), client_heading: "CUSTOMS", container_type_ref_id: UUID(70) });

    // The workings: a simulation marked COSTING_DIRECT, linked both ways,
    // with every costing line — the own cost at price 0.
    const sim = db.store.margin_simulation[0];
    expect(sim).toMatchObject({ origin: "COSTING_DIRECT", costing_id: UUID(1), quotation_id: q.quotation_id, target_margin_percent: 20 });
    expect(db.store.margin_simulation_line).toHaveLength(4);
    expect(db.store.margin_simulation_line.find((l) => l.label === "Transportation — Own Cost").unit_price).toBe(0);

    expect(out.floor).toMatchObject({ own_cost_total: 150000, covered: true });
    expect(emitEvent).toHaveBeenCalledWith(db, expect.objectContaining({ eventTypeKey: "quotation.created_from_costing" }));
  });

  it("links the one open request of this client for this service", async () => {
    const req = { quote_request_id: UUID(50), public_ref: "SQ-2026-0003", status: "UNDER_REVIEW", service_type_id: UUID(5), created_at: "2026-09-29", answered: false };
    const db = fakeDb({ requests: [req] });
    await quotation.createFromCosting(db, { costingId: UUID(1), actor });
    expect(db.store.quotation[0].quote_request_id).toBe(UUID(50));
  });

  it("links none when the pricer says none", async () => {
    const req = { quote_request_id: UUID(50), public_ref: "SQ-2026-0003", status: "UNDER_REVIEW", service_type_id: UUID(5), created_at: "2026-09-29", answered: false };
    const db = fakeDb({ requests: [req] });
    await quotation.createFromCosting(db, { costingId: UUID(1), quoteRequestId: null, actor });
    expect(db.store.quotation[0].quote_request_id).toBeNull();
  });

  it.each(["DRAFT", "SUBMITTED_FOR_VALIDATION", "REJECTED"])("refuses a %s costing with the reason", async (status) => {
    await expect(quotation.createFromCosting(fakeDb({ status }), { costingId: UUID(1), actor }))
      .rejects.toMatchObject({ code: "COSTING_NOT_READY", status: 422 });
  });

  it.each(["SUBMITTED_FOR_APPROVAL", "APPROVED_LOCKED", "UNLOCK_REQUESTED"])("accepts a %s costing", async (status) => {
    const db = fakeDb({ status });
    await quotation.createFromCosting(db, { costingId: UUID(1), actor });
    expect(db.store.quotation).toHaveLength(1);
  });

  it("the preview writes nothing", async () => {
    const db = fakeDb();
    const p = await quotation.fromCostingPreview(db, { costingId: UUID(1) });
    expect(p.target_margin_percent).toBe(20);
    expect(p.totals.total_ht).toBe(900000); // 250 000 + 450 000 + 200 000
    expect(db.store.quotation).toHaveLength(0);
    expect(db.queries.some((q) => /^INSERT/.test(q.sql))).toBe(false);
  });
});
