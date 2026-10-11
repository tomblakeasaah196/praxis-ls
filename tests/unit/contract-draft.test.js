"use strict";
/**
 * Drafting a contract (0700, rewritten 14402).
 *
 * ── WHAT THESE PROTECT ─────────────────────────────────────────────────────
 *
 * A contract is the one document where a helpful model is dangerous, and the
 * old split — terms from the caller, every clause from the model — was the
 * wrong line. What it produced was a five-article contract with no
 * classification, no CNPS, no leave, no medical cover and no dispute route,
 * which read perfectly and failed nothing.
 *
 * The line now is: the AGREEMENT comes from the library, and the DUTIES come
 * from the model. So these hold that
 *
 *   · the model is asked for the duties and told not to restate a term;
 *   · a model that fails, or returns one line, falls back to a written duties
 *     clause and the contract is otherwise unchanged — the row records which
 *     produced it, so nobody signs a template believing a model reviewed it;
 *   · a fact that was not given produces NO CLAUSE rather than a guess;
 *   · the document comes out in ONE language, the one it was drafted in.
 */

const drafter = require("../../src/modules/hr/hr_contract/hr_contract.draft");
const clauses = require("../../src/modules/hr/hr_contract/hr_contract.clauses");
const llm = require("../../src/services/ai/llm.service");
const { addMonths } = require("../../src/modules/hr/hr_contract/hr_contract.service");

const FULL = {
  kind: "EMPLOYMENT",
  language: "en",
  employee_name: "Ada Mbarga",
  employee_cnps: "CM-88231",
  job_title: "Customs Clearance Officer",
  department: "Operations",
  professional_category: "Agent de maîtrise, category 8, step B",
  entity_name: "Praxis Logistics SARL",
  entity_country: "CM",
  entity_address: "Douala, Cameroun",
  entity_rccm: "RC/DLA/2019/B/1234",
  effective_on: "2026-09-01",
  gross_salary: 450000,
  salary_currency: "XAF",
  probation_months: 3,
  notice_days: 30,
  working_hours: "08:00 to 17:00, Monday to Friday",
  place_of_work: "Douala",
  sop_titles: ["Staff Handbook", "Code of Conduct"],
};

/** The whole document, assembled the way `draft` assembles it, without a model
 *  in the way. This is what a tenant with no AI vendor gets. */
const assemble = (input = FULL, config = {}) => {
  const t = drafter.terms(input, config);
  t.duties_md = drafter.templateDuties(t);
  return clauses.toMarkdown(clauses.clausesFor(t, { kind: t.kind, lang: t.lang, config }));
};

