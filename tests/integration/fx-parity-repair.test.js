"use strict";

/**
 * Meeting 6, PR 3 — Definition of done #3, against a real schema:
 *
 *   open DRAFT documents priced at 656.168 are re-priced at the fixed parity
 *   655.957 with a note; a sealed costing and a posted invoice are unchanged;
 *   the run is safe to repeat.
 *
 * The migration body (14341) is executed inside a transaction over fixture rows
 * this suite creates, then rolled back — so the assertion is about what the
 * file DOES, on the schema it ships against, and nothing is left behind.
 *
 * Runs only with DATABASE_URL pointing at a provisioned tenant; self-skips
 * otherwise, like every suite in this directory.
 */
const fs = require("fs");
const path = require("path");

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

const SQL = fs.readFileSync(
  path.join(__dirname, "..", "..", "migrations", "tenant", "14341_fx_parity_repair_drafts.sql"),
  "utf8",
);

d("14341 — draft documents re-priced at the fixed EUR parity", () => {
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

  test("drafts move to 655.957 with a note; sealed and posted documents do not move; a re-run is a no-op", async () => {
    await c.query("BEGIN");
    try {
      const tag = `FXP-${Date.now()}`;
      const dossier = async (n) =>
        (await c.query("INSERT INTO dossier (ref, status) VALUES ($1, 'OPEN') RETURNING dossier_id", [`${tag}-${n}`])).rows[0].dossier_id;

      // A DRAFT EUR costing at the feed's figure, with one line and a total.
      const draft = (
        await c.query(
          `INSERT INTO costing (dossier_id, currency, exchange_rate_to_xaf, status, total_ttc, total_ttc_xaf)
           VALUES ($1, 'EUR', 656.168, 'DRAFT', 100, 65616.8) RETURNING costing_id`,
          [await dossier(1)],
        )
      ).rows[0].costing_id;
      await c.query("INSERT INTO costing_line (costing_id, label, qty, unit_cost, line_no) VALUES ($1, 'Handling', 1, 100, 1)", [draft]);

      // A SEALED EUR costing at the same figure — and an open simulation built from it.
      const sealed = (
        await c.query(
          `INSERT INTO costing (dossier_id, currency, exchange_rate_to_xaf, status, total_ttc, total_ttc_xaf)
           VALUES ($1, 'EUR', 656.168, 'APPROVED_LOCKED', 200, 131233.6) RETURNING costing_id`,
          [await dossier(2)],
        )
      ).rows[0].costing_id;
      await c.query("INSERT INTO costing_line (costing_id, label, qty, unit_cost, line_no) VALUES ($1, 'Gate-Pass Fee', 2, 100, 1)", [sealed]);
      const sim = (
        await c.query(
          `INSERT INTO margin_simulation (costing_id, currency, status, total_cost, total_price, margin_percent)
           VALUES ($1, 'XAF', 'DRAFT', 131233.6, 160000, 17.98) RETURNING margin_simulation_id`,
          [sealed],
        )
      ).rows[0].margin_simulation_id;
      // The imported line (round2(100 × 656.168) = 65616.8) and a typed one that must not move.
      await c.query(
        `INSERT INTO margin_simulation_line (margin_simulation_id, label, qty, unit_cost, unit_price, is_disbursement, vat_applicable)
         VALUES ($1, 'Gate-Pass Fee', 2, 65616.8, 80000, false, true),
                ($1, 'Typed by hand', 1, 1234.5, 2000, false, true)`,
        [sim],
      );

      // A DRAFT EUR cash request.
      const cash = (
        await c.query(
          `INSERT INTO cash_request (currency, exchange_rate_to_xaf, amount, amount_xaf, status)
           VALUES ('EUR', 656.168, 50, 32808.4, 'DRAFT') RETURNING cash_request_id`,
        )
      ).rows[0].cash_request_id;

      // A posted invoice (needs an entity; a tenant without one skips this pair).
      const ent = (await c.query("SELECT entity_id FROM corporate_entity LIMIT 1")).rows[0];
      let posted = null;
      let draftInvoice = null;
      if (ent) {
        posted = (
          await c.query(
            `INSERT INTO invoice (entity_id, type, currency, fx_rate, status) VALUES ($1, 'FINAL', 'EUR', 656.168, 'POSTED_LOCKED') RETURNING invoice_id`,
            [ent.entity_id],
          )
        ).rows[0].invoice_id;
        draftInvoice = (
          await c.query(
            `INSERT INTO invoice (entity_id, type, currency, fx_rate, status) VALUES ($1, 'FINAL', 'EUR', 656.168, 'DRAFT') RETURNING invoice_id`,
            [ent.entity_id],
          )
        ).rows[0].invoice_id;
      }

      await c.query(SQL);

      const one = async (sql, p) => (await c.query(sql, p)).rows[0];

      const dc = await one("SELECT exchange_rate_to_xaf, total_ttc_xaf, remarks FROM costing WHERE costing_id = $1", [draft]);
      expect(Number(dc.exchange_rate_to_xaf)).toBe(655.957);
      expect(Number(dc.total_ttc_xaf)).toBeCloseTo(65595.7, 6);
      expect(dc.remarks).toBe("Re-priced at the fixed parity 655.957; was 656.168.");
      // Lines are in the sheet's currency and are what the pricer priced.
      expect(Number((await one("SELECT unit_cost FROM costing_line WHERE costing_id = $1", [draft])).unit_cost)).toBe(100);

      const sc = await one("SELECT exchange_rate_to_xaf, total_ttc_xaf, remarks FROM costing WHERE costing_id = $1", [sealed]);
      expect(Number(sc.exchange_rate_to_xaf)).toBe(656.168);
      expect(Number(sc.total_ttc_xaf)).toBe(131233.6);
      expect(sc.remarks).toBeNull();

      const lines = (
        await c.query("SELECT label, unit_cost, notes FROM margin_simulation_line WHERE margin_simulation_id = $1 ORDER BY label", [sim])
      ).rows;
      const imported = lines.find((l) => l.label === "Gate-Pass Fee");
      const typed = lines.find((l) => l.label === "Typed by hand");
      expect(Number(imported.unit_cost)).toBe(65595.7);
      expect(imported.notes).toMatch(/fixed parity 655\.957; was 656\.168/);
      expect(Number(typed.unit_cost)).toBe(1234.5);
      expect(typed.notes).toBeNull();
      const ms = await one("SELECT total_cost, margin_percent FROM margin_simulation WHERE margin_simulation_id = $1", [sim]);
      expect(Number(ms.total_cost)).toBe(2 * 65595.7 + 1234.5);

      const cr = await one("SELECT exchange_rate_to_xaf, amount_xaf, remarks FROM cash_request WHERE cash_request_id = $1", [cash]);
      expect(Number(cr.exchange_rate_to_xaf)).toBe(655.957);
      expect(Number(cr.amount_xaf)).toBe(32797.85);
      expect(cr.remarks).toMatch(/fixed parity 655\.957/);

      if (ent) {
        expect(Number((await one("SELECT fx_rate FROM invoice WHERE invoice_id = $1", [posted])).fx_rate)).toBe(656.168);
        expect(Number((await one("SELECT fx_rate FROM invoice WHERE invoice_id = $1", [draftInvoice])).fx_rate)).toBe(655.957);
      }

      const logged = (
        await c.query("SELECT doc_type FROM fx_parity_repair WHERE doc_id = ANY($1::uuid[]) ORDER BY doc_type", [
          [draft, sealed, sim, cash, posted, draftInvoice].filter(Boolean),
        ])
      ).rows.map((r) => r.doc_type);
      expect(logged).toEqual(["cash_request", "costing", ...(ent ? ["invoice"] : []), "margin_simulation"]);

      const audited = await one(
        "SELECT count(*)::int AS n FROM immutable_ledger WHERE action = 'fx.parity_repriced' AND entity_ref = $1",
        ["costing:" + draft],
      );
      expect(audited.n).toBe(1);

      // Re-run: nothing more moves, no second note, no second audit row.
      await c.query(SQL);
      expect((await one("SELECT remarks FROM costing WHERE costing_id = $1", [draft])).remarks).toBe(
        "Re-priced at the fixed parity 655.957; was 656.168.",
      );
      expect(
        (await one("SELECT count(*)::int AS n FROM immutable_ledger WHERE action = 'fx.parity_repriced' AND entity_ref = $1", ["costing:" + draft])).n,
      ).toBe(1);
      expect(Number((await one("SELECT unit_cost FROM margin_simulation_line WHERE margin_simulation_id = $1 AND label = 'Gate-Pass Fee'", [sim])).unit_cost)).toBe(65595.7);
    } finally {
      await c.query("ROLLBACK");
    }
  });
});
