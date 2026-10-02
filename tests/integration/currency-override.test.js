"use strict";

/**
 * Meeting 6, PR 3 — DoD 2 against a real schema: a manual USD override set
 * yesterday still wins after tonight's feed row, until someone releases it —
 * through BOTH resolution paths:
 *
 *   - rateFor (ratesForPair → the pure pickRate), which every transaction uses;
 *   - repo.latestRatesFromBase, the SQL DISTINCT ON a base rebase reads.
 *
 * The two must agree; this is the place they are held to it. Everything runs
 * in a transaction that is rolled back.
 */
const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("currency — a manual override stands until released (14340)", () => {
  let pool;
  let c;

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    c = await pool.connect();
  });
  afterAll(async () => {
    if (!c) return;
    c.release();
    await pool.end();
  });

  test("override beats tonight's feed in rateFor and latestRatesFromBase, until released", async () => {
    const service = require("../../src/modules/master/currency/currency.service");
    const repo = require("../../src/modules/master/currency/currency.repo");
    await c.query("BEGIN");
    try {
      const base = (await repo.getBaseCode(c)) || "XAF";
      // A floating quote the tenant may not have yet: GBP, added inside the tx.
      await c.query(
        "INSERT INTO currency (code, name, symbol, decimals, is_active) VALUES ('GBP','Pound Sterling','£',2,true) ON CONFLICT (code) DO UPDATE SET is_active = true",
      );
      await c.query("DELETE FROM fx_rate_daily WHERE base_code = $1 AND quote_code = 'GBP'", [base]);

      const { rows: [{ today, yesterday }] } = await c.query(
        "SELECT CURRENT_DATE::text AS today, (CURRENT_DATE - 1)::text AS yesterday",
      );
      await service.setRate(c, { base, quote: "GBP", rate: 0.0015, asOfDate: yesterday, actor: {} });
      await repo.upsertRate(c, { base, quote: "GBP", rate: 0.00131, asOfDate: today, source: "exchangerate-api", isOverride: false });

      const before = await service.rateFor(c, { base, quote: "GBP" });
      expect(Number(before.rate)).toBe(0.0015);
      expect(before.standing).toBe(true);
      const tableBefore = (await repo.latestRatesFromBase(c, base)).find((r) => r.quote_code === "GBP");
      expect(Number(tableBefore.rate)).toBe(0.0015);

      const out = await service.releaseOverride(c, { base, quote: "GBP", actor: {} });
      expect(out.released).toBe(1);

      const after = await service.rateFor(c, { base, quote: "GBP" });
      expect(Number(after.rate)).toBe(0.00131);
      const tableAfter = (await repo.latestRatesFromBase(c, base)).find((r) => r.quote_code === "GBP");
      expect(Number(tableAfter.rate)).toBe(0.00131);
      // The past still resolves to what was in force then.
      expect(Number((await service.rateFor(c, { base, quote: "GBP", date: yesterday })).rate)).toBe(0.0015);

      // Setting a rate again is a new decision and stands again.
      await service.setRate(c, { base, quote: "GBP", rate: 0.0016, asOfDate: today, actor: {} });
      expect(Number((await service.rateFor(c, { base, quote: "GBP" })).rate)).toBe(0.0016);

      // A EUR rate cannot be stored by hand, and EUR resolves to the parity.
      await expect(service.setRate(c, { base: "XAF", quote: "EUR", rate: 0.001524, actor: {} })).rejects.toMatchObject({ code: "FIXED_PARITY" });
      expect((await service.rateFor(c, { base: "EUR", quote: "XAF" })).rate).toBe(655.957);
    } finally {
      await c.query("ROLLBACK");
    }
  });
});