describe("the assembled contract", () => {
  it("states every term it was given, and states it the way a person reads it", () => {
    const body = assemble();

    expect(body).toContain("Ada Mbarga");
    expect(body).toContain("Praxis Logistics SARL");
    expect(body).toContain("Customs Clearance Officer");
    // DAY FIRST. The contract the tenant was holding printed "2026-08-23" in
    // its term clause, which is the month-first trap the date gate exists for
    // everywhere else in the product.
    expect(body).toContain("01/09/2026");
    expect(body).not.toContain("2026-09-01");
    // The figure exactly as agreed — grouped for reading, never rounded.
    expect(body).toContain("450,000 XAF");
    expect(body).toContain("3 month(s)");
    expect(body).toContain("30 days");
    expect(body).toContain("Staff Handbook and Code of Conduct");
  });

  it("settles every subject the Labour Code expects a contract to settle", () => {
    // THE DEFECT THIS CLOSES. The contract in front of the tenant on
    // 11 Oct 2026 had five articles: engagement, term, pay, hours, place. No
    // classification, no CNPS, no leave, no medical cover, no notice schedule,
    // no dispute route. It read perfectly and nothing failed.
    const body = assemble();

    expect(body).toMatch(/## Parties/);
    expect(body).toMatch(/## Professional Classification/);
    expect(body).toMatch(/## Term/);
    expect(body).toMatch(/## Probationary Period/);
    expect(body).toMatch(/## Remuneration/);
    expect(body).toMatch(/## Social Security and Medical Cover/);
    expect(body).toMatch(/## Paid Leave/);
    expect(body).toMatch(/## Working Hours/);
    expect(body).toMatch(/## Notice and Termination/);
    expect(body).toMatch(/## Final Settlement/);
    expect(body).toMatch(/## Governing Law and Disputes/);
    expect(body).toContain("Caisse Nationale de Prévoyance Sociale");
    expect(body).toContain("labour inspector");
  });

  it("is long enough to be a contract rather than a form", () => {
    // The one-pager is the symptom the tenant actually reported. A real
    // employment contract runs to several pages; this is the floor that keeps
    // a future edit from quietly returning to five short articles.
    expect(assemble().length).toBeGreaterThan(5000);
  });

  it("omits the clause entirely when the fact is missing", () => {
    // The failure this prevents: a salary clause reading "the Employee's gross
    // monthly salary is null XAF", or worse, a plausible number.
    const body = assemble({ kind: "EMPLOYMENT", language: "en", employee_name: "Bo Nkemi", entity_name: "Praxis Logistics SARL" });

    expect(body).not.toMatch(/## Remuneration/);
    expect(body).not.toMatch(/## Probationary Period/);
    expect(body).not.toMatch(/## Term$/m);
    expect(body).not.toMatch(/null|undefined|\[|TBD/i);
    // …but the clauses whose facts ARE known still appear, and the statutory
    // ones that depend on no fact at all appear always.
    expect(body).toContain("Bo Nkemi");
    expect(body).toMatch(/## Notice and Termination/);
    expect(body).toMatch(/## Paid Leave/);
  });

  it("says the term is indefinite rather than leaving it unstated", () => {
    const open = assemble();
    expect(open).toMatch(/indefinite term/);

    const fixed = assemble({ ...FULL, end_on: "2027-08-31" });
    expect(fixed).toContain("31/08/2027");
    expect(fixed).toMatch(/fixed term/);
  });

  it("falls back to the statutory notice period when none was agreed", () => {
    const body = assemble({ ...FULL, notice_days: undefined });
    expect(body).toContain(`${drafter.DEFAULT_NOTICE_DAYS} days`);
  });

  it("writes the whole document in one language, never both", () => {
    const fr = assemble({ ...FULL, language: "fr" });

    expect(fr).toMatch(/## Rémunération/);
    expect(fr).toContain("Caisse Nationale de Prévoyance Sociale");
    // Not one English heading survives, which is the property the tenant asked
    // for: "only english or french".
    expect(fr).not.toMatch(/## Remuneration/);
    expect(fr).not.toMatch(/## Paid Leave/);
    // And French formats its own numbers and dates.
    expect(fr).toContain("01/09/2026");
    expect(fr).toMatch(/450\u00a0000 XAF/);
  });
});

describe("tidying what a model returns", () => {
  it("strips a fence, a title and a signature block", () => {
    // All three are supplied by the letterhead template. Left in, the document
    // carries the company name twice and two places to sign — the sort of thing
    // nobody notices until it is printed.
    const raw = [
      "```markdown",
      "# Employment Contract",
      "",
      "## Parties",
      "",
      "This agreement is made between A and B.",
      "",
      "## Signatures",
      "",
      "_______________  Employee",
      "```",
    ].join("\n");

    const out = drafter.tidy(raw);
    expect(out).not.toMatch(/```/);
    expect(out).not.toMatch(/^# /m);
    expect(out).not.toMatch(/Signatures/);
    expect(out).toContain("## Parties");
  });

  it("keeps a body that needs no tidying", () => {
    const body = "## Parties\n\nThis agreement is made between A and B.";
    expect(drafter.tidy(body)).toBe(body);
  });

  it("returns null for nothing", () => {
    expect(drafter.tidy("")).toBeNull();
    expect(drafter.tidy(null)).toBeNull();
  });
});

describe("drafting", () => {
  afterEach(() => jest.restoreAllMocks());

  it("uses the model's duties and records which model wrote them", async () => {
    const duties = "- Clear import declarations at the Douala customs office.\n- Track container releases and report delays daily.\n- Keep the dossier file complete for every consignment.";
    jest.spyOn(llm, "chat").mockResolvedValue({ text: duties, provider: "gemini" });

    const out = await drafter.draft({}, FULL);

    expect(out.ai_generated).toBe(true);
    expect(out.ai_model).toBe("gemini");
    // The duties land INSIDE the engagement clause, not as an article of their
    // own — a phantom numbered article is what a stray `## Duties` produces.
    expect(out.body_md).toContain("Clear import declarations");
    expect(out.body_md).not.toMatch(/## Duties/);
    // …and the rest of the contract is the library's, whatever the model said.
    expect(out.body_md).toMatch(/## Paid Leave/);
  });

  it("falls back to the written duties when the model fails, and says so", async () => {
    jest.spyOn(llm, "chat").mockRejectedValue(new Error("no vendor configured"));

    const out = await drafter.draft({}, FULL);

    // Never throws: an HR manager with no AI vendor must still get a document.
    expect(out.ai_generated).toBe(false);
    expect(out.ai_model).toBe("template");
    // And it is the SAME contract, missing only its author. That is the gain
    // over the old design, where losing the model lost every clause with it.
    expect(out.body_md).toContain("450,000 XAF");
    expect(out.body_md).toMatch(/## Notice and Termination/);
    expect(out.body_md).toMatch(/## Governing Law and Disputes/);
    expect(out.body_md).toContain("Customs Clearance Officer");
  });

  it("falls back when the model returns something too short to be a job", async () => {
    jest.spyOn(llm, "chat").mockResolvedValue({ text: "- Various duties.", provider: "gemini" });

    const out = await drafter.draft({}, FULL);
    expect(out.ai_generated).toBe(false);
    expect(out.ai_model).toBe("template");
    expect(out.body_md).not.toContain("Various duties");
  });

  it("asks for the duties only, and forbids restating a term", async () => {
    let captured = null;
    jest.spyOn(llm, "chat").mockImplementation(async ({ messages }) => {
      captured = messages;
      return { text: "x".repeat(300), provider: "gemini" };
    });

    await drafter.draft({}, FULL);

    const system = captured.find((m) => m.role === "system").content;
    expect(system).toMatch(/the DUTIES of the role, and nothing else/);
    expect(system).toMatch(/Do NOT restate the salary/);
    expect(system).toMatch(/Write in ENGLISH/);
    // The role reaches the model; the agreed figure travels only as context.
    const user = captured.find((m) => m.role === "user").content;
    expect(user).toContain("Customs Clearance Officer");
    expect(user).toContain("do not restate");
  });

  it("asks for French when the contract is French", async () => {
    let captured = null;
    jest.spyOn(llm, "chat").mockImplementation(async ({ messages }) => {
      captured = messages;
      return { text: "x".repeat(300), provider: "gemini" };
    });

    await drafter.draft({}, { ...FULL, language: "fr" });

    expect(captured.find((m) => m.role === "system").content).toMatch(/Write in FRENCH/);
  });

  it("keeps the temperature low — a contract is not a place for invention", async () => {
    let opts = null;
    jest.spyOn(llm, "chat").mockImplementation(async (o) => {
      opts = o;
      return { text: "x".repeat(300), provider: "gemini" };
    });
    await drafter.draft({}, FULL);
    expect(opts.temperature).toBeLessThanOrEqual(0.3);
  });

  it("does not spend a model call on a document that describes no job", async () => {
    // A certificate of employment and a termination letter state a status.
    // There is nothing for a duties clause to say, and a model call against the
    // tenant's AI budget would buy nothing.
    jest.spyOn(llm, "chat").mockResolvedValue({ text: "x".repeat(300), provider: "gemini" });

    await drafter.draft({}, { ...FULL, kind: "CONFIRMATION" });
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it("returns the review rather than correcting the terms", async () => {
    jest.spyOn(llm, "chat").mockRejectedValue(new Error("no vendor"));

    // The twenty-year fixed term from the contract the tenant was holding.
    const out = await drafter.draft({}, { ...FULL, effective_on: "2026-08-23", end_on: "2046-08-18" });

    expect(out.review.map((r) => r.code)).toContain("fixed_term_too_long");
    // And the term it prints is STILL the one the parties set. A product that
    // silently shortened it would be amending an agreement, not reporting.
    expect(out.body_md).toContain("18/08/2046");
  });
});

describe("the clauses that reach the PDF", () => {
  const { contractArticles } = require("../../src/modules/documents/template/template.service");

  it("turns the drafted body into the articles the renderer wants", () => {
    // THE OLDER BUG THIS STILL CLOSES. The EMPLOYMENT_CONTRACT data builder
    // said `articles: []`, so every contract this system generated rendered a
    // letterhead, both parties, a signature block — and NOT ONE CLAUSE.
    const arts = contractArticles(assemble());

    expect(arts.length).toBeGreaterThan(12);
    expect(arts.map((a) => a.title)).toEqual(
      expect.arrayContaining(["Parties", "Term", "Paid Leave", "Notice and Termination"]),
    );
    // The terms survive the split — this is what actually lands on the page.
    expect(arts.map((a) => a.body).join("\n")).toContain("450,000 XAF");
  });

  it("keeps text written above the first heading", () => {
    // A human editing the body is entitled to write a sentence at the top
    // without it silently vanishing from the printed contract.
    const arts = contractArticles("This agreement is entered into freely.\n\n## Parties\n\nA and B.");
    expect(arts[0]).toEqual({ title: "", body: "This agreement is entered into freely." });
    expect(arts[1].title).toBe("Parties");
  });

  it("is empty for an undrafted contract rather than one blank article", () => {
    expect(contractArticles(null)).toEqual([]);
    expect(contractArticles("   ")).toEqual([]);
  });
});

describe("recording the terms of a contract signed on paper", () => {
  const repo = require("../../src/modules/hr/hr_contract/hr_contract.repo");
  const emit = require("../../src/shared/events/emit");
  const service = require("../../src/modules/hr/hr_contract/hr_contract.service");

  /** `base.update` opens a transaction, so the fake client has to answer BEGIN
   *  and COMMIT. Nothing here exercises SQL — every repo call is faked. */
  const db = { query: async () => ({ rows: [] }) };

  const SIGNED = {
    hr_contract_id: "c1", status: "SIGNED", kind: "EMPLOYMENT",
    effective_on: "2024-03-01", body_md: "## Parties\n\nAs signed on paper.",
    title: "Employment contract", probation_months: null, notice_days: null,
  };

  beforeEach(() => {
    jest.spyOn(emit, "emitEvent").mockResolvedValue(undefined);
    jest.spyOn(emit, "audit").mockResolvedValue(undefined);
    jest.spyOn(emit, "resolveActorId").mockResolvedValue(null);
  });
  afterEach(() => jest.restoreAllMocks());

  it("lets the terms be recorded on a contract that is already signed", async () => {
    // The whole back catalogue was signed on paper. Refusing to record what it
    // says would mean the expiry watcher can never see an existing fixed term
    // and payroll can never know a notice period — for ever.
    jest.spyOn(repo, "findById").mockResolvedValue(SIGNED);
    const patched = [];
    jest.spyOn(repo, "update").mockImplementation(async (_c, id, p) => {
      patched.push(p);
      return { ...SIGNED, ...p };
    });

    await service.update(db, { id: "c1", patch: { notice_days: 30, probation_months: 3 }, actor: {} });

    expect(patched[0]).toMatchObject({ notice_days: 30, probation_months: 3 });
    // …and the watched date is derived, so an old contract becomes visible to
    // the probation warning the moment somebody types the months in.
    expect(patched[0].probation_ends_on).toBe("2024-06-01");
  });

  it("refuses to rewrite the wording of a signed contract", async () => {
    // `applyDraft` has always refused this; PATCH went straight to the CRUD
    // base with no guard at all, so the same edit was available by another
    // route. Changing signed wording is rewriting history — a renewal
    // supersedes it.
    jest.spyOn(repo, "findById").mockResolvedValue(SIGNED);
    jest.spyOn(repo, "update").mockResolvedValue(SIGNED);

    await expect(
      service.update(db, { id: "c1", patch: { body_md: "## Parties\n\nSomething else entirely." }, actor: {} }),
    ).rejects.toMatchObject({ code: "CONTRACT_TEXT_FROZEN", status: 422 });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("does not refuse a patch that merely resends the same wording", async () => {
    // A form that posts every field it holds must not be rejected for sending
    // back what is already stored.
    jest.spyOn(repo, "findById").mockResolvedValue(SIGNED);
    jest.spyOn(repo, "update").mockResolvedValue(SIGNED);

    await service.update(db, { id: "c1", patch: { body_md: SIGNED.body_md, notice_days: 30 }, actor: {} });
    expect(repo.update).toHaveBeenCalled();
  });

  it("still lets a draft be edited freely", async () => {
    jest.spyOn(repo, "findById").mockResolvedValue({ ...SIGNED, status: "DRAFT" });
    jest.spyOn(repo, "update").mockResolvedValue({ ...SIGNED, status: "DRAFT" });

    await service.update(db, { id: "c1", patch: { body_md: "## New wording" }, actor: {} });
    expect(repo.update).toHaveBeenCalled();
  });

  it("clears the probation date when the months are removed", async () => {
    jest.spyOn(repo, "findById").mockResolvedValue({ ...SIGNED, probation_months: 3, probation_ends_on: "2024-06-01" });
    const patched = [];
    jest.spyOn(repo, "update").mockImplementation(async (_c, id, p) => {
      patched.push(p);
      return SIGNED;
    });

    await service.update(db, { id: "c1", patch: { probation_months: null }, actor: {} });
    // Left standing, the watcher would go on warning about a probation nobody
    // is serving.
    expect(patched[0].probation_ends_on).toBeNull();
  });
});

describe("when probation ends", () => {
  it("counts whole months from the start date", () => {
    expect(addMonths("2026-09-01", 3)).toBe("2026-12-01");
    expect(addMonths("2026-08-16", 6)).toBe("2027-02-16");
  });

  it("clamps to the end of a shorter month", () => {
    // 31 January + 1 month is 28 February, not 3 March — which is what a naive
    // date roll produces, and it would put the probation deadline after the
    // date the employer actually had to act by.
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
  });

  it("returns null when there is nothing to count from", () => {
    expect(addMonths(null, 3)).toBeNull();
    expect(addMonths("2026-09-01", 0)).toBeNull();
    expect(addMonths("not-a-date", 3)).toBeNull();
  });
});
