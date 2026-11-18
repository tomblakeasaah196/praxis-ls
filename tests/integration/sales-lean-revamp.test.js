"use strict";
/**
 * Sales lean revamp, PR 2, against a real Postgres
 * (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §7 "PR 2", §8).
 *
 * The four things the guide asks this PR to prove, each where only a database
 * can prove it:
 *
 *   1. THE BACKFILL on a fixture carrying every old status. CI provisions a
 *      tenant from nothing, where 14510-14515 move no rows, so this rebuilds the
 *      eve of the revamp inside a transaction it never commits (the same trick
 *      as mail-model-backfill.test.js): the tables and columns PR 7 dropped
 *      since put back (helpers/retired-sales-shapes.js), the old constraints
 *      out of the way, a
 *      row in every lead status, every intake status, an opportunity WON, LOST
 *      and OPEN with and without a quotation, a client with two leads,
 *      opportunities no request points at, website requests from one address.
 *      Then the migration files are re-applied verbatim, asserted, and ROLLED
 *      BACK, so the tenant is byte-identical afterwards.
 *   2. THE DUPLICATE CHECK: the same company, typed another way, is refused
 *      with the row it already is.
 *   3. A WEBSITE QUOTE FROM A KNOWN EMAIL lands on the existing row: one
 *      company, two requests, one next step on the owner's desk.
 *   4. ACCEPTANCE UNDER RETRY opens exactly one operations file, converts one
 *      client, wins one request, with the handler delivered twice at once and
 *      once more after.
 *
 * And the loop (§8): Done with a next step; Done without one refused on an open
 * prospect; Archive allowed, and it loses what was open.
 *
 * Needs DATABASE_URL (search_path = the tenant schema) and TEST_ENTITY_ID, as
 * CI's `migrations` job sets them; skipped otherwise, per this directory.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const hasDb = !!process.env.DATABASE_URL && !!process.env.TEST_ENTITY_ID;
const d = hasDb ? describe : describe.skip;

const MIGRATIONS = path.resolve(__dirname, "..", "..", "migrations", "tenant");
const { restoreRetiredSalesShapes } = require("./helpers/retired-sales-shapes");
const sqlOf = (name) => fs.readFileSync(path.join(MIGRATIONS, name), "utf8");

/** A fresh uuid, so a re-run on the same database never collides. */
const uid = () => crypto.randomUUID();
const tag = () => crypto.randomBytes(3).toString("hex");

