"use strict";
/**
 * The Sales shapes the lean revamp's PR 7 dropped, put back INSIDE a test's own
 * transaction, so a backfill that read them can still be proven.
 *
 * PR 2's backfill (14511, 14512) read `opportunity`, `quote_request.status` and
 * `quotation.opportunity_id`; PR 4's (14542) read `proposal`, `proposal_line`
 * and `proposal_narrative`; PR 7's own proof (14590) reads `opportunity`. CI
 * provisions a tenant from nothing, where those migrations ran over empty
 * tables and where PR 7 has since dropped them, so the suites that prove them
 * rebuild "the eve" in a transaction they never commit
 * (tests/integration/sales-lean-revamp.test.js, quotation-one-document.test.js,
 * sales-retired-links.test.js). This is the part of that eve the schema no
 * longer has.
 *
 * READ FROM THE MIGRATIONS THAT MADE THEM, NOT RETYPED. Each shape is the
 * statement its own migration ran, read from the file: 0350's CREATE TABLEs and
 * foreign keys, 0683's status column and its trigger, and 0686, 0690, 0692,
 * 0693 and 10700 whole (they are idempotent). A hand-written copy would prove
 * the backfills against a table that never existed anywhere; this cannot drift
 * from what production had, because a migration that has shipped is never
 * edited (the migrator's ledger is keyed on the filename, and 0350 is also
 * frozen byte for byte in scripts/db/migration-idempotency-baseline.json).
 *
 * The caller must hold an open transaction on the tenant schema and roll it
 * back: nothing here may ever reach a real database.
 */
const fs = require("fs");
const path = require("path");

const MIGRATIONS = path.resolve(__dirname, "..", "..", "..", "migrations", "tenant");
const read = (name) => fs.readFileSync(path.join(MIGRATIONS, name), "utf8");

/** One statement out of a migration file, or a loud failure naming it. */
function statement(file, sql, re, what) {
  const m = sql.match(re);
  if (!m) throw new Error(`retired-sales-shapes: ${what} not found in ${file}; the helper no longer matches the migration`);
  return m[0];
}

/**
 * Put the retired shapes back. `c` is a client inside BEGIN, search_path on
 * the tenant schema. Safe to call once per transaction.
 */
async function restoreRetiredSalesShapes(c) {
  const { rows } = await c.query("SELECT to_regclass('opportunity') IS NOT NULL AS present");
  if (rows[0].present) throw new Error("retired-sales-shapes: `opportunity` exists; this helper is for a schema PR 7 has run on");

  // 0350: the tables, in the order their foreign keys need.
  const m0350 = read("0350_sales_crm.sql");
  for (const table of ["pipeline_stage", "opportunity", "proposal", "proposal_line", "proposal_narrative"]) {
    await c.query(statement("0350", m0350, new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`), `CREATE TABLE ${table}`));
  }
  // 0345 declared quotation.opportunity_id (its FK waited for 0350).
  await c.query("ALTER TABLE quotation ADD COLUMN IF NOT EXISTS opportunity_id uuid");
  await c.query(statement("0350", m0350, /ALTER TABLE quotation ADD CONSTRAINT fk_quote_opportunity[^;]*;/, "fk_quote_opportunity"));
  await c.query(statement("0350", m0350, /ALTER TABLE proposal\s+ADD CONSTRAINT fk_proposal_opportunity[^;]*;/, "fk_proposal_opportunity"));

  // 0683: quote_request.status with its CHECK, and the trigger that kept it in
  // step with converted_opportunity_id.
  const m0683 = read("0683_sales_crm_f6_lead_intake.sql");
  const column = statement("0683", m0683, /status\s+text NOT NULL DEFAULT 'RECEIVED'[\s\S]*?'CLOSED_NO_ACTION'\)\)/, "quote_request.status");
  await c.query(`ALTER TABLE quote_request ADD COLUMN ${column}`);
  await c.query(statement("0683", m0683, /CREATE OR REPLACE FUNCTION quote_request_sync_converted\(\)[\s\S]*?\$\$ LANGUAGE plpgsql;/, "quote_request_sync_converted()"));
  await c.query(statement("0683", m0683, /CREATE OR REPLACE TRIGGER trg_quote_request_sync_converted[\s\S]*?;/, "trg_quote_request_sync_converted"));

  // The later migrations onto those tables, whole: 0686 (the pipeline's
  // columns, its triggers and the one onto quote_request), the proposal
  // builder's, sharing's and generation's columns, and 10700's foreign key.
  for (const f of [
    "0686_sales_crm_f7_pipeline.sql",
    "0690_sales_crm_f3_proposal_builder.sql",
    "0692_sales_crm_f5_proposal_sharing.sql",
    "0693_sales_crm_f4_proposal_generation.sql",
    "10700_sales_crm_f6_quote_opportunity_fk.sql",
  ]) {
    await c.query(read(f));
  }
}

module.exports = { restoreRetiredSalesShapes };
