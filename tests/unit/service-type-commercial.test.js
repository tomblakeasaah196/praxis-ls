"use strict";
/**
 * The Commercial tab's eleven paged money blocks (MOD-29 → ST-360).
 *
 * These pin the four things that would otherwise be found by a reader looking
 * at a wrong number on a screen:
 *
 *   1. THE BLOCK NAME NEVER REACHES SQL. `blockPage` selects a frozen
 *      statement by key. A name that is not a key is an error, not a fragment
 *      interpolated into a query, and the validator refuses it one layer up.
 *   2. A REFUSAL IS NOT A ZERO. Each block is gated on the module that owns
 *      it; a tile whose source block is refused comes back `allowed: false`
 *      with null figures, because a zero and a refusal look identical on a
 *      tile and mean opposite things.
 *   3. FINANCE VISIBILITY ONLY EVER ADDS. The old tab gated its money on a
 *      Treasury read; the per-module gates must not take a block away from
 *      anybody who could see it before.
 *   4. THE ARITHMETIC. Win rate ignores undecided quotes, billed is net of
 *      credit notes, and both report null rather than 0 when there is nothing
 *      to divide by.
 *
 * The SQL itself is exercised against a real schema — see the probe in the PR
 * description; these tests are about the shapes and the rules around them.
 */
const repo = require("../../src/modules/operations/service_type/service_type_commercial.repo");
const service = require("../../src/modules/operations/service_type/service_type_commercial.service");
const validator = require("../../src/modules/operations/service_type/service_type.validator");

const ID = "st-1";

describe("commercial blocks", () => {
  test("the eleven blocks, their gates and their groups agree", () => {
    expect(repo.BLOCKS).toHaveLength(11);
    // Every block has a group and a gate entry (the gate may be null — exactly
    // one is, and the service header says which and why).
    for (const b of repo.BLOCKS) {
      expect(Object.prototype.hasOwnProperty.call(service.BLOCK_GATE, b)).toBe(true);
      expect(["sell", "bill", "spend"]).toContain(service.BLOCK_GROUP[b]);
    }
    const ungated = repo.BLOCKS.filter((b) => service.BLOCK_GATE[b] === null);
    expect(ungated).toEqual(["margin_sims"]);
  });

  test("every block's SQL is parameterised and ends with a stable sort", () => {
    for (const b of repo.BLOCKS) {
      const sql = repo.BLOCK_SQL[b];
      expect(sql).toContain("$1");
      expect(sql).toContain("LIMIT $2 OFFSET $3");
      expect(sql).toContain("COUNT(*) OVER()");
      // Without a tiebreak on the primary key, two documents created in the
      // same millisecond can swap between page 1 and page 2 — one row shown
      // twice, another never shown.
      expect(sql).toMatch(/ORDER BY[^;]*,\s*\w+\.?\w*\s*\n/);
      expect(sql).toContain("row_id");
    }
  });

  test("an unknown block name is an error, never interpolated SQL", async () => {
    const client = { query: jest.fn() };
    await expect(repo.blockPage(client, ID, "quotations; DROP TABLE invoice", {}))
      .rejects.toThrow(/Unknown commercial block/);
    // A prototype key must not resolve to a statement either.
    await expect(repo.blockPage(client, ID, "constructor", {})).rejects.toThrow();
    expect(client.query).not.toHaveBeenCalled();
  });

  test("blockPage asks for one page and splits the window total off", async () => {
    const serviceTypeRepo = require("../../src/modules/operations/service_type/service_type.repo");
    const originalFind = serviceTypeRepo.findById;
    serviceTypeRepo.findById = () => Promise.resolve({ service_type_id: ID });
    try {
      const client = {
        query: jest.fn().mockResolvedValue({
          rows: [
            { row_id: "a", total_ttc: "10.00", _total: "42" },
            { row_id: "b", total_ttc: "20.00", _total: "42" },
          ],
        }),
      };
      const out = await service.blockPage(client, ID, "quotations", { limit: 25, offset: 50 });
      expect(client.query).toHaveBeenCalledWith(repo.BLOCK_SQL.quotations, [ID, 25, 50]);
      expect(out.total).toBe(42);
      expect(out.rows).toHaveLength(2);
      // `_total` is a transport detail of the window function, not a column the
      // client should ever see.
      expect(out.rows[0]._total).toBeUndefined();
    } finally {
      serviceTypeRepo.findById = originalFind;
    }
  });

  test("a block page on a service type that does not exist is a 404, not an empty page", async () => {
    const serviceTypeRepo = require("../../src/modules/operations/service_type/service_type.repo");
    const originalFind = serviceTypeRepo.findById;
    serviceTypeRepo.findById = () => Promise.resolve(null);
    try {
      const client = { query: jest.fn() };
      expect(await service.blockPage(client, "nope", "quotations", {})).toBeNull();
      expect(client.query).not.toHaveBeenCalled();
    } finally {
      serviceTypeRepo.findById = originalFind;
    }
  });
});

