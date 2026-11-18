"use strict";

/**
 * Lead 360 and Intake 360 — the aggregation's rules, without a database.
 *
 * The queries themselves are proven against real SQL in
 * tests/integration/sales-360.test.js. What is worth asserting here is the
 * judgement the service applies on top of them, because that is where a
 * dossier misleads someone rather than merely failing:
 *
 *   1. Money that the caller may not see comes back NULL, not 0. A tile reading
 *      "XAF 0" to someone who simply lacks finance visibility is a wrong
 *      answer; "—" is a true one. Counts are never gated.
 *   2. A brand-new record renders. Every figure 0, every collection [] — the
 *      same acceptance gate party-360 is built to (a fresh party must not throw
 *      or read as broken).
 *   3. The deal is the request (lean revamp D3). The opportunity, the proposal
 *      and the pipeline stages were dropped in PR 7, so nothing here reads
 *      them: the deal's figures (open requests, won requests, open value) come
 *      from the requests themselves, and the open value counts open stages only.
 *
 * The client is mocked by matching on SQL text rather than by call order, so
 * adding a query to the service does not silently shift every later assertion
 * onto the wrong mock.
 */

const svc = require("../../src/modules/sales/sales-360.service");

/**
 * A pg client whose `query` answers by the first pattern that matches the SQL.
 * Unmatched queries return no rows, which is what an empty record looks like.
 */
function clientOf(routes = []) {
  const calls = [];
  return {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
      for (const [pattern, rows] of routes) {
        if (pattern.test(String(sql))) return { rows: typeof rows === "function" ? rows(params) : rows };
      }
      return { rows: [] };
    }),
  };
}

const LEAD_ROW = { lead_id: "L1", company_name: "Tema Shipping", status: "OPEN" };

/** The tables PR 7 dropped. No query of a 360 may name one. */
const RETIRED = /\b(opportunity|pipeline_stage|proposal|proposal_line|proposal_narrative)\b/i;

describe("money gating", () => {
  test("money() hides a figure as null rather than zero", () => {
    expect(svc.money(500, true)).toBe(500);
    expect(svc.money(500, false)).toBeNull();
    // A real zero survives when the caller may see it — the point is that the
    // two cases stay distinguishable in both directions.
    expect(svc.money(0, true)).toBe(0);
    expect(svc.money(null, true)).toBe(0);
  });

  test("a request's value is null for a caller without finance visibility, and its stage is not", async () => {
    const rows = [{ quote_request_id: "Q1", stage: "QUOTED", estimated_value: "8000000", currency: "XAF" }];
    const c = clientOf([[/FROM quote_request q/, rows]]);
    expect((await svc.leadRequests(c, "L1", true))[0].estimated_value).toBe(8000000);
    const [hidden] = await svc.leadRequests(c, "L1", false);
    expect(hidden.estimated_value).toBeNull();
    expect(hidden.stage).toBe("QUOTED");
  });

  test("a request with no value stays null either way: unknown is not zero", async () => {
    const c = clientOf([[/FROM quote_request q/, [{ quote_request_id: "Q1", stage: "NEW", estimated_value: null }]]]);
    expect((await svc.leadRequests(c, "L1", true))[0].estimated_value).toBeNull();
  });

  test("a quotation's total is gated like every other figure", async () => {
    const rows = [{ quotation_id: "QT1", status: "SENT", total_ttc: "4000000", valid_until: "2999-01-01" }];
    const c = clientOf([[/FROM quotation qt/, rows]]);
    expect((await svc.leadQuotations(c, { lead_id: "L1" }, true))[0].total_ttc).toBe(4000000);
    expect((await svc.leadQuotations(c, { lead_id: "L1" }, false))[0].total_ttc).toBeNull();
  });
});

