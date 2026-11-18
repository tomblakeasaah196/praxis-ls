"use strict";
/**
 * Sales lean revamp, PR 4, against a real Postgres
 * (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §7 "PR 4", §8).
 *
 *   1. THE PROPOSAL MIGRATION (14542) on a fixture carrying every old status,
 *      a proposal already converted, narratives in both languages (SLAs as
 *      JSON) and a share link: rebuilt inside a transaction, the file applied
 *      verbatim TWICE (a re-run is a no-op), asserted, and rolled back.
 *   2. REVISE REVOKES V1'S LINK: v1 sent, v2 revised and sent; v1's link is
 *      the uniform 404 and its offer expired, v2's opens.
 *   3. ACCEPT ON THE LINK WINS THE REQUEST ONCE UNDER RETRY: a PROSPECT
 *      quotation (company row, no client, no request) accepted twice at once on
 *      the link, the win handler delivered twice at once and once more: one
 *      acceptance, one request won, one client made, one operations file.
 *   4. DECLINE WITH A REASON on the link: the reason is kept and the client
 *      says no exactly once.
 *   5. EXPIRY: past its day an offer cannot be answered, and the nightly job
 *      makes it EXPIRED.
 *
 * The mail and the PDF engine are stubbed (no SMTP and no Chrome here); the
 * render that feeds them is real. The tenant's e-signature menu is stubbed to
 * offer no digital card, so the link takes its confirmed-accept path; signing
 * itself is the signature programme's, covered by its own suites and by
 * tests/unit/portal-quotations.test.js.
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
const sqlOf = (name) => fs.readFileSync(path.join(MIGRATIONS, name), "utf8");
const uid = () => crypto.randomUUID();
const tag = () => crypto.randomBytes(3).toString("hex");
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

d("Sales lean revamp PR 4: quotations absorb proposals (real Postgres)", () => {
  let pool;
  const ENTITY = process.env.TEST_ENTITY_ID;
  const OWNER = uid();
  const actor = { user_id: OWNER };

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
      await c.query(
        "INSERT INTO app_user (user_id, email, full_name, password_hash, status) VALUES ($1, $2, 'Quote Owner', 'not-a-hash', 'ACTIVE')",
        [OWNER, `quote-owner-${tag()}@revamp.test`],
      );
    } finally {
      c.release();
    }
    // No SMTP and no Chrome in CI: the mail is accepted, the PDF is bytes.
    jest.spyOn(require("../../src/services/email.service"), "send").mockResolvedValue({ messageId: "<test@praxis>" });
    jest.spyOn(require("../../src/services/pdf.service"), "renderHtml").mockResolvedValue(Buffer.from("%PDF-1.4 test"));
    // The tenant offers no digital card: the link's confirmed accept.
    jest.spyOn(require("../../src/services/signatures/presets"), "resolveMenu").mockResolvedValue({ cards: [] });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (pool) await pool.end();
  });

  /* ═══════════════════ 1. the proposal migration ════════════════════════ */

  describe("14542 on a fixture with every proposal status", () => {
    let c;
    const t = tag();
    const LEAD = uid();
    const CLIENT = uid();
    const P = { DRAFT: uid(), IN_REVIEW: uid(), SENT: uid(), ACCEPTED: uid(), REJECTED: uid(), CONVERTED: uid() };
    const CONVERTED_QUOTE = uid();
    const TOKEN = `legacy-${t}`;
    const migrated = async (proposalId) =>
      (await c.query("SELECT * FROM quotation WHERE source_proposal_id = $1", [proposalId])).rows;
    const sectionsOf = async (quotationId) =>
      (await c.query("SELECT section_key, body_en, body_fr FROM quotation_section WHERE quotation_id = $1 ORDER BY section_key", [quotationId])).rows;

    beforeAll(async () => {
      c = await connect();
      await c.query("BEGIN");
      await c.query("INSERT INTO client_master (client_id, name) VALUES ($1, $2)", [CLIENT, `Proposal Client ${t}`]);
      await c.query(
        "INSERT INTO lead (lead_id, company_name, status, source, intake_channel, entity_id) VALUES ($1, $2, 'OPEN', 'MANUAL', 'MANUAL', $3)",
        [LEAD, `Proposal Prospect ${t}`, ENTITY],
      );
      await c.query(
        "INSERT INTO quotation (quotation_id, entity_id, client_id, status, total_ht, total_ttc) VALUES ($1, $2, $3, 'SENT', 100, 100)",
        [CONVERTED_QUOTE, ENTITY, CLIENT],
      );
      const rows = [
        [P.DRAFT, "DRAFT", LEAD, null, null, null],
        [P.IN_REVIEW, "IN_REVIEW", LEAD, null, null, null],
        [P.SENT, "SENT", LEAD, null, `PROP-${t}-S`, sha(TOKEN)],
        [P.ACCEPTED, "ACCEPTED", null, CLIENT, `PROP-${t}-A`, null],
        [P.REJECTED, "REJECTED", null, CLIENT, `PROP-${t}-R`, null],
        [P.CONVERTED, "ACCEPTED", null, CLIENT, `PROP-${t}-C`, null],
      ];
      for (const [id, status, lead, client, number, hash] of rows) {
        await c.query(
          `INSERT INTO proposal (proposal_id, status, lead_id, client_id, doc_number, title, language, currency,
                                 validity_days, payment_conditions, free_days_demurrage, share_token_hash, share_expires_at,
                                 converted_quote_id, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'BILINGUAL', 'XAF', 30, '50% advance', 7, $7, now() + interval '20 days', $8, now() - interval '2 days')`,
          [id, status, lead, client, number, `Proposal ${status} ${t}`, hash, id === P.CONVERTED ? CONVERTED_QUOTE : null],
        );
        await c.query("INSERT INTO proposal_line (proposal_id, label, qty, unit_price) VALUES ($1, 'Freight', 2, 450000), ($1, 'Handling', 1, 100000)", [id]);
        await c.query(
          `INSERT INTO proposal_narrative (proposal_id, section, language, body, sort_order) VALUES
             ($1, 'client_context', 'EN', 'Imports from Asia.', 0),
             ($1, 'client_context', 'FR', 'Importations d''Asie.', 0),
             ($1, 'operational_strategy', 'EN', 'One team.', 1),
             ($1, 'slas', 'EN', '[{"title":"Clearance","value":"72 hours","fact_ids":["F1"]}]', 2),
             ($1, 'scope', 'FR', 'Fret et dédouanement.', 3)`,
          [id],
        );
      }
      // The file, verbatim, twice: the second run must change nothing.
      await c.query(sqlOf("14542_proposals_become_quotations.sql"));
      await c.query(sqlOf("14542_proposals_become_quotations.sql"));
    });

    afterAll(async () => {
      if (!c) return;
      await c.query("ROLLBACK");
      c.release();
    });

    test("every proposal is one quotation, and a re-run makes no second", async () => {
      for (const id of [P.DRAFT, P.IN_REVIEW, P.SENT, P.ACCEPTED, P.REJECTED]) {
        expect(await migrated(id)).toHaveLength(1);
      }
    });

    test("statuses: IN_REVIEW becomes DRAFT, the others keep their names", async () => {
      expect((await migrated(P.DRAFT))[0].status).toBe("DRAFT");
      expect((await migrated(P.IN_REVIEW))[0].status).toBe("DRAFT");
      expect((await migrated(P.SENT))[0].status).toBe("SENT");
      expect((await migrated(P.ACCEPTED))[0].status).toBe("ACCEPTED");
      expect((await migrated(P.REJECTED))[0].status).toBe("REJECTED");
    });

    test("lines, totals, the company row and the dates carry over", async () => {
      const [q] = await migrated(P.SENT);
      expect(q).toMatchObject({ lead_id: LEAD, client_id: null, doc_number: `PROP-${t}-S`, created_from: "PROPOSAL", language: "BILINGUAL", default_output: "FULL" });
      expect(Number(q.total_ht)).toBe(1000000);
      expect(Number(q.total_ttc)).toBe(1000000);
      expect(q.sent_at).toBeTruthy();
      expect(q.valid_until).toBeTruthy();
      const { rows: lines } = await c.query("SELECT label, qty, unit_price, is_disbursement, tax_code_id FROM quotation_line WHERE quotation_id = $1 ORDER BY line_no", [q.quotation_id]);
      expect(lines.map((l) => [l.label, Number(l.qty), Number(l.unit_price), l.is_disbursement, l.tax_code_id])).toEqual([
        ["Freight", 2, 450000, false, null], ["Handling", 1, 100000, false, null],
      ]);
      const [accepted] = await migrated(P.ACCEPTED);
      expect(accepted.client_id).toBe(CLIENT);
      expect(accepted.answered_at).toBeTruthy();
    });

    test("narratives become sections per language, SLAs read as lines, terms from the fields", async () => {
      const [q] = await migrated(P.SENT);
      const s = Object.fromEntries((await sectionsOf(q.quotation_id)).map((r) => [r.section_key, r]));
      expect(s.needs).toMatchObject({ body_en: "Imports from Asia.", body_fr: "Importations d'Asie." });
      expect(s.solution.body_en).toBe("One team.\n\nClearance: 72 hours");
      expect(s.scope).toMatchObject({ body_en: null, body_fr: "Fret et dédouanement." });
      expect(s.terms.body_en).toBe("Payment: 50% advance\nFree days: 7");
      expect(s.terms.body_fr).toContain("Jours de franchise : 7");
    });

    test("a converted proposal adds its sections to its quotation, never a second quotation", async () => {
      const rows = await migrated(P.CONVERTED);
      expect(rows).toHaveLength(1);
      expect(rows[0].quotation_id).toBe(CONVERTED_QUOTE);
      expect(rows[0].title).toBe(`Proposal ACCEPTED ${t}`);
      expect((await sectionsOf(CONVERTED_QUOTE)).map((r) => r.section_key)).toEqual(expect.arrayContaining(["needs", "solution", "scope", "terms"]));
    });

    test("the old share link resolves to the migrated quotation", async () => {
      const publicProposal = require("../../src/modules/sales/proposal_public/proposal_public.service");
      const out = await publicProposal.get(c, TOKEN, "FR");
      expect(out.presentation).toMatchObject({ document_number: `PROP-${t}-S`, language: "FR" });
      expect(out.presentation.lines).toHaveLength(2);
      // Our Solution was written in English only: the French reader gets it
      // rather than nothing.
      expect(out.presentation.sections.map((x) => x.key)).toEqual(["needs", "solution", "scope", "terms"]);
    });
  });

  /* ═══════════════════ 2 to 5. the quotation at work ═══════════════════ */

  describe("the one document at work", () => {
    const leads = require("../../src/modules/sales/lead/lead.service");
    const quotations = require("../../src/modules/commercial/quotation/quotation.service");
    const sending = require("../../src/modules/commercial/quotation/quotation.send");
    const link = require("../../src/modules/commercial/quotation_public/quotation_public.service");
    const handler = require("../../src/orchestration/handlers/quotation-accepted-win-request");
    const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const tokenOf = (out) => decodeURIComponent(out.link.url.split("/q/")[1]);
    let c;

    beforeAll(async () => { c = await connect(); });
    afterAll(() => c && c.release());

    /** A prospect's company row and a draft quotation for it, priced. */
    async function prospectQuotation(name) {
      const row = await leads.capture(c, {
        // A phone as well: this tenant requires one on every client, and the
        // win makes the prospect a client (without one the win still happens
        // and the owner is told to finish the client by hand, PR 2).
        data: { company_name: name, email: `${tag()}@prospect.test`, phone: `+237 ${crypto.randomInt(100000000, 999999999)}`, entity_id: ENTITY, next_step: { action: "Call back", due_at: tomorrow() } },
        actor,
      });
      const q = await quotations.createDraft(c, {
        data: { lead_id: row.lead_id, entity_id: ENTITY, title: name, valid_until: tomorrow(), lines: [{ label: "Ocean freight", qty: 2, unit_price: 450000 }] },
        actor,
      });
      return { lead: row, quotation: q };
    }
    const send = (id, extra = {}) => sending.send(c, {
      id, input: { to: `buyer-${tag()}@prospect.test`, subject: "Your quotation", message: "Here it is.", ...extra }, actor, origin: "https://tenant.test", env: "live",
    });

    test("a draft starts from the Standard template, Your Needs and all", async () => {
      const { quotation } = await prospectQuotation(`Template ${tag()}`);
      expect(quotation.sections.map((s) => s.section_key)).toEqual(require("@praxis/shared").quotation.SECTION_KEYS);
      expect(quotation.sections.find((s) => s.section_key === "scope").body_en).toBeTruthy();
      expect(quotation.client_id).toBeNull();
      expect(quotation.lead_id).toBeTruthy();
      expect(quotation).not.toHaveProperty("share_token_hash");
    });

    test("Send: SENT, numbered, a request at Quoted, a link that opens, the follow-up set", async () => {
      const { lead, quotation } = await prospectQuotation(`Send ${tag()}`);
      const out = await send(quotation.quotation_id, { cc: [`boss-${tag()}@prospect.test`] });
      expect(out.quotation).toMatchObject({ status: "SENT", share_active: true });
      expect(out.quotation.doc_number).toBeTruthy();
      expect(out.mail).toMatchObject({ delivered: true, attached: true });
      const { rows: req } = await c.query("SELECT stage, lead_id FROM quote_request WHERE quote_request_id = $1", [out.quotation.quote_request_id]);
      expect(req[0]).toMatchObject({ stage: "QUOTED", lead_id: lead.lead_id });
      const opened = await link.open(c, { token: tokenOf(out), language: "FR", ip: "10.0.0.1", ua: UA });
      expect(opened).toMatchObject({ open: true, language: "FR" });
      expect(opened.html).toContain("Tarification");
      const { rows: seen } = await c.query("SELECT viewed_at FROM quotation WHERE quotation_id = $1", [quotation.quotation_id]);
      expect(seen[0].viewed_at).toBeTruthy();
      expect((await leads.get(c, lead.lead_id)).next_step).toMatchObject({ action: "Follow up quotation" });
    });

    test("revise revokes v1's link: v1 expires, v2 opens", async () => {
      const { quotation } = await prospectQuotation(`Revise ${tag()}`);
      const v1 = await send(quotation.quotation_id);
      const v1Token = tokenOf(v1);
      expect((await link.open(c, { token: v1Token, ua: UA })).open).toBe(true);

      const v2 = await sending.revise(c, { id: quotation.quotation_id, actor });
      expect(v2).toMatchObject({ status: "DRAFT", version: 2, supersedes_id: quotation.quotation_id });
      expect(v2.lines).toHaveLength(1);
      await expect(sending.revise(c, { id: quotation.quotation_id, actor })).rejects.toMatchObject({ code: "REVISION_OPEN" });
      // Until v2 is sent, v1 still stands.
      expect((await link.open(c, { token: v1Token, ua: UA })).open).toBe(true);

      await c.query("UPDATE quotation SET valid_until = $2 WHERE quotation_id = $1", [v2.quotation_id, tomorrow()]);
      const sent2 = await send(v2.quotation_id);
      await expect(link.open(c, { token: v1Token, ua: UA })).rejects.toMatchObject({ status: 404 });
      const { rows } = await c.query("SELECT status, share_revoked_at, superseded_at FROM quotation WHERE quotation_id = $1", [quotation.quotation_id]);
      expect(rows[0].status).toBe("EXPIRED");
      expect(rows[0].share_revoked_at).toBeTruthy();
      expect(rows[0].superseded_at).toBeTruthy();
      expect((await link.open(c, { token: tokenOf(sent2), ua: UA })).quotation.version).toBe(2);
      await expect(quotations.accept(c, { id: quotation.quotation_id, actor })).rejects.toBeTruthy();
    });

    test("accept on the link wins the request ONCE under retry: one client, one file", async () => {
      const name = `Link Accept ${tag()}`;
      const { lead, quotation } = await prospectQuotation(name);
      const out = await send(quotation.quotation_id);
      const token = tokenOf(out);

      // Accepted twice AT ONCE on two connections: one yes, one refusal.
      const [a, b] = await Promise.all([connect(), connect()]);
      let results;
      try {
        results = await Promise.allSettled([
          link.confirmAccept(a, { token, fullName: "Awa Ndiaye", role: "Director" }),
          link.confirmAccept(b, { token, fullName: "Awa Ndiaye", role: "Director" }),
        ]);
      } finally {
        a.release();
        b.release();
      }
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected").reason).toMatchObject({ status: 409 });
      await expect(link.confirmAccept(c, { token, fullName: "Awa Ndiaye" })).rejects.toMatchObject({ code: "QUOTATION_ANSWERED" });

      const { rows: q } = await c.query("SELECT status, answered_via, answered_by_name, quote_request_id FROM quotation WHERE quotation_id = $1", [quotation.quotation_id]);
      expect(q[0]).toMatchObject({ status: "ACCEPTED", answered_via: "LINK", answered_by_name: "Awa Ndiaye" });
      const { rows: accepted } = await c.query(
        "SELECT count(*)::int AS n FROM immutable_ledger WHERE entity_ref = $1 AND action = 'quotation.accepted'",
        [`quotation:${quotation.quotation_id}`],
      );
      expect(accepted[0].n).toBe(1);

      // The win handler, delivered twice at once and once more.
      const event = { entity_ref: `quotation:${quotation.quotation_id}`, actor_user_id: null };
      const [x, y] = await Promise.all([connect(), connect()]);
      try {
        await Promise.all([handler.run(x, event), handler.run(y, event)]);
      } finally {
        x.release();
        y.release();
      }
      await handler.run(c, event);

      const { rows: req } = await c.query("SELECT stage, dossier_id FROM quote_request WHERE quote_request_id = $1", [q[0].quote_request_id]);
      expect(req[0].stage).toBe("WON");
      expect(req[0].dossier_id).toBeTruthy();
      const { rows: files } = await c.query("SELECT count(*)::int AS n FROM dossier WHERE dossier_id = $1", [req[0].dossier_id]);
      expect(files[0].n).toBe(1);
      const { rows: clients } = await c.query("SELECT client_id, registration_status FROM client_master WHERE name = $1", [name]);
      expect(clients).toHaveLength(1);
      expect(clients[0].registration_status).toBe("DRAFT");
      expect((await leads.get(c, lead.lead_id)).client_id).toBe(clients[0].client_id);
      const { rows: wins } = await c.query(
        "SELECT count(*)::int AS n FROM immutable_ledger WHERE entity_ref = $1 AND action = 'quote_request.won'",
        [`quote_request:${q[0].quote_request_id}`],
      );
      expect(wins[0].n).toBe(1);
    });

    test("decline on the link with a reason from the list", async () => {
      const { quotation } = await prospectQuotation(`Decline ${tag()}`);
      const out = await send(quotation.quotation_id);
      const token = tokenOf(out);
      const opened = await link.open(c, { token, ua: UA });
      expect(opened.decline_reasons.length).toBeGreaterThan(0);
      const reason = opened.decline_reasons[0];
      await expect(link.decline(c, { token, reasonCode: "NOT_A_REASON" })).rejects.toMatchObject({ code: "UNKNOWN_DECLINE_REASON" });
      await link.decline(c, { token, reasonCode: reason.reason_code, note: "Too slow" });
      const { rows } = await c.query("SELECT status, answered_via, decline_reason_code, decline_reason FROM quotation WHERE quotation_id = $1", [quotation.quotation_id]);
      expect(rows[0]).toMatchObject({ status: "REJECTED", answered_via: "LINK", decline_reason_code: reason.reason_code });
      expect(rows[0].decline_reason).toBe(`${reason.label}: Too slow`);
      await expect(link.decline(c, { token, reasonCode: reason.reason_code })).rejects.toMatchObject({ code: "QUOTATION_ANSWERED" });
      // It still READS: the client sees what they declined.
      expect((await link.open(c, { token, ua: UA })).quotation.status).toBe("REJECTED");
    });

    test("expiry: past its day it cannot be answered, and the nightly job expires it", async () => {
      const { quotation } = await prospectQuotation(`Expiry ${tag()}`);
      const out = await send(quotation.quotation_id);
      const token = tokenOf(out);
      // The offer's last day was yesterday; the link itself is still open.
      await c.query("UPDATE quotation SET valid_until = CURRENT_DATE - 1 WHERE quotation_id = $1", [quotation.quotation_id]);
      const opened = await link.open(c, { token, ua: UA });
      expect(opened).toMatchObject({ open: false });
      expect(opened.quotation.status).toBe("EXPIRED");
      await expect(link.confirmAccept(c, { token, fullName: "Late Buyer" })).rejects.toMatchObject({ code: "QUOTATION_EXPIRED" });

      const done = await sending.expireOverdue(c);
      expect(done.expired).toBeGreaterThanOrEqual(1);
      const { rows } = await c.query("SELECT status FROM quotation WHERE quotation_id = $1", [quotation.quotation_id]);
      expect(rows[0].status).toBe("EXPIRED");
      // Sending it again is refused: an expired offer is revised, not re-sent.
      await expect(send(quotation.quotation_id)).rejects.toMatchObject({ status: 422 });
    });
  });
});