d("Sales lean revamp PR 2 (real Postgres)", () => {
  let pool;
  const ENTITY = process.env.TEST_ENTITY_ID;
  const OWNER = uid();
  let previousDefaultOwner;

  /** A connection on the tenant schema. */
  async function connect() {
    const c = await pool.connect();
    await c.query("SET search_path = live, public");
    return c;
  }

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
    const c = await connect();
    try {
      // The salesperson every next step in this file lands on.
      await c.query(
        `INSERT INTO app_user (user_id, email, full_name, password_hash, status)
         VALUES ($1, $2, 'Revamp Owner', 'not-a-hash', 'ACTIVE')`,
        [OWNER, `owner-${tag()}@revamp.test`],
      );
      // …and the default sales owner, so a website lead with no row is hers.
      const { rows } = await c.query("SELECT value FROM setting WHERE section = 'sales' AND key = 'default_owner'");
      previousDefaultOwner = rows[0] ? rows[0].value : null;
      await c.query(
        `INSERT INTO setting (section, key, value) VALUES ('sales', 'default_owner', $1::jsonb)
         ON CONFLICT (section, key) DO UPDATE SET value = EXCLUDED.value`,
        [JSON.stringify({ user_id: OWNER })],
      );
    } finally {
      c.release();
    }
  });

  afterAll(async () => {
    if (!pool) return;
    const c = await connect();
    try {
      if (previousDefaultOwner) {
        await c.query("UPDATE setting SET value = $1::jsonb WHERE section = 'sales' AND key = 'default_owner'", [JSON.stringify(previousDefaultOwner)]);
      } else {
        await c.query("DELETE FROM setting WHERE section = 'sales' AND key = 'default_owner'");
      }
    } finally {
      c.release();
      await pool.end();
    }
  });

  /* ═══════════════════════════ 1. the backfill ═══════════════════════════ */

  describe("14510-14515 on a fixture with every old status", () => {
    let c;
    const L = { NEW: uid(), CONTACTED: uid(), QUALIFIED: uid(), CONVERTED: uid(), TWIN: uid(), LOST: uid() };
    const CL = { TWIN: uid(), LONELY: uid() };
    const O = { WON: uid(), LOST: uid(), QUOTED: uid(), OPEN: uid(), ON_LEAD: uid(), ON_CLIENT: uid(), ON_NOBODY: uid() };
    const Q = {
      RECEIVED: uid(), UNDER_REVIEW: uid(), CLARIFICATION: uid(), QUOTED: uid(), CLOSED: uid(),
      WEB1: uid(), WEB2: uid(), PORTAL: uid(), CONV_WON: uid(), CONV_LOST: uid(), CONV_QUOTED: uid(), CONV_OPEN: uid(),
    };
    const MEETING = uid();
    const QUOTATION = uid();
    const t = tag();

    const lead = async (id) => (await c.query("SELECT * FROM lead WHERE lead_id = $1", [id])).rows[0];
    const req = async (id) => (await c.query("SELECT * FROM quote_request WHERE quote_request_id = $1", [id])).rows[0];
    const reqOfOpp = async (id) => (await c.query("SELECT * FROM quote_request WHERE converted_opportunity_id = $1", [id])).rows[0];

    beforeAll(async () => {
      c = await connect();
      await c.query("BEGIN");

      // ── the eve of the revamp: the opportunity, the intake status and the
      // proposal, which PR 7 dropped since (the helper rebuilds them from the
      // migrations that made them, inside this transaction)…
      await restoreRetiredSalesShapes(c);
      // …and what 14510-14512 add or enforce, out of the way
      await c.query("DROP INDEX IF EXISTS ux_lead_client");
      await c.query("ALTER TABLE quote_request ALTER COLUMN lead_id DROP NOT NULL");

      await c.query(
        `INSERT INTO client_master (client_id, name, email, phone) VALUES
           ($1, $3, $4, '+237 699 000 111'), ($2, $5, $6, '677000222')`,
        [CL.TWIN, CL.LONELY, `Twin ${t} SA`, `twin-${t}@fx.test`, `Lonely ${t} SARL`, `lonely-${t}@fx.test`],
      );
      await c.query(
        `INSERT INTO lead (lead_id, company_name, email, status, source, intake_channel, client_id, owner_user_id, created_at) VALUES
           ($1, $7,  $8, 'NEW',       'MANUAL',   'MANUAL',   NULL, $13, now() - interval '9 days'),
           ($2, $9, NULL, 'CONTACTED', 'CAMPAIGN', 'CAMPAIGN', NULL, NULL, now() - interval '8 days'),
           ($3, $10, NULL, 'QUALIFIED', 'REFERRAL', 'REFERRAL', NULL, NULL, now() - interval '7 days'),
           ($4, $11, NULL, 'CONVERTED', 'WEBSITE',  'WEBSITE',  $14,  NULL, now() - interval '6 days'),
           ($5, $12, NULL, 'NEW',       'MANUAL',   'MANUAL',   $14,  NULL, now() - interval '5 days'),
           ($6, $15, NULL, 'LOST',      'MANUAL',   'MANUAL',   NULL, NULL, now() - interval '4 days')`,
        [L.NEW, L.CONTACTED, L.QUALIFIED, L.CONVERTED, L.TWIN, L.LOST,
          `New ${t}`, `new-${t}@fx.test`, `Contacted ${t}`, `Qualified ${t}`, `Twin ${t} SA`, `Twin ${t} (2)`, OWNER, CL.TWIN, `Lost ${t}`],
      );
      await c.query(
        `INSERT INTO opportunity (opportunity_id, name, lead_id, client_id, status, estimated_value, currency) VALUES
           ($1, 'Won deal',  NULL, NULL, 'WON',  1000, 'XAF'),
           ($2, 'Lost deal', NULL, NULL, 'LOST', 2000, 'XAF'),
           ($3, 'Quoted deal', NULL, NULL, 'OPEN', 3000, 'XAF'),
           ($4, 'Open deal', NULL, NULL, 'OPEN', 4000, 'XAF'),
           ($5, 'Orphan on a lead', $8, NULL, 'OPEN', 5000, 'XAF'),
           ($6, 'Orphan on a client', NULL, $9, 'WON', 6000, 'XAF'),
           ($7, $10, NULL, NULL, 'OPEN', 7000, 'XAF')`,
        [O.WON, O.LOST, O.QUOTED, O.OPEN, O.ON_LEAD, O.ON_CLIENT, O.ON_NOBODY, L.QUALIFIED, CL.LONELY, `Orphan ${t}`],
      );
      await c.query(
        `INSERT INTO quote_request (quote_request_id, lead_id, client_id, intake_channel, requester_email, requester_company, incoterm, status, created_at) VALUES
           ($1, $12, NULL, 'MANUAL',  NULL, NULL, 'FOB', 'RECEIVED',               now() - interval '9 days'),
           ($2, $13, NULL, 'MANUAL',  NULL, NULL, 'FOB', 'UNDER_REVIEW',           now() - interval '9 days'),
           ($3, $13, NULL, 'MANUAL',  NULL, NULL, 'FOB', 'CLARIFICATION_REQUIRED', now() - interval '9 days'),
           ($4, $14, NULL, 'MANUAL',  NULL, NULL, 'FOB', 'QUOTED',                 now() - interval '9 days'),
           ($5, $15, NULL, 'MANUAL',  NULL, NULL, 'FOB', 'CLOSED_NO_ACTION',       now() - interval '9 days'),
           ($6, NULL, NULL, 'WEBSITE', $9, $10, 'TBD', 'RECEIVED',                now() - interval '3 days'),
           ($7, NULL, NULL, 'WEBSITE', $11, $10, 'TBD', 'RECEIVED',                now() - interval '2 days'),
           ($8, NULL, $16, 'PORTAL',  NULL, NULL, 'TBD', 'RECEIVED',                now() - interval '1 day')`,
        [Q.RECEIVED, Q.UNDER_REVIEW, Q.CLARIFICATION, Q.QUOTED, Q.CLOSED, Q.WEB1, Q.WEB2, Q.PORTAL,
          `same-${t}@fx.test`, `Same ${t}`, `SAME-${t}@FX.test`, L.NEW, L.CONTACTED, L.QUALIFIED, L.LOST, CL.TWIN],
      );
      // Converted requests: the 0683 trigger sets their status from the FK.
      await c.query(
        `INSERT INTO quote_request (quote_request_id, lead_id, intake_channel, incoterm, converted_opportunity_id) VALUES
           ($1, $5, 'MANUAL', 'FOB', $8), ($2, $6, 'MANUAL', 'FOB', $9),
           ($3, $7, 'MANUAL', 'FOB', $10), ($4, $7, 'MANUAL', 'FOB', $11)`,
        [Q.CONV_WON, Q.CONV_LOST, Q.CONV_QUOTED, Q.CONV_OPEN, L.CONVERTED, L.TWIN, L.NEW, O.WON, O.LOST, O.QUOTED, O.OPEN],
      );
      await c.query("INSERT INTO quotation (quotation_id, opportunity_id, status) VALUES ($1, $2, 'SENT')", [QUOTATION, O.QUOTED]);
      await c.query("INSERT INTO meeting (meeting_id, subject, lead_id) VALUES ($1, 'Twin meeting', $2)", [MEETING, L.TWIN]);

      // ── the revamp, verbatim
      for (const f of [
        "14510_lead_company_row.sql",
        "14511_quote_request_carries_the_deal.sql",
        "14512_sales_one_row_per_company.sql",
        "14515_lead_next_steps.sql",
      ]) {
        await c.query(sqlOf(f));
      }
    });

    afterAll(async () => {
      if (!c) return;
      await c.query("ROLLBACK");
      c.release();
    });

    test("every lead status maps: NEW, CONTACTED, QUALIFIED and CONVERTED are OPEN; LOST is ARCHIVED with its reason", async () => {
      for (const k of ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED"]) expect((await lead(L[k])).status).toBe("OPEN");
      expect(await lead(L.LOST)).toMatchObject({ status: "ARCHIVED", archived_reason: "Lost" });
    });

    test("CAMPAIGN leaves the vocabulary and the row keeps the word", async () => {
      const row = await lead(L.CONTACTED);
      expect(row).toMatchObject({ source: "MANUAL", intake_channel: "MANUAL" });
      expect(row.details_json.source_before_14512).toBe("CAMPAIGN");
    });

    test("every intake status maps to a stage", async () => {
      expect((await req(Q.RECEIVED)).stage).toBe("NEW");
      expect((await req(Q.UNDER_REVIEW)).stage).toBe("CONTACTED");
      expect((await req(Q.CLARIFICATION)).stage).toBe("CONTACTED");
      expect((await req(Q.QUOTED)).stage).toBe("QUOTED");
      expect(await req(Q.CLOSED)).toMatchObject({ stage: "LOST", lost_reason_code: "NO_RESPONSE", lost_reason: "No response" });
      expect((await req(Q.CLOSED)).settled_at).not.toBeNull();
    });

    test("a converted request takes the deal from its opportunity", async () => {
      expect(await req(Q.CONV_WON)).toMatchObject({ stage: "WON", estimated_value: "1000.00", currency: "XAF", title: "Won deal" });
      expect(await req(Q.CONV_LOST)).toMatchObject({ stage: "LOST", lost_reason_code: "OTHER" });
      expect((await req(Q.CONV_QUOTED)).stage).toBe("QUOTED");
      expect((await req(Q.CONV_OPEN)).stage).toBe("CONTACTED");
      expect((await req(Q.CONV_OPEN)).settled_at).toBeNull();
    });

    test("an opportunity no request pointed at is a request now, on its lead, its client's row, or a new row", async () => {
      expect(await reqOfOpp(O.ON_LEAD)).toMatchObject({ lead_id: L.QUALIFIED, stage: "CONTACTED", title: "Orphan on a lead", intake_channel: "MANUAL" });
      const onClient = await reqOfOpp(O.ON_CLIENT);
      expect(onClient.stage).toBe("WON");
      expect((await lead(onClient.lead_id)).client_id).toBe(CL.LONELY);
      const onNobody = await reqOfOpp(O.ON_NOBODY);
      expect((await lead(onNobody.lead_id)).company_name).toBe(`Orphan ${t}`);
    });

    test("two website requests from one address are ONE prospect row", async () => {
      const a = await req(Q.WEB1);
      const b = await req(Q.WEB2);
      expect(a.lead_id).toBe(b.lead_id);
      expect(await lead(a.lead_id)).toMatchObject({ status: "OPEN", source: "WEBSITE", company_name: `Same ${t}`, client_id: null });
    });

    test("a client with two leads keeps the OLDEST; the other is archived and points at it, and its children moved", async () => {
      expect((await lead(L.CONVERTED)).client_id).toBe(CL.TWIN);
      expect(await lead(L.TWIN)).toMatchObject({ status: "ARCHIVED", merged_into_lead_id: L.CONVERTED, client_id: null });
      expect((await req(Q.CONV_LOST)).lead_id).toBe(L.CONVERTED);
      const { rows } = await c.query("SELECT lead_id FROM meeting WHERE meeting_id = $1", [MEETING]);
      expect(rows[0].lead_id).toBe(L.CONVERTED);
      // The portal request named the client and no lead: it is on the client's row.
      expect((await req(Q.PORTAL)).lead_id).toBe(L.CONVERTED);
    });

    test("every request has its row, and one client has one row", async () => {
      const { rows: nulls } = await c.query("SELECT count(*)::int AS n FROM quote_request WHERE lead_id IS NULL");
      expect(nulls[0].n).toBe(0);
      const { rows: dupes } = await c.query(
        "SELECT client_id FROM lead WHERE client_id IS NOT NULL GROUP BY client_id HAVING count(*) > 1",
      );
      expect(dupes).toEqual([]);
    });

    test("a quotation reached only through an opportunity now names the request", async () => {
      const { rows } = await c.query("SELECT quote_request_id FROM quotation WHERE quotation_id = $1", [QUOTATION]);
      expect(rows[0].quote_request_id).toBe(Q.CONV_QUOTED);
    });

    test("every open row that owes a next step has one, dated, with a reminder; a client with nothing open does not", async () => {
      const withStep = await lead(L.NEW);
      const { rows } = await c.query("SELECT * FROM task WHERE task_id = $1", [withStep.next_step_task_id]);
      expect(rows[0]).toMatchObject({ title: "Follow up", entity_type: "lead", entity_id: L.NEW, assigned_to: OWNER, reminder_minutes: 15 });
      expect(rows[0].due_at).not.toBeNull();
      const { rows: rem } = await c.query("SELECT count(*)::int AS n FROM workspace_reminder WHERE owner_type = 'task' AND owner_id = $1", [rows[0].task_id]);
      expect(rem[0].n).toBe(1);
      // Lonely client: its only request is WON, so it owes nothing.
      const lonely = (await c.query("SELECT * FROM lead WHERE client_id = $1", [CL.LONELY])).rows[0];
      expect(lonely.next_step_task_id).toBeNull();
      const { rows: owing } = await c.query(
        `SELECT count(*)::int AS n FROM lead l
          WHERE l.status = 'OPEN' AND l.merged_into_lead_id IS NULL AND l.next_step_task_id IS NULL
            AND (l.client_id IS NULL OR EXISTS (SELECT 1 FROM quote_request q WHERE q.lead_id = l.lead_id AND q.stage NOT IN ('WON','LOST')))`,
      );
      expect(owing[0].n).toBe(0);
    });
  });

  /* ═══════════════════ 2-4. the services on committed rows ═══════════════════ */

  describe("the company row at work", () => {
    const leads = require("../../src/modules/sales/lead/lead.service");
    const requests = require("../../src/modules/sales/quote_request/quote_request.service");
    const publicIntake = require("../../src/modules/sales/public_intake/public_intake.service");
    const handler = require("../../src/orchestration/handlers/quotation-accepted-win-request");
    const actor = { user_id: OWNER };
    const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    let c;

    beforeAll(async () => { c = await connect(); });
    afterAll(() => c && c.release());

    test("the duplicate check refuses the same company typed another way, naming the row it is", async () => {
      const t = tag();
      // Nine digits of its own, so a re-run on the same database is a new company.
      const digits = String(crypto.randomInt(100000000, 999999999));
      const first = await leads.capture(c, {
        data: { company_name: `Kribi Reefers ${t} SARL`, phone: `+237 ${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 7)} ${digits.slice(7)}`, entity_id: ENTITY, next_step: { action: "Call back", due_at: tomorrow() } },
        actor,
      });
      expect(first.next_step).toMatchObject({ action: "Call back" });
      // Same name, other case and spacing.
      await expect(leads.capture(c, {
        data: { company_name: `KRIBI  REEFERS ${t} sarl`, email: `x-${t}@kribi.test`, next_step: { action: "Call back", due_at: tomorrow() } },
        actor,
      })).rejects.toMatchObject({ code: "LEAD_EXISTS", status: 409, details: expect.objectContaining({ lead_id: first.lead_id, matched_on: ["company"] }) });
      // Same phone, written the local way.
      await expect(leads.capture(c, {
        data: { company_name: `Someone Else ${t}`, phone: digits, next_step: { action: "Call back", due_at: tomorrow() } },
        actor,
      })).rejects.toMatchObject({ code: "LEAD_EXISTS" });
      // As you type: the start of the name is offered, not enforced.
      const typed = await leads.duplicates(c, { company_name: `kribi reefers ${t}` });
      expect(typed.similar.concat(typed.exact).map((r) => r.lead_id)).toContain(first.lead_id);
    });

    test("a website quote from a known email lands on the existing row: one company, two requests, one next step", async () => {
      const t = tag();
      const body = {
        requester_name: "Ada", requester_company: `Douala Fish ${t}`, requester_email: `ada-${t}@fish.test`,
        cargo_description: "Frozen fish", incoterm: "TBD", entity_id: ENTITY,
      };
      await publicIntake.submitQuote(c, body);
      await publicIntake.submitQuote(c, { ...body, requester_email: body.requester_email.toUpperCase(), cargo_description: "More fish" });
      const { rows } = await c.query("SELECT lead_id FROM quote_request WHERE requester_company = $1", [body.requester_company]);
      expect(rows).toHaveLength(2);
      expect(rows[0].lead_id).toBe(rows[1].lead_id);
      const row = await leads.get(c, rows[0].lead_id);
      expect(row).toMatchObject({ source: "WEBSITE", owner_user_id: OWNER, status: "OPEN" });
      expect(row.next_step).toMatchObject({ action: "Answer website request" });
      const { rows: steps } = await c.query("SELECT count(*)::int AS n FROM task WHERE entity_type = 'lead' AND entity_id = $1", [row.lead_id]);
      expect(steps[0].n).toBe(1);
    });

    test("the loop: Done with a next step; Done without one refused on an open prospect; Archive loses what was open", async () => {
      const t = tag();
      const row = await leads.capture(c, {
        data: { company_name: `Loop ${t}`, email: `loop-${t}@loop.test`, entity_id: ENTITY, next_step: { action: "Call back", due_at: tomorrow() } },
        actor,
      });
      const request = await requests.create(c, { data: { lead_id: row.lead_id, entity_id: ENTITY, title: "Two reefers" }, actor });
      expect(request.stage).toBe("NEW");

      const done = await leads.completeNextStep(c, {
        id: row.lead_id,
        data: { activity: { kind: "CALL", body: "Wants a price for two reefers" }, next_step: { action: "Send quotation", due_at: tomorrow() } },
        actor,
      });
      expect(done.lead.next_step).toMatchObject({ action: "Send quotation" });
      expect(done.activity).toMatchObject({ kind: "CALL" });
      const { rows: old } = await c.query("SELECT status FROM task WHERE task_id = $1", [row.next_step.task_id]);
      expect(old[0].status).toBe("DONE");

      await expect(leads.completeNextStep(c, {
        id: row.lead_id, data: { activity: { kind: "NOTE", body: "Nothing more" }, next_step: null }, actor,
      })).rejects.toMatchObject({ code: "NEXT_STEP_REQUIRED" });

      const archived = await leads.archive(c, { id: row.lead_id, reason: "Went elsewhere", reasonCode: "COMPETITOR", actor });
      expect(archived.lead).toMatchObject({ status: "ARCHIVED", archived_reason: "Went elsewhere", next_step: null });
      expect(archived.requests_lost).toBe(1);
      expect(await requests.get(c, request.quote_request_id)).toMatchObject({ stage: "LOST", lost_reason_code: "COMPETITOR" });
    });

    test("acceptance under retry opens ONE file, converts ONE client, wins ONE request", async () => {
      const t = tag();
      const row = await leads.capture(c, {
        data: { company_name: `Accept ${t}`, phone: `+237 ${crypto.randomInt(100000000, 999999999)}`, entity_id: ENTITY, next_step: { action: "Call back", due_at: tomorrow() } },
        actor,
      });
      const request = await requests.create(c, { data: { lead_id: row.lead_id, entity_id: ENTITY, title: `Accepted ${t}`, origin_location: "Antwerp", destination_location: "Douala" }, actor });
      const quotation = uid();
      await c.query(
        "INSERT INTO quotation (quotation_id, entity_id, quote_request_id, status) VALUES ($1, $2, $3, 'ACCEPTED')",
        [quotation, ENTITY, request.quote_request_id],
      );
      const event = { entity_ref: `quotation:${quotation}` };

      // Delivered twice AT ONCE, on two connections, then once more.
      const [a, b] = await Promise.all([connect(), connect()]);
      try {
        await Promise.all([handler.run(a, event), handler.run(b, event)]);
      } finally {
        a.release();
        b.release();
      }
      await handler.run(c, event);

      const won = await requests.get(c, request.quote_request_id);
      expect(won.stage).toBe("WON");
      expect(won.dossier_id).toBeTruthy();
      const { rows: files } = await c.query("SELECT dossier_id, title, pol, pod FROM dossier WHERE title = $1", [`Accepted ${t}`]);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatchObject({ dossier_id: won.dossier_id, pol: "Antwerp", pod: "Douala" });
      const { rows: clients } = await c.query("SELECT client_id, registration_status FROM client_master WHERE name = $1", [`Accept ${t}`]);
      expect(clients).toHaveLength(1);
      expect(clients[0].registration_status).toBe("DRAFT");
      expect((await leads.get(c, row.lead_id)).client_id).toBe(clients[0].client_id);
      const { rows: wins } = await c.query(
        "SELECT count(*)::int AS n FROM immutable_ledger WHERE entity_ref = $1 AND action = 'quote_request.won'",
        [`quote_request:${request.quote_request_id}`],
      );
      expect(wins[0].n).toBe(1);
    });
  });
});
