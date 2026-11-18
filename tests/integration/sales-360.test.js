"use strict";
/**
 * Lead 360 and Intake 360 against a real Postgres.
 *
 * The unit suite mocks the client and proves the JUDGEMENT — what is gated,
 * what is counted, what a brand-new record renders as. It cannot prove the
 * queries, and the queries are the part that breaks silently: every one of them
 * names columns across the tables of the company row (`lead`, `meeting`,
 * `meeting_discovery_section`, `quote_request`, `quotation`, `lead_activity`,
 * `company_profile_share`, `contact_enquiry`, `immutable_ledger`), and a
 * column renamed or a table dropped in a later migration surfaces as a 500
 * nobody's mocked test can see. PR 7 of the lean revamp dropped `opportunity`,
 * `pipeline_stage` and the `proposal` tables; running both dossiers here is the
 * proof that nothing still reads them.
 *
 * So this runs each dossier against a live schema. It asserts shape, not
 * content — the tenant it points at may have any amount of data in it, or none
 * — which is exactly the assertion that would have caught a bad column name.
 *
 * Skipped unless DATABASE_URL is set, per the convention in this directory.
 */

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("Sales 360 aggregations (real Postgres)", () => {
  let pool, client, svc;

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    client = await pool.connect();
    await client.query("SET search_path = live, public");
    svc = require("../../src/modules/sales/sales-360.service");
  });

  afterAll(async () => {
    if (client) client.release();
    if (pool) await pool.end();
  });

  /** A lead to hang the assertions on. Created here so the test owns its data. */
  async function makeLead() {
    const { rows } = await client.query(
      `INSERT INTO lead (company_name, contact_name, email, status, country, niu, rccm)
       VALUES ('360 Integration Co', 'Test Contact', 'i360@example.test', 'OPEN', 'CM', 'NIU-360', 'RCCM-360')
       RETURNING lead_id`,
    );
    return rows[0].lead_id;
  }

  /** A request on the lead (the deal, D3) and, with `total`, its quotation. */
  async function makeDeal(leadId, { value, total = null, stage = "QUOTED", title = "360 request" }) {
    const q = (
      await client.query(
        `INSERT INTO quote_request (lead_id, title, stage, estimated_value, currency)
         VALUES ($1, $2, $3, $4, 'XAF') RETURNING quote_request_id`,
        [leadId, title, stage, value],
      )
    ).rows[0].quote_request_id;
    if (total !== null) {
      await client.query(
        `INSERT INTO quotation (lead_id, quote_request_id, status, total_ht, total_ttc, currency)
         VALUES ($1, $2, 'DRAFT', $3, $3, 'XAF')`,
        [leadId, q, total],
      );
    }
    return q;
  }

  test("every query in the lead dossier executes against the real schema", async () => {
    const leadId = await makeLead();
    const dossier = await svc.leadDossier(client, { leadId, canSeeFinancials: true });

    expect(dossier.lead.lead_id).toBe(leadId);
    for (const k of ["meetings", "quote_requests", "enquiries", "timeline", "activity", "requests", "quotations"]) {
      expect(Array.isArray(dossier[k])).toBe(true);
    }
    expect(dossier).not.toHaveProperty("proposals");
    expect(dossier).not.toHaveProperty("opportunities");
    // A lead created a second ago has nothing hanging off it, which is the
    // "renders for a brand-new record" gate — proven here against real SQL
    // rather than against a mock that returns whatever it was told to.
    expect(dossier.kpis.meetings).toBe(0);
    expect(dossier.kpis.open_value).toBe(0);
    expect(dossier.client).toBeNull();
  });

  test("related records show up in the right collections", async () => {
    const leadId = await makeLead();

    const meeting = (
      await client.query(
        `INSERT INTO meeting (subject, lead_id, location) VALUES ('Discovery', $1, 'Douala')
         RETURNING meeting_id`,
        [leadId],
      )
    ).rows[0].meeting_id;
    await client.query(
      `INSERT INTO meeting_discovery_section (meeting_id, section_key, body)
       VALUES ($1, 'OPERATIONS', 'Reefer imports, 30 TEU a month.')`,
      [meeting],
    );
    await makeDeal(leadId, { value: 1500000, total: 1785000 });
    await makeDeal(leadId, { value: 900000, stage: "LOST" });

    const dossier = await svc.leadDossier(client, { leadId, canSeeFinancials: true });

    expect(dossier.meetings).toHaveLength(1);
    expect(dossier.meetings[0].sections.map((s) => s.section_key)).toEqual(["OPERATIONS"]);
    expect(dossier.meetings[0].sections[0].has_body).toBe(true);
    expect(dossier.kpis.discovery_sections_captured).toBe(1);

    // The request carries the deal (D3): two requests, one of them lost, so
    // the open value is the open one's only.
    expect(dossier.requests).toHaveLength(2);
    expect(dossier.kpis).toMatchObject({ open_requests: 1, won_requests: 0, open_value: 1500000 });
    // Its quotation is the one priced document (D6).
    expect(dossier.quotations).toHaveLength(1);
    expect(dossier.quotations[0].total_ttc).toBe(1785000);
  });

  test("the same dossier hides money from a caller without finance visibility", async () => {
    const leadId = await makeLead();
    await makeDeal(leadId, { value: 999, total: 1188, title: "Gated" });

    const hidden = await svc.leadDossier(client, { leadId, canSeeFinancials: false });
    expect(hidden.kpis.money_visible).toBe(false);
    expect(hidden.kpis.open_value).toBeNull();
    expect(hidden.requests[0].estimated_value).toBeNull();
    expect(hidden.quotations[0].total_ttc).toBeNull();
    // The rows themselves are still there and still readable: only the figures are not.
    expect(hidden.kpis.open_requests).toBe(1);
    expect(hidden.requests[0].title).toBe("Gated");
  });

  test("the timeline reads the audit rows the lead's own service writes", async () => {
    const leadId = await makeLead();
    await client.query(
      `INSERT INTO immutable_ledger (action, module_key, entity_ref) VALUES ('lead.created', 'MOD-20', $1)`,
      ["lead:" + leadId],
    );
    const dossier = await svc.leadDossier(client, { leadId });
    expect(dossier.timeline.map((t) => t.action)).toContain("lead.created");
    expect(dossier.timeline[0].occurred_at).toBeTruthy();
  });

  test("every query in the intake dossier executes against the real schema", async () => {
    const entity = (await client.query("SELECT entity_id FROM corporate_entity LIMIT 1")).rows[0];
    // Every request sits on a company row since the Sales lean revamp (14512).
    const leadId = await makeLead();
    const q = (
      await client.query(
        `INSERT INTO quote_request (incoterm, requester_name, entity_id, lead_id)
         VALUES ('FOB', '360 Integration', $1, $2) RETURNING quote_request_id`,
        [entity ? entity.entity_id : null, leadId],
      )
    ).rows[0].quote_request_id;

    const dossier = await svc.intakeDossier(client, { quoteRequestId: q, canSeeFinancials: true });
    expect(dossier.request.quote_request_id).toBe(q);
    expect(Array.isArray(dossier.attachments)).toBe(true);
    expect(Array.isArray(dossier.timeline)).toBe(true);
    // The request has a stage and no status (14593), and no opportunity (14592).
    expect(dossier.request.stage).toBe("NEW");
    expect(dossier.request).not.toHaveProperty("status");
    expect(dossier).not.toHaveProperty("converted_opportunity");
    // Every request sits on its company's row (14512): the dossier names it.
    expect(dossier.lead).toMatchObject({ lead_id: leadId, status: "OPEN" });
    expect(dossier.kpis.age_days).toBe(0);
  });

  test("an unknown id is a 404 on both dossiers", async () => {
    const ghost = "11111111-1111-1111-1111-111111111111";
    await expect(svc.leadDossier(client, { leadId: ghost })).rejects.toMatchObject({ status: 404 });
    await expect(
      svc.intakeDossier(client, { quoteRequestId: ghost }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