describe("lead KPIs", () => {
  const base = {
    meetings: [
      { sections: [{ has_body: true }, { has_body: true }, { has_body: false }] },
      { sections: [{ has_body: true }] },
    ],
    quoteRequests: [{}, {}],
    enquiries: [{}],
  };

  test("counts add up and only captured sections count", () => {
    const k = svc.leadKpis({ ...base, canSee: true });
    expect(k.meetings).toBe(2);
    expect(k.discovery_sections_captured).toBe(3);
    expect(k.quote_requests).toBe(2);
    expect(k.enquiries).toBe(1);
    expect(k.money_visible).toBe(true);
  });

  test("the retired opportunity and proposal figures are gone, not zeroed", () => {
    const k = svc.leadKpis({ ...base, canSee: true });
    for (const gone of [
      "proposals", "proposals_sent", "proposals_accepted", "proposals_value",
      "opportunities", "open_opportunities", "won_opportunities", "lost_opportunities",
      "open_pipeline_value", "weighted_pipeline_value",
    ]) {
      expect(k).not.toHaveProperty(gone);
    }
  });

  test("a lead with nothing on it produces zeros, not NaN or undefined", () => {
    const k = svc.leadKpis({ meetings: [], quoteRequests: [], enquiries: [], canSee: true });
    for (const [key, v] of Object.entries(k)) {
      if (key === "money_visible") continue;
      expect(v).toBe(0);
    }
  });

  test("the deal's figures come from the requests: open value counts open stages only", async () => {
    const requests = [
      { quote_request_id: "Q1", stage: "QUOTED", estimated_value: "8000000" },
      { quote_request_id: "Q2", stage: "NEW", estimated_value: "2000000" },
      { quote_request_id: "Q3", stage: "WON", estimated_value: "5000000" },
      { quote_request_id: "Q4", stage: "LOST", estimated_value: "1000000" },
    ];
    const routes = [[/FROM lead l/, [LEAD_ROW]], [/FROM quote_request q\s+LEFT JOIN service_type/, requests]];
    const seen = await svc.leadDossier(clientOf(routes), { leadId: "L1", canSeeFinancials: true });
    expect(seen.kpis).toMatchObject({ open_requests: 2, won_requests: 1, open_value: 10000000, money_visible: true });

    const hidden = await svc.leadDossier(clientOf(routes), { leadId: "L1", canSeeFinancials: false });
    expect(hidden.kpis).toMatchObject({ open_requests: 2, won_requests: 1, open_value: null, money_visible: false });
  });
});

