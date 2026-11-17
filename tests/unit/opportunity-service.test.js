"use strict";
/**
 * F7 (doc/SALES_CRM_FEATURES.md#F7) — what is left of the pipeline service
 * since the Sales lean revamp (PR 2) made it read only: the board's paging and
 * the KPI row, with the repo stubbed so no database is needed.
 */

const repo = require("../../src/modules/sales/opportunity/opportunity.repo");
const service = require("../../src/modules/sales/opportunity/opportunity.service");

/** A pg client that records the transaction verbs and does nothing else. */
function fakeClient() {
  const calls = [];
  let inTransaction = false;
  return { calls, query: async (sql) => {
    const statement = String(sql).trim();
    const verb = statement.split(/\s+/)[0].toUpperCase();
    calls.push(verb);
    if (verb === "SAVEPOINT" && !inTransaction) throw Object.assign(new Error("no transaction"), { code: "25P01" });
    if (verb === "BEGIN") inTransaction = true;
    if (verb === "COMMIT" || verb === "ROLLBACK") inTransaction = false;
    return { rows: [] };
  } };
}

const STAGES = [
  { pipeline_stage_id: "s-new", code: "NEW", sort_order: 0, is_won: false, is_lost: false, default_probability: 10 },
  { pipeline_stage_id: "s-qual", code: "QUALIFIED", sort_order: 1, is_won: false, is_lost: false, default_probability: 30 },
  { pipeline_stage_id: "s-price", code: "PRICING_IN_PROGRESS", sort_order: 2, is_won: false, is_lost: false, default_probability: 50 },
  { pipeline_stage_id: "s-won", code: "WON", sort_order: 5, is_won: true, is_lost: false, default_probability: 100 },
  { pipeline_stage_id: "s-lost", code: "LOST", sort_order: 6, is_won: false, is_lost: true, default_probability: 0 },
];
const stageById = (id) => STAGES.find((s) => s.pipeline_stage_id === id) || null;

let stored;

beforeEach(() => {
  stored = null;
  jest.spyOn(repo, "listStages").mockImplementation(async () => STAGES);
  jest.spyOn(repo, "stage").mockImplementation(async (_c, id) => stageById(id));
  jest.spyOn(repo, "firstOpenStage").mockImplementation(async () =>
    STAGES.filter((s) => !s.is_won && !s.is_lost).sort((a, b) => a.sort_order - b.sort_order)[0],
  );
  jest.spyOn(repo, "insert").mockImplementation(async (_c, row) => {
    stored = { opportunity_id: "o1", status: "OPEN", ...row };
    return stored;
  });
  jest.spyOn(repo, "get").mockImplementation(async () => stored);
  jest.spyOn(repo, "update").mockImplementation(async (_c, _id, fields) => {
    stored = { ...stored, ...fields };
    return stored;
  });
});

afterEach(() => jest.restoreAllMocks());

// The writes (create, update, moveStage, win, lose) were retired by the Sales
// lean revamp, PR 2: a deal moves, is lost and is won on its request. The win's
// one-transaction rule (the file and its link commit together, initialisation
// only after) is held by tests/unit/quote-request-win.test.js now.
describe("the opportunity is read only", () => {
  test("the service offers reads and nothing that writes", () => {
    expect(Object.keys(service).sort()).toEqual(["board", "get", "list", "listForExport", "metrics", "stages"]);
  });
});

describe("Kanban pagination", () => {
  test("the board follows every 200-row page instead of silently truncating", () => {
    const fs = require("fs");
    const path = require("path");
    const source = fs.readFileSync(path.join(__dirname, "../../client/src/features/sales/opportunities.tsx"), "utf8");
    expect(source).toContain("for (let offset = 0; ; offset += pageSize)");
    expect(source).toContain('pageQuery.set("offset", String(offset))');
    expect(source).toContain("if (rows.length < pageSize) return all");
    expect(source).not.toContain('tenant<Row[]>(`/opportunities?limit=200');
  });
});

describe("metrics", () => {
  test("both win rates come back named, off one aggregate query", async () => {
    jest.spyOn(repo, "metrics").mockResolvedValue({
      open_count: 10, won_count: 6, lost_count: 4,
      pipeline_value: 50000000, weighted_value: 21000000, won_value: 30000000,
    });
    const m = await service.metrics(fakeClient(), {});
    expect(m.win_rate_settled).toBe(60);
    expect(m.win_rate_all_deals).toBe(30);
    expect(m.total_count).toBe(20);
    expect(m.settled_count).toBe(10);
    expect(m.pipeline_value).toBe(50000000);
  });

  test("no settled deals yet reads as null, not 0%", async () => {
    jest.spyOn(repo, "metrics").mockResolvedValue({
      open_count: 3, won_count: 0, lost_count: 0,
      pipeline_value: 1, weighted_value: 0, won_value: 0,
    });
    const m = await service.metrics(fakeClient(), {});
    expect(m.win_rate_settled).toBeNull();
    expect(m.win_rate_all_deals).toBe(0);
  });
});
