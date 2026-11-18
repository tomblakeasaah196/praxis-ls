"use strict";
/**
 * F6 KPI partition proof, against a real Postgres.
 *
 * THE INVARIANT: every quote_request row lands in exactly one tile, and the
 * tiles sum to the visible TOTAL under any non-stage filter. The legacy showed
 * 5 of 26 rows because intake statuses and pipeline stages shared one column,
 * so its KPI query counted only the intake-named rows and the rest leaked
 * silently. `quote_request.rules` derives one tile per STAGE from the stage
 * list itself and `assertPartitions` proves the fold; this test proves the same
 * thing end to end, through the SQL.
 *
 * Since the Sales lean revamp (PR 6) the tiles read `stage`, the request's
 * lifecycle; `status` is written in step until PR 7 drops it and is read by
 * nothing, so the rows below carry a status only because the column is still
 * there.
 *
 * It goes through `service.list`, which is also what the controller calls: the
 * repo returns the raw GROUP BY (`kpiRows`) and the fold happens in the service.
 *
 * Skipped unless DATABASE_URL is set (per the test-env convention used by the
 * other integration tests in tests/integration/).
 */

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("F6 quote_request KPI partition (real Postgres)", () => {
  let pool, service, rules;
  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    service = require("../../src/modules/sales/quote_request/quote_request.service");
    rules = require("../../src/modules/sales/quote_request/quote_request.rules");

    // The migrator is keyed on the relative path; the CI step that calls this
    // test runs the standard tenant set first, so the F6 migration should
    // already be in the ledger. Assert the table exists before going further.
    const { rows: tbl } = await pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'quote_request' LIMIT 1",
    );
    if (tbl.length === 0) {
      throw new Error(
        "quote_request table not present — apply migrations/tenant/0683_sales_crm_f6_lead_intake.sql first.",
      );
    }
  });

  afterAll(async () => { if (pool) await pool.end(); });

  /** Sum every stage tile plus OTHER — what assertPartitions checks, restated. */
  const sumTiles = (kpi) =>
    rules.STAGES.reduce((n, s) => n + (kpi[s] || 0), 0) + (kpi.OTHER || 0);

  /** Every request sits on a company row since the Sales lean revamp (14512). */
  async function seed(marker, rows) {
    const lead = (await pool.query("INSERT INTO lead (company_name, status) VALUES ($1, 'OPEN') RETURNING lead_id", [marker])).rows[0].lead_id;
    for (const r of rows) {
      await pool.query(
        "INSERT INTO quote_request (public_ref, intake_channel, requester_name, incoterm, stage, status, lead_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [r.ref, r.channel, "Test " + r.ref, "FOB", r.stage, rules.statusForStage(r.stage) || "RECEIVED", lead],
      );
    }
  }

  test("the KPI tiles partition the result set under any filter", async () => {
    // 2 NEW, 1 CONTACTED, 1 MEETING, 1 QUOTED, 1 WON, 1 LOST = 7 rows.
    const marker = "KPI-" + Date.now();
    await seed(marker, [
      { stage: "NEW", channel: "WEBSITE", ref: marker + "-N1" },
      { stage: "NEW", channel: "MANUAL", ref: marker + "-N2" },
      { stage: "CONTACTED", channel: "MANUAL", ref: marker + "-C1" },
      { stage: "QUOTED", channel: "MANUAL", ref: marker + "-Q1" },
      { stage: "WON", channel: "MANUAL", ref: marker + "-W1" },
      { stage: "LOST", channel: "MANUAL", ref: marker + "-L1" },
      { stage: "MEETING", channel: "WEBSITE", ref: marker + "-M1" },
    ]);
    try {
      // 1. No filter. Every one of the 7 rows is in a tile, the settled ones too.
      const all = await service.list(pool, { q: marker });
      expect(all.total).toBe(7);
      expect(all.kpi.TOTAL).toBe(7);
      expect(sumTiles(all.kpi)).toBe(7);
      expect(all.kpi).toMatchObject({ NEW: 2, CONTACTED: 1, MEETING: 1, QUOTED: 1, WON: 1, LOST: 1 });
      expect(all.kpi.OTHER).toBeUndefined();

      // 2. A non-stage filter narrows BOTH the list and the summary, and they
      //    still add up: 2 WEBSITE rows, one NEW and one MEETING.
      const web = await service.list(pool, { q: marker, intake_channel: "WEBSITE" });
      expect(web.total).toBe(2);
      expect(web.kpi.TOTAL).toBe(2);
      expect(sumTiles(web.kpi)).toBe(2);
      expect(web.kpi).toMatchObject({ NEW: 1, MEETING: 1, QUOTED: 0 });

      // 3. The STAGE filter narrows the list and is DROPPED from the summary.
      //    Applying it to both would make one tile equal the total and the rest
      //    zero — a tautology, and the legacy's version of it is why a user
      //    filtering to one value concluded the other rows were missing data.
      const fresh = await service.list(pool, { q: marker, stage: "NEW" });
      expect(fresh.total).toBe(2);
      expect(fresh.kpi.TOTAL).toBe(7);
      expect(sumTiles(fresh.kpi)).toBe(7);
      expect(fresh.kpi).toMatchObject({ NEW: 2, CONTACTED: 1, LOST: 1 });

      // 4. The retired intake status filters nothing.
      const old = await service.list(pool, { q: marker, status: "RECEIVED" });
      expect(old.total).toBe(7);
    } finally {
      // Clean up the marker rows so the test is idempotent.
      await pool.query("DELETE FROM quote_request WHERE public_ref LIKE $1", [marker + "%"]);
    }
  });

  /**
   * A stage the vocabulary does not know must show up as a discrepancy rather
   * than unbalancing the tiles. The service holds the vocabulary (no CHECK on
   * an existing table, the 13791 rule), so a value written by a hand-run
   * UPDATE is exactly how the legacy's counters stopped adding up.
   */
  test("an unknown stage value surfaces as OTHER, never as a silent loss", async () => {
    const marker = "KPIX-" + Date.now();
    try {
      await seed(marker, [
        { stage: "SP-NEW", channel: "MANUAL", ref: marker + "-SP" },
        { stage: "NEW", channel: "MANUAL", ref: marker + "-N1" },
      ]);
      const out = await service.list(pool, { q: marker });
      expect(out.kpi.TOTAL).toBe(2);
      expect(out.kpi.NEW).toBe(1);
      expect(out.kpi.OTHER).toBe(1);
      // service.list runs assertPartitions before returning; reaching here at
      // all means the tiles balanced with the stray row counted.
      expect(sumTiles(out.kpi)).toBe(2);
    } finally {
      await pool.query("DELETE FROM quote_request WHERE public_ref LIKE $1", [marker + "%"]);
    }
  });
});