describe("commercial access", () => {
  /** A request carrying exactly the module grants named. */
  function reqWith(modules, { ceo = false } = {}) {
    return {
      user: { role_ids: ["r1"], is_ceo: ceo },
      identityDb: (fn) =>
        fn({
          query: () => Promise.resolve({ rows: [] }),
        }),
      // readPermissions and canSeeFinancials both read the identity cache; stub
      // it rather than the functions, so the real resolution runs.
      __modules: modules,
    };
  }

  const cache = require("../../src/shared/cache/identity-cache");
  let original;
  beforeEach(() => {
    original = cache.getGrants;
  });
  afterEach(() => {
    cache.getGrants = original;
  });

  /** Grant `can_read` for the modules a test names, nothing for the rest. */
  function grantOnly(modules) {
    cache.getGrants = (_c, { module }) =>
      Promise.resolve(modules.includes(module) ? [{ can_read: true }] : []);
  }

  test("a block opens on its OWN module's view grant", async () => {
    grantOnly(["MOD-27"]);
    const { allowed, finance } = await service.access(reqWith(["MOD-27"]));
    expect(finance).toBe(false);
    // MOD-27 owns quotations, margin sims and pricing variance.
    expect(allowed.quotations).toBe(true);
    expect(allowed.pricing_variance).toBe(true);
    // ...and nothing else opens with it.
    expect(allowed.invoices).toBe(false);
    expect(allowed.supplier_invoices).toBe(false);
    expect(allowed.costings).toBe(false);
  });

  test("margin sims stay open on MOD-29 alone — the tab showed them before", async () => {
    grantOnly([]);
    const { allowed } = await service.access(reqWith([]));
    expect(allowed.margin_sims).toBe(true);
    expect(allowed.quotations).toBe(false);
  });

  test("finance visibility ONLY ADDS: a Treasury reader keeps every block", async () => {
    grantOnly(["MOD-09"]);
    const { allowed, finance } = await service.access(reqWith(["MOD-09"]));
    expect(finance).toBe(true);
    for (const b of repo.BLOCKS) expect(allowed[b]).toBe(true);
  });

  test("the CEO bypass opens everything", async () => {
    grantOnly([]);
    const { allowed } = await service.access(reqWith([], { ceo: true }));
    for (const b of repo.BLOCKS) expect(allowed[b]).toBe(true);
  });
});