describe("leadDossier", () => {
  test("a brand-new lead renders — every collection empty, nothing thrown", async () => {
    const c = clientOf([[/FROM lead l/, [LEAD_ROW]]]);
    const d = await svc.leadDossier(c, { leadId: "L1", canSeeFinancials: true });

    expect(d.lead.company_name).toBe("Tema Shipping");
    for (const k of ["meetings", "quote_requests", "enquiries", "timeline", "activity", "requests", "quotations"]) {
      expect(d[k]).toEqual([]);
    }
    // The retired collections are gone from the payload, not sent empty.
    expect(d).not.toHaveProperty("proposals");
    expect(d).not.toHaveProperty("opportunities");
    expect(d.client).toBeNull();
    expect(d.kpis.meetings).toBe(0);
    expect(d.kpis.open_value).toBe(0);
  });

  test("no query of the Lead 360 names a table PR 7 dropped", async () => {
    const c = clientOf([[/FROM lead l/, [LEAD_ROW]]]);
    await svc.leadDossier(c, { leadId: "L1", canSeeFinancials: true, user: { user_id: "U1" } });
    expect(c.calls.length).toBeGreaterThan(5);
    for (const call of c.calls) expect([call.sql, RETIRED.test(call.sql)]).toEqual([call.sql, false]);
  });

  test("an unknown lead is a 404, not an empty dossier", async () => {
    const c = clientOf([]);
    await expect(svc.leadDossier(c, { leadId: "nope" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  test("the converted client is a card, and only when there is one", async () => {
    const c = clientOf([
      [/FROM lead l/, [{ ...LEAD_ROW, client_id: "C1", client_name: "Tema Shipping SA", public_reference_consent: "NAMED" }]],
    ]);
    const d = await svc.leadDossier(c, { leadId: "L1" });
    expect(d.client).toEqual({
      client_id: "C1",
      name: "Tema Shipping SA",
      public_reference_consent: "NAMED",
    });
  });

  test("the timeline reads this lead's own ref from the immutable ledger", async () => {
    const c = clientOf([[/FROM lead l/, [LEAD_ROW]]]);
    await svc.leadDossier(c, { leadId: "L1" });
    // The History tab's read: this lead's own ref. (The Activity timeline also
    // reads the ledger, for its requests' stage moves; that query is keyed on
    // the requests, below.)
    const ledger = c.calls.find((x) => /immutable_ledger/.test(x.sql) && /entity_ref = \$1/.test(x.sql));
    expect(ledger).toBeTruthy();
    expect(ledger.params[0]).toBe("lead:L1");
  });

  test("the Activity timeline merges what happened, where it lives, newest first", async () => {
    const c = clientOf([
      [/FROM lead l/, [LEAD_ROW]],
      [/FROM lead_activity a/, [{ lead_activity_id: "A1", kind: "CALL", body: "Rang Ada", occurred_at: "2026-11-10T09:00:00Z" }]],
      [/FROM meeting m\s+WHERE m.lead_id/, [{ meeting_id: "M1", subject: "Visit", scheduled_at: "2026-11-12T09:00:00Z" }]],
      [/stage_moved/, [{ ledger_id: 9, action: "quote_request.stage_moved", entity_ref: "quote_request:Q1", after_json: { stage: "QUOTED" }, created_at: "2026-11-11T09:00:00Z" }]],
    ]);
    const d = await svc.leadDossier(c, { leadId: "L1", canSeeFinancials: true });
    expect(d.activity.map((i) => i.type)).toEqual(["meeting", "stage", "activity"]);
    expect(d.activity[1]).toMatchObject({ kind: "STAGE_MOVED", title: "QUOTED", quote_request_id: "Q1" });
    // No caller, no mail: a thread is shown only to someone mail's own rule lets read it.
    expect(c.calls.some((x) => /email_thread/.test(x.sql))).toBe(false);
    expect(d.counts).toEqual({ activity: 3, requests: 0, quotations: 0 });
  });

  test("Company Profile shares and their opens land on the Activity (PR 3, from PR 6)", async () => {
    const c = clientOf([
      [/FROM lead l/, [LEAD_ROW]],
      [/FROM company_profile_share s/, [{ share_id: "S1", recipient_name: "Ada", recipient_email: "ada@tema.example", created_at: "2026-11-10T09:00:00Z", author_name: "Awa" }]],
      [/FROM company_profile_share_open o/, [
        { open_id: "O2", share_id: "S1", kind: "DOWNLOAD", opened_at: "2026-11-12T09:00:00Z" },
        { open_id: "O1", share_id: "S1", kind: "VIEW", opened_at: "2026-11-11T09:00:00Z" },
      ]],
    ]);
    const d = await svc.leadDossier(c, { leadId: "L1" });
    expect(d.activity.map((i) => [i.type, i.kind])).toEqual([
      ["profile_share", "DOWNLOADED"],
      ["profile_share", "OPENED"],
      ["profile_share", "SHARED"],
    ]);
    expect(d.activity[2]).toMatchObject({ title: "Ada", author_name: "Awa", ref: { type: "company_profile_share", id: "S1" } });
    const shares = c.calls.find((x) => /FROM company_profile_share s/.test(x.sql));
    expect(shares.params[0]).toBe("L1");
    expect(c.calls.find((x) => /company_profile_share_open/.test(x.sql)).params[0]).toEqual(["S1"]);
  });

  test("no share, no second query for opens", async () => {
    const c = clientOf([[/FROM lead l/, [LEAD_ROW]]]);
    await svc.leadDossier(c, { leadId: "L1" });
    expect(c.calls.some((x) => /company_profile_share_open/.test(x.sql))).toBe(false);
  });

  test("bound mail threads go through mail's visibility rule for the caller", async () => {
    const c = clientOf([[/FROM lead l/, [LEAD_ROW]]]);
    await svc.leadDossier(c, { leadId: "L1", user: { user_id: "U1" } });
    const mail = c.calls.find((x) => /email_thread/.test(x.sql));
    expect(mail.sql).toMatch(/t\.visibility = 'PRIVATE'/);
    expect(mail.params).toEqual(["lead:L1", "U1", 25]);
  });

  test("discovery sections land on the meeting they belong to", async () => {
    const c = clientOf([
      [/FROM meeting m/, [{ meeting_id: "M1" }, { meeting_id: "M2" }]],
      [
        /FROM meeting_discovery_section/,
        [
          { meeting_id: "M1", section_key: "OPERATIONS", has_body: true, capture_state: "TYPED" },
          { meeting_id: "M2", section_key: "PAIN_POINTS", has_body: false, capture_state: "FAILED" },
          { meeting_id: "M1", section_key: "STRATEGY", has_body: true, capture_state: "TRANSCRIBED" },
        ],
      ],
    ]);
    const [m1, m2] = await svc.leadMeetings(c, "L1");
    expect(m1.sections.map((s) => s.section_key)).toEqual(["OPERATIONS", "STRATEGY"]);
    expect(m2.sections.map((s) => s.section_key)).toEqual(["PAIN_POINTS"]);
    // A section whose dictation failed must be visibly in that state rather
    // than silently empty — F1's definition of done.
    expect(m2.sections[0].capture_state).toBe("FAILED");
    expect(m2.sections[0].has_body).toBe(false);
  });

  test("no meetings means no second query for their sections", async () => {
    const c = clientOf([]);
    expect(await svc.leadMeetings(c, "L1")).toEqual([]);
    expect(c.calls.some((x) => /meeting_discovery_section/.test(x.sql))).toBe(false);
  });
});

describe("intakeDossier", () => {
  const REQ = {
    quote_request_id: "Q1",
    public_ref: "SQ-2026-0001",
    stage: "NEW",
    created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
  };

  test("the retired opportunity and proposal are gone from the Intake 360", async () => {
    // A row 14512 made from an opportunity still carries the old id, for old
    // links (quote_request.converted_opportunity_id). The 360 reads nothing
    // through it: there is no opportunity to read.
    const c = clientOf([[/FROM quote_request q/, [{ ...REQ, lead_id: "L1", converted_opportunity_id: "O9" }]]]);
    const d = await svc.intakeDossier(c, { quoteRequestId: "Q1", canSeeFinancials: true });
    expect(d).not.toHaveProperty("converted_opportunity");
    expect(d).not.toHaveProperty("proposals");
    expect(d.kpis).not.toHaveProperty("is_converted");
    expect(d.kpis).not.toHaveProperty("converted_value");
    expect(d.kpis).not.toHaveProperty("proposals");
    for (const call of c.calls) expect([call.sql, RETIRED.test(call.sql)]).toEqual([call.sql, false]);
  });

  test("age counts days open, and stops counting once the request is settled", async () => {
    const open = clientOf([[/FROM quote_request q/, [REQ]]]);
    expect((await svc.intakeDossier(open, { quoteRequestId: "Q1" })).kpis.age_days).toBe(3);

    const won = clientOf([
      [
        /FROM quote_request q/,
        [{ ...REQ, stage: "WON", settled_at: new Date(new Date(REQ.created_at).getTime() + 86400000).toISOString() }],
      ],
    ]);
    expect((await svc.intakeDossier(won, { quoteRequestId: "Q1" })).kpis.age_days).toBe(1);
  });

  test("the lead is a card when there is one", async () => {
    const noLead = clientOf([[/FROM quote_request q/, [REQ]]]);
    expect((await svc.intakeDossier(noLead, { quoteRequestId: "Q1" })).lead).toBeNull();

    const withLead = clientOf([[/FROM quote_request q/, [{ ...REQ, lead_id: "L1", lead_company_name: "Tema Shipping", lead_status: "OPEN" }]]]);
    const d = await svc.intakeDossier(withLead, { quoteRequestId: "Q1" });
    expect(d.lead).toEqual({ lead_id: "L1", company_name: "Tema Shipping", status: "OPEN" });
  });

  test("an unknown request is a 404", async () => {
    await expect(
      svc.intakeDossier(clientOf([]), { quoteRequestId: "nope" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  test("attachments put the primary first", async () => {
    const c = clientOf([[/FROM quote_request_attachment/, [{ kind: "PRIMARY" }, { kind: "ADDITIONAL" }]]]);
    await svc.intakeAttachments(c, "Q1");
    const sql = c.calls[0].sql;
    expect(sql).toMatch(/ORDER BY \(a\.kind = 'PRIMARY'\) DESC/);
  });
});

describe("no cost or margin column is named in any query", () => {
  /**
   * Rule 1 of doc/SALES_CRM_FEATURES.md is about model input, and nothing here
   * reaches a model — but the discipline is cheap to keep and this is the file
   * that would quietly break it, since a dossier is exactly where somebody
   * would be tempted to add "profitability".
   */
  test("the service source mentions no cost or margin field", () => {
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "../../src/modules/sales/sales-360.service.js"),
      "utf8",
    );
    // Strip comments — the header discusses the rule by name.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of ["margin", "cost_", "_cost", "buy_price", "profit"]) {
      expect(code.toLowerCase()).not.toContain(forbidden);
    }
  });
});
