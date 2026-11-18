"use strict";
/**
 * Sales lean revamp, PR 7, against a real Postgres
 * (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §4.8, §5.6, §7 "PR 7").
 *
 * PR 7 dropped `opportunity`, `pipeline_stage`, the three proposal tables,
 * `quotation.opportunity_id`, `quote_request.status` and the declared Company
 * Profile columns. What it kept on purpose is what this file proves still
 * works:
 *
 *   1. THE DROPS RAN and the two maps stayed: `quote_request.converted_opportunity_id`
 *      (no foreign key now, and a COMMENT saying what it is) and
 *      `quotation.source_proposal_id`.
 *   2. AN OLD OPPORTUNITY LINK LANDS ON THE REQUEST it became, by every road a
 *      link takes: the `/sales/opportunities/:id` route the app keeps
 *      (`entity-route`), the request list's `?converted_opportunity_id=` that
 *      route reads, and the quotation's `opportunity_id` input.
 *   3. AN OLD PROPOSAL LINK LANDS ON THE QUOTATION it became: the
 *      `/sales/proposals/:id` route and the quotation list's
 *      `?source_proposal_id=` it reads.
 *   4. 14590'S PROOF, on a fixture rebuilt in a transaction it never commits:
 *      a request 14512 made from an opportunity that lost the id gets it back,
 *      with a NOTICE counting it; an opportunity no request maps to stops the
 *      migration before anything is dropped; and 14590 to 14594 run a second
 *      time as a no-op.
 *
 * Needs DATABASE_URL (search_path = the tenant schema), as CI's `migrations`
 * job sets it; skipped otherwise, per this directory.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { restoreRetiredSalesShapes } = require("./helpers/retired-sales-shapes");

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

const MIGRATIONS = path.resolve(__dirname, "..", "..", "migrations", "tenant");
const sqlOf = (name) => fs.readFileSync(path.join(MIGRATIONS, name), "utf8");
const PR7 = [
  "14590_sales_retire_opportunity_links.sql",
  "14591_sales_drop_proposal_tables.sql",
  "14592_sales_drop_opportunity.sql",
  "14593_quote_request_drop_status.sql",
  "14594_company_profile_drop_declared.sql",
];

const uid = () => crypto.randomUUID();
const tag = () => crypto.randomBytes(3).toString("hex");

d("Sales lean revamp PR 7: the retired tables are gone, the old links still land (real Postgres)", () => {
  let pool;
  const { entityRoute } = require("@praxis/shared");

  async function connect() {
    const c = await pool.connect();
    await c.query("SET search_path = live, public");
    return c;
  }

  beforeAll(() => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  /* ═══════════════════════════ 1. the drops ═══════════════════════════════ */

  test("the retired tables and columns are gone, and the two old-link maps stayed", async () => {
    const c = await connect();
    try {
      const tables = (await c.query(
        `SELECT t, to_regclass(t) IS NOT NULL AS present
           FROM unnest(ARRAY['opportunity', 'pipeline_stage', 'proposal', 'proposal_line',
                             'proposal_narrative', 'company_profile_project']) AS t`,
      )).rows;
      expect(tables.filter((r) => r.present).map((r) => r.t)).toEqual([]);

      const column = async (table, name) => (await c.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
        [table, name],
      )).rowCount === 1;
      expect(await column("quote_request", "status")).toBe(false);
      expect(await column("quotation", "opportunity_id")).toBe(false);
      for (const declared of ["slogan", "positioning", "certifications", "service_promises", "declared_confirmed_at"]) {
        expect([declared, await column("company_profile", declared)]).toEqual([declared, false]);
      }
      // What stays: the derived figures, and the two maps old links read.
      expect(await column("company_profile", "fleet_count")).toBe(true);
      expect(await column("quote_request", "converted_opportunity_id")).toBe(true);
      expect(await column("quotation", "source_proposal_id")).toBe(true);

      // converted_opportunity_id points at nothing now, and says what it is.
      const { rows: fks } = await c.query(
        `SELECT conname FROM pg_constraint
          WHERE conrelid = 'quote_request'::regclass AND contype = 'f'
            AND pg_get_constraintdef(oid) LIKE '%converted_opportunity_id%'`,
      );
      expect(fks).toEqual([]);
      const { rows: [comment] } = await c.query(
        `SELECT col_description('quote_request'::regclass, attnum) AS text
           FROM pg_attribute WHERE attrelid = 'quote_request'::regclass AND attname = 'converted_opportunity_id'`,
      );
      expect(comment.text).toMatch(/retired opportunity/);
      // No trigger rewrites a request into "converted" any more.
      const { rows: triggers } = await c.query(
        `SELECT tgname FROM pg_trigger WHERE tgrelid = 'quote_request'::regclass AND NOT tgisinternal
            AND tgname IN ('trg_quote_request_sync_converted', 'trg_quote_request_stamp_opportunity_source')`,
      );
      expect(triggers).toEqual([]);
    } finally {
      c.release();
    }
  });

  /* ═══════════════════ 2 and 3. the old links land ════════════════════════ */

  describe("an old link written before the revamp", () => {
    let c;
    const t = tag();
    const LEAD = uid();
    const REQUEST = uid();
    const QUOTATION = uid();
    // Ids of records that no longer exist anywhere: the opportunity and the
    // proposal were dropped, only the maps remember them.
    const OLD_OPPORTUNITY = uid();
    const OLD_PROPOSAL = uid();

    beforeAll(async () => {
      c = await connect();
      await c.query("BEGIN");
      await c.query(
        "INSERT INTO lead (lead_id, company_name, status, source, intake_channel) VALUES ($1, $2, 'OPEN', 'MANUAL', 'MANUAL')",
        [LEAD, `Old Links ${t}`],
      );
      // What 14512 wrote for an opportunity: a request carrying its id. With no
      // foreign key left, an id whose row is gone is a legal value.
      await c.query(
        `INSERT INTO quote_request (quote_request_id, lead_id, intake_channel, title, stage, converted_opportunity_id)
         VALUES ($1, $2, 'MANUAL', $3, 'QUOTED', $4)`,
        [REQUEST, LEAD, `Old deal ${t}`, OLD_OPPORTUNITY],
      );
      // What 14542 wrote for a proposal: a quotation carrying its id.
      await c.query(
        `INSERT INTO quotation (quotation_id, lead_id, quote_request_id, status, title, source_proposal_id, created_from)
         VALUES ($1, $2, $3, 'SENT', $4, $5, 'PROPOSAL')`,
        [QUOTATION, LEAD, REQUEST, `Old proposal ${t}`, OLD_PROPOSAL],
      );
    });

    afterAll(async () => {
      if (!c) return;
      await c.query("ROLLBACK");
      c.release();
    });

    test("an opportunity link lands on the request it became, on its company row", async () => {
      // The app keeps the old route, and resolves it through the request list…
      expect(entityRoute.urlFor(`opportunity:${OLD_OPPORTUNITY}`)).toBe(`/sales/opportunities/${OLD_OPPORTUNITY}`);
      // …filtered as lead-api.requestForOpportunity asks for it.
      const service = require("../../src/modules/sales/quote_request/quote_request.service");
      const found = await service.list(c, { converted_opportunity_id: OLD_OPPORTUNITY, limit: 1 });
      expect(found.rows).toHaveLength(1);
      expect(found.rows[0]).toMatchObject({ quote_request_id: REQUEST, lead_id: LEAD, stage: "QUOTED" });
      // Which is where old-links.tsx sends it: the 360 with the request on top.
      expect(entityRoute.urlFor(`lead:${LEAD}`)).toBe(`/sales/leads/${LEAD}`);
    });

    test("a quotation started from an old opportunity id answers the request it became", async () => {
      const repo = require("../../src/modules/commercial/quotation/quotation.repo");
      expect(await repo.quoteRequestForOpportunity(c, OLD_OPPORTUNITY)).toBe(REQUEST);
      expect(await repo.quoteRequestForOpportunity(c, uid())).toBeNull();
    });

    test("a proposal link lands on the quotation it became", async () => {
      expect(entityRoute.urlFor(`proposal:${OLD_PROPOSAL}`)).toBe(`/sales/proposals/${OLD_PROPOSAL}`);
      // old-links.tsx ProposalLinkPage reads the list by source_proposal_id.
      const repo = require("../../src/modules/commercial/quotation/quotation.repo");
      const { rows } = await repo.list(c, { source_proposal_id: OLD_PROPOSAL });
      expect(rows.map((r) => r.quotation_id)).toEqual([QUOTATION]);
      expect(entityRoute.urlFor(`quotation:${QUOTATION}`)).toBe(`/sales/quotations/${QUOTATION}`);
    });

    test("an id that was never an opportunity or a proposal lands nowhere, not on a stranger's record", async () => {
      const service = require("../../src/modules/sales/quote_request/quote_request.service");
      const repo = require("../../src/modules/commercial/quotation/quotation.repo");
      const stranger = uid();
      expect((await service.list(c, { converted_opportunity_id: stranger, limit: 1 })).rows).toEqual([]);
      expect((await repo.list(c, { source_proposal_id: stranger })).rows).toEqual([]);
    });
  });

  /* ═══════════════════════ 4. 14590's proof ════════════════════════════════ */

  describe("14590 proves every opportunity id maps to a request before anything is dropped", () => {
    const t = tag();

    /** A connection in a transaction holding the retired shapes, and its NOTICEs. */
    async function eve() {
      const c = await connect();
      const notices = [];
      c.on("notice", (n) => notices.push(n.message));
      await c.query("BEGIN");
      await restoreRetiredSalesShapes(c);
      return { c, notices };
    }
    const done = async (c) => {
      await c.query("ROLLBACK");
      c.release();
    };
    const lead = async (c) => (await c.query(
      "INSERT INTO lead (company_name, status, source, intake_channel) VALUES ($1, 'OPEN', 'MANUAL', 'MANUAL') RETURNING lead_id",
      [`Proof ${t} ${uid().slice(0, 4)}`],
    )).rows[0].lead_id;

    test("a request 14512 made that lost the id gets it back, counted, and then everything drops", async () => {
      const { c, notices } = await eve();
      try {
        const L = await lead(c);
        const MAPPED = uid();
        const LOST_ID = uid();
        const at = "2026-03-02T10:00:00Z";
        await c.query(
          `INSERT INTO opportunity (opportunity_id, name, lead_id, status, created_at) VALUES
             ($1, $3, $5, 'OPEN', now()), ($2, $4, $5, 'WON', $6)`,
          [MAPPED, LOST_ID, `Mapped ${t}`, `Lost id ${t}`, L, at],
        );
        await c.query(
          "INSERT INTO quote_request (lead_id, intake_channel, title, stage, converted_opportunity_id) VALUES ($1, 'MANUAL', $2, 'QUOTED', $3)",
          [L, `Mapped ${t}`, MAPPED],
        );
        // What 14512 step 4 wrote for LOST_ID, less the id: MANUAL, its name,
        // its creation time.
        const { rows: [orphan] } = await c.query(
          "INSERT INTO quote_request (lead_id, intake_channel, title, stage, created_at) VALUES ($1, 'MANUAL', $2, 'WON', $3) RETURNING quote_request_id",
          [L, `Lost id ${t}`, at],
        );

        for (const f of PR7) await c.query(sqlOf(f));

        expect(notices).toContain("14590: 1 request(s) given back the opportunity id they were made from");
        expect(notices).toContain("14590: every opportunity id maps to a request");
        const { rows: [back] } = await c.query("SELECT converted_opportunity_id FROM quote_request WHERE quote_request_id = $1", [orphan.quote_request_id]);
        expect(back.converted_opportunity_id).toBe(LOST_ID);
        expect((await c.query("SELECT to_regclass('opportunity') AS r")).rows[0].r).toBeNull();
        expect((await c.query("SELECT to_regclass('proposal') AS r")).rows[0].r).toBeNull();

        // The CI replay: every statement is guarded, so a second run is a no-op.
        for (const f of PR7) await c.query(sqlOf(f));
      } finally {
        await done(c);
      }
    });

    test("an opportunity no request maps to stops the migration, and nothing is dropped", async () => {
      const { c } = await eve();
      try {
        const L = await lead(c);
        await c.query("INSERT INTO opportunity (name, lead_id, status) VALUES ($1, $2, 'OPEN')", [`Unmapped ${t}`, L]);
        await c.query("SAVEPOINT before_14590");
        await expect(c.query(sqlOf(PR7[0]))).rejects.toThrow(/1 opportunit\(y\/ies\) map to no request/);
        await c.query("ROLLBACK TO SAVEPOINT before_14590");
        // The file is one transaction: its trigger and FK drops rolled back
        // with the refusal, and the table is still there to be mapped.
        expect((await c.query("SELECT to_regclass('opportunity') IS NOT NULL AS r")).rows[0].r).toBe(true);
        const { rows } = await c.query(
          "SELECT 1 FROM pg_trigger WHERE tgrelid = 'quote_request'::regclass AND tgname = 'trg_quote_request_sync_converted'",
        );
        expect(rows).toHaveLength(1);
      } finally {
        await done(c);
      }
    });
  });
});