describe("commercial KPIs", () => {
  const ALL = Object.fromEntries(repo.BLOCKS.map((b) => [b, true]));

  const SUMMARY = {
    quotations: [
      { currency: "XAF", doc_count: 3, total_ht: 1800000, total_ttc: 2146500, won: 2, decided: 3, won_ttc: 1788750 },
      { currency: "EUR", doc_count: 1, total_ht: 2000, total_ttc: 2385, won: 0, decided: 0, won_ttc: 0 },
    ],
    invoices: [{ currency: "XAF", invoice_count: 1, raised_count: 2, billed_ttc: 1392500, revenue_ht: 1000000 }],
    credit_notes: [{ currency: "XAF", doc_count: 1, credit_ttc: 119250 }],
    costings: [{ currency: "XAF", doc_count: 1, planned_total: 800000, planned_disbursement: 100000 }],
    actual_xaf: 700000,
  };

  test("win rate counts decided quotes only, across currencies", () => {
    const k = service.kpis(SUMMARY, ALL);
    // 2 won of 3 decided. The EUR quote is still SENT, so it is in neither.
    expect(k.win_rate.won).toBe(2);
    expect(k.win_rate.decided).toBe(3);
    expect(k.win_rate.percent).toBeCloseTo(66.67, 1);
  });

  test("nothing decided yet reports null, not a 0% win rate", () => {
    const k = service.kpis({ ...SUMMARY, quotations: [{ currency: "XAF", doc_count: 2, total_ttc: 10, won: 0, decided: 0 }] }, ALL);
    expect(k.win_rate.percent).toBeNull();
  });

  test("billed is net of credit notes, and the tile reads XAF only", () => {
    const k = service.kpis(SUMMARY, ALL);
    expect(k.billed_net.xaf).toBe(1392500 - 119250);
    const xaf = k.billed_net.by_currency.find((r) => r.currency === "XAF");
    expect(xaf.credit_ttc).toBe(119250);
    expect(xaf.net_ttc).toBe(1273250);
    // The quoted tile is XAF only; the euro quote is in the breakdown, not the
    // figure. Nothing is converted.
    expect(k.quoted.xaf).toBe(2146500);
    expect(k.quoted.by_currency).toHaveLength(2);
  });

  test("realised margin is billed net against the ledger, in XAF", () => {
    const k = service.kpis(SUMMARY, ALL);
    // (1,273,250 − 700,000) / 1,273,250
    expect(k.margin.percent).toBeCloseTo(45.02, 1);
  });

  test("nothing billed reports a null margin, not 0%", () => {
    const k = service.kpis({ ...SUMMARY, invoices: [], credit_notes: [] }, ALL);
    expect(k.margin.percent).toBeNull();
  });

  test("a refused block yields a refused tile, never a zero", () => {
    const k = service.kpis(SUMMARY, { ...ALL, quotations: false, invoices: false });
    expect(k.quoted.allowed).toBe(false);
    expect(k.quoted.xaf).toBeNull();
    expect(k.quoted.by_currency).toEqual([]);
    expect(k.win_rate.allowed).toBe(false);
    expect(k.win_rate.percent).toBeNull();
    expect(k.billed_net.xaf).toBeNull();
    // Margin needs both sides; losing one loses the tile rather than printing
    // a margin computed from half the facts.
    expect(k.margin.allowed).toBe(false);
    // The blocks that ARE allowed are untouched.
    expect(k.planned.allowed).toBe(true);
    expect(k.planned.xaf).toBe(800000);
  });

  test("a credit note in a currency with no invoice still shows, below zero", () => {
    const net = service.netBilled([], [{ currency: "EUR", doc_count: 1, credit_ttc: 500 }]);
    expect(net).toEqual([
      expect.objectContaining({ currency: "EUR", billed_ttc: 0, credit_ttc: 500, net_ttc: -500 }),
    ]);
  });
});

describe("commercial overview", () => {
  const serviceTypeRepo = require("../../src/modules/operations/service_type/service_type.repo");

  test("totals are null — not [] — for a block the caller may not read", async () => {
    const originalFind = serviceTypeRepo.findById;
    const originalSummary = repo.summary;
    serviceTypeRepo.findById = () => Promise.resolve({ service_type_id: ID });
    repo.summary = () =>
      Promise.resolve({
        ...Object.fromEntries(repo.BLOCKS.map((b) => [b, [{ currency: "XAF", doc_count: 1 }]])),
        actual_xaf: 10,
      });
    try {
      const allowed = Object.fromEntries(repo.BLOCKS.map((b) => [b, b === "margin_sims"]));
      const out = await service.overview({}, ID, { allowed, finance: false });
      expect(out.totals.margin_sims).toHaveLength(1);
      expect(out.totals.invoices).toBeNull();
      expect(out.actual_xaf).toBeNull();
      expect(out.blocks.find((b) => b.block === "invoices").allowed).toBe(false);
      expect(out.blocks.find((b) => b.block === "invoices").gate).toBe("MOD-51");
    } finally {
      serviceTypeRepo.findById = originalFind;
      repo.summary = originalSummary;
    }
  });
});

describe("commercial route validator", () => {
  const run = (params, query) =>
    new Promise((resolve) => {
      const req = { params, query };
      validator.commercialBlock(req, {}, (err) => resolve({ err, req }));
    });

  test("an unknown block is 404, not 422 — the route does not exist", async () => {
    const { err } = await run({ block: "nonsense" }, {});
    expect(err.status).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
  });

  test("a known block coerces its page window", async () => {
    const { err, req } = await run({ block: "invoices" }, { limit: "25", offset: "50" });
    expect(err).toBeUndefined();
    expect(req.query.limit).toBe(25);
    expect(req.query.offset).toBe(50);
  });

  test("a page window out of range is refused", async () => {
    const { err } = await run({ block: "invoices" }, { limit: "5000" });
    expect(err.status).toBe(422);
  });
});
