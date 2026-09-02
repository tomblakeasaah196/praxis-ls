"use strict";
/**
 * Composing a contract, and the one thing a model is allowed to do to it (0700,
 * 12766).
 *
 * ── WHAT THESE PROTECT ─────────────────────────────────────────────────────
 *
 * A contract is the one document where a helpful model is dangerous. Rounding a
 * salary, "tidying" a notice period or filling in a probation length nobody
 * agreed invents a term the employer will then SIGN. The libraries removed that
 * risk by construction — the model never writes a term — and what is left to
 * protect is the boundary itself:
 *
 *   · the composer REFUSES, naming every missing fact, rather than producing a
 *     document with a hole where a legal identification belongs;
 *   · an article whose subject does not exist is dropped ON PURPOSE and
 *     recorded, and the articles below it renumber;
 *   · a rewritten clause that moved a token, changed a figure or grew a heading
 *     is discarded, and the authored clause — the one counsel reviewed — stands.
 */

const refiner = require("../../src/modules/hr/hr_contract/hr_contract.draft");
const composer = require("../../src/modules/hr/hr_contract/hr_contract.compose");
const libraries = require("../../src/services/contracts/libraries");
const llm = require("../../src/services/ai/llm.service");
const { addMonths } = require("../../src/modules/hr/hr_contract/hr_contract.service");

/** A composition row as `repo.composition` returns it: the contract, with the
 *  employee, entity, representative and standing pay lines attached. */
const ROW = {
  hr_contract_id: "c1",
  kind: "EMPLOYMENT",
  status: "DRAFT",
  effective_on: "2026-09-01",
  end_on: null,
  employee: {
    employee_id: "e1", full_name: "Ada Mbarga", civility: "MRS", gender: "FEMALE",
    date_of_birth: "1992-04-11", place_of_birth: "Yaoundé",
    father_name: "Mbarga Paul", mother_name: "Ngo Bell Rose", nationality: "CM",
    id_document_type: "CNI", id_document_number: "114455667",
    id_document_issued_on: "2020-01-20", id_document_issued_at: "Yaoundé",
    residence_address: "Rue 2.045, Bonapriso", residence_city: "Douala",
    staff_no: "SLAS-021", job_title: "Customs Clearance Officer", department: "Operations",
    employment_type: "CDI", base_salary: 450000, salary_currency: "XAF",
    probation_months: 3, place_of_work: "Douala",
    working_hours: "08:00–17:00, Monday to Friday", payment_method: "BANK_TRANSFER",
  },
  entity: {
    entity_id: "en1", legal_name: "Praxis Logistics SARL", legal_form: "SARL",
    address: "Boulevard de la Liberté, Akwa", po_box: "BP 1234", country_code: "CM",
    phone: "+237 233 00 00 00", email: "rh@praxis.cm", default_language: "en",
  },
  representative: { person_id: "p1", full_name: "Marc-Aurèle Ngassa", title: "Gérant", role: "LEGAL_REPRESENTATIVE" },
  allowances: [
    { label: "Responsibility allowance", amount: 50000, kind: "ALLOWANCE", in_gross: true },
    { label: "Company vehicle", amount: 80000, kind: "BENEFIT_IN_KIND", in_gross: false },
  ],
};

describe("composing a contract", () => {
  it("states every term it was given, and the gross it adds up to", () => {
    const built = composer.build(ROW);

    expect(built.columns.clause_library_key).toBe("CDI");
    expect(built.columns.language).toBe("en");
    expect(built.body_md).toContain("Ada Mbarga");
    expect(built.body_md).toContain("Praxis Logistics SARL");
    expect(built.body_md).toContain("Customs Clearance Officer");
    expect(built.body_md).toContain("SLAS-021");
    // The base and the allowance are listed, and the total is their sum. A
    // benefit in kind is remuneration and is taxed, but nobody is handed it —
    // counting it would state a monthly figure the payslip can never match.
    expect(built.columns.base_salary).toBe(450000);
    expect(built.columns.gross_salary).toBe(500000);
    expect(built.body_md).toContain("Responsibility allowance");
    expect(built.body_md).toContain("Company vehicle");
    // Not a single token survives into the document.
    expect(built.body_md).not.toMatch(/\{\{|\}\}/);
  });

  it("freezes the employee and the pay as at composition", () => {
    // A correction typed next year must not rewrite the identification clause
    // of a contract signed this one.
    const built = composer.build(ROW);
    expect(built.columns.employee_snapshot.id_document_number).toBe("114455667");
    expect(built.columns.pay_snapshot.monthly_gross).toBe(500000);
    expect(built.columns.pay_snapshot.lines).toHaveLength(2);
  });

  it("takes the contract's own terms over the employee's current ones", () => {
    // The difference between a record and an instrument: a signed contract at
    // 450,000 does not change because somebody typed a raise this morning.
    const built = composer.build({ ...ROW, base_salary: 400000, job_title: "Operations Supervisor" });
    expect(built.columns.base_salary).toBe(400000);
    expect(built.columns.job_title).toBe("Operations Supervisor");
  });

  it("refuses, naming every missing fact at once", () => {
    const thin = { ...ROW, employee: { ...ROW.employee, father_name: null, mother_name: null, id_document_number: null } };

    expect(() => composer.build(thin)).toThrow(
      expect.objectContaining({ code: "CONTRACT_FACT_MISSING", status: 422 }),
    );
    // All three, not the first one six saves in a row.
    const state = composer.readiness(thin);
    expect(state.ready).toBe(false);
    expect(state.missing).toEqual(
      expect.arrayContaining(["employee.father_name", "employee.mother_name", "employee.id_number"]),
    );
  });

  it("never throws when asked what is missing", () => {
    // The wizard polls this as somebody types. An endpoint that 422s on an
    // incomplete form cannot be used to say what is incomplete about it.
    expect(() => composer.readiness({ kind: "EMPLOYMENT" })).not.toThrow();
    expect(composer.readiness({ kind: "EMPLOYMENT" }).ready).toBe(false);
  });

  it("drops the probation article when no probation was agreed, and renumbers", () => {
    // Art. 28 makes probation a stipulation, not a default. "A probationary
    // period of  months" is not a clause, it is a defect — and the articles
    // below it must not go on claiming numbers that no longer describe the
    // document.
    const full = composer.build(ROW);
    const none = composer.build({ ...ROW, employee: { ...ROW.employee, probation_months: null } });

    expect(none.composed.articles).toHaveLength(full.composed.articles.length - 1);
    expect(none.composed.omitted).toEqual([
      expect.objectContaining({ key: "probation", because: ["term.probation_months"] }),
    ]);
    expect(none.body_md).not.toMatch(/probationary period/i);
    // Renumbered, with no gap and no repeat.
    const numbers = none.composed.articles.map((a) => a.number);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
    expect(none.composed.articles[1].printed_heading).toMatch(/^ARTICLE 2: /);
  });

  it("refuses a fixed term with no term rather than composing one without", () => {
    // A CDD with no end date is not a CDD — art. 26 converts it the moment the
    // relationship outlives a term nobody wrote down.
    const cdd = { ...ROW, employee: { ...ROW.employee, employment_type: "CDD" } };
    expect(composer.readiness(cdd).missing).toEqual(
      expect.arrayContaining(["term.end_date", "term.duration_months"]),
    );
    // The same facts make a perfectly good CDI.
    expect(composer.readiness(ROW).ready).toBe(true);
  });

  it("counts a fixed term to its last day, inclusive", () => {
    // 1 October to 30 September is twelve months. Reading it as eleven would
    // understate every fixed term in the system against the art. 25 ceiling.
    expect(composer.monthsBetween("2026-10-01", "2027-09-30")).toBe(12);
    expect(composer.monthsBetween("2026-01-31", "2026-02-28")).toBe(1);
    // Shorter than a month: null, so the composer refuses rather than printing
    // "a duration of 0 months".
    expect(composer.monthsBetween("2026-01-01", "2026-01-15")).toBeNull();
  });

  it("uses the entity's language unless the contract states one", () => {
    expect(composer.build(ROW).columns.language).toBe("en");
    expect(composer.build({ ...ROW, language: "fr" }).columns.language).toBe("fr");
    expect(composer.build(ROW, { overrides: { language: "fr" } }).columns.language).toBe("fr");
    // One language, never both — a bilingual instrument raises
    // which-version-governs.
    const fr = composer.build({ ...ROW, language: "fr" });
    expect(fr.body_md).toContain("CONTRAT");
    expect(fr.body_md).not.toContain("ARTICLE 1: ENGAGEMENT AND DURATION");
  });

  it("names the employer's signatory from the entity's own register", () => {
    const built = composer.build(ROW);
    expect(built.body_md).toContain("Marc-Aurèle Ngassa");
    expect(built.body_md).toContain("Gérant");
  });
});

describe("the eighteen libraries", () => {
  it("carries fr and en of every key, with identical articles in identical order", () => {
    // The two languages are ONE document in two tongues. A clause added to the
    // French and forgotten in the English is a different contract, silently.
    const all = libraries.all();
    expect(all).toHaveLength(18);

    for (const key of libraries.LIBRARY_KEYS) {
      const fr = libraries.get(key, "fr");
      const en = libraries.get(key, "en");
      expect(fr.articles.map((a) => a.key)).toEqual(en.articles.map((a) => a.key));
      expect(fr.requires || []).toEqual(en.requires || []);
      expect(fr.articles.map((a) => a.aiEditable)).toEqual(en.articles.map((a) => a.aiEditable));
    }
  });

  it("cites an authority for every article, and numbers none of them", () => {
    for (const lib of libraries.all()) {
      for (const a of lib.articles) {
        // An article with no basis is a clause somebody invented.
        expect(a.basis && a.basis.length).toBeGreaterThan(10);
        // The composer numbers what it emitted; an authored number would go on
        // saying "ARTICLE 4" after the article above it was dropped.
        expect(a.heading).not.toMatch(/^ARTICLE\s*\d/i);
      }
    }
  });

  it("lets only a letter carry a section with no heading", () => {
    // A letter's sign-off — « Veuillez agréer … » — has no heading, and the
    // composer marks it with a bare `##`. `contractArticles` required a title
    // after the hashes, so that line did not match: the printed contract
    // carried a literal "##" and the sign-off was glued onto the end of the
    // clause above it. An ARTICLE with no heading would print "ARTICLE 7 : ".
    for (const lib of libraries.all()) {
      for (const a of lib.articles) {
        if (!a.heading) expect(lib.sectionStyle).toBe("letter");
      }
    }
  });

  it("declares the leash on every article rather than defaulting it", () => {
    for (const lib of libraries.all()) {
      for (const a of lib.articles) expect(typeof a.aiEditable).toBe("boolean");
    }
  });

  it("only names optional tokens in requires and omitWhenMissing", () => {
    // Naming a token that is already required is a no-op the author believed
    // did something — the article can never be dropped, the document can never
    // relax it. Naming one that does not exist is a silent no-op too.
    const { TOKENS } = require("../../src/services/contracts/clause-tokens");
    for (const lib of libraries.all()) {
      for (const t of lib.requires || []) {
        expect(TOKENS[t]).toBeDefined();
        expect(TOKENS[t].optional).toBe(true);
      }
      for (const a of lib.articles) {
        for (const t of a.omitWhenMissing || []) {
          expect(TOKENS[t]).toBeDefined();
          expect(TOKENS[t].optional).toBe(true);
        }
      }
    }
  });

  it("refuses a combination nobody authored rather than returning undefined", () => {
    expect(() => libraries.get("CDI", "de")).toThrow(
      expect.objectContaining({ code: "NO_CLAUSE_LIBRARY", status: 422 }),
    );
  });

  it("lets the kind decide before the employment type", () => {
    // A termination letter is the termination library whatever the employee is
    // employed under; only EMPLOYMENT falls through to the employment type.
    expect(libraries.libraryKeyFor({ kind: "TERMINATION", employmentType: "CDD" })).toBe("TERMINATION");
    expect(libraries.libraryKeyFor({ kind: "EMPLOYMENT", employmentType: "CDD" })).toBe("CDD");
    // An employment type nobody authored a library for falls back to the
    // indefinite contract rather than to nothing.
    expect(libraries.libraryKeyFor({ kind: "EMPLOYMENT", employmentType: "APPRENTICE" })).toBe("CDI");
  });
});

describe("what a model may change about a clause", () => {
  const AUTHORED = libraries.get("CDI", "en").articles.find((a) => a.key === "duties").body;

  afterEach(() => jest.restoreAllMocks());

  it("accepts a genuine rephrasing and keeps the tokens where they were", async () => {
    const rewritten = AUTHORED.replace(
      "carrying out the work and tasks set out in the job description",
      "clearing consignments through customs and keeping the declarations file complete",
    );
    jest.spyOn(llm, "chat").mockResolvedValue({ text: rewritten, provider: "gemini" });

    const out = await refiner.refine({}, { libraryKey: "CDI", language: "en", jobTitle: "Customs Clearance Officer" });

    expect(out.ai_generated).toBe(true);
    expect(out.ai_model).toBe("gemini");
    expect(out.overrides.duties).toContain("clearing consignments");
    // Still a template: the composer fills the facts AFTER the model is done.
    expect(out.overrides.duties).toContain("{{term.job_title}}");
  });

  it("discards a rewrite that moved a fact out of the clause", async () => {
    // The model resolving `{{term.job_title}}` itself is the whole failure
    // mode: the clause stops being filled from the record, and the next time
    // the job title changes the contract silently disagrees with it.
    jest.spyOn(llm, "chat").mockResolvedValue({
      text: AUTHORED.replace("{{term.job_title}}", "Customs Clearance Officer"),
      provider: "gemini",
    });

    const out = await refiner.refine({}, { libraryKey: "CDI", language: "en" });
    expect(out.overrides).toEqual({});
    expect(out.ai_generated).toBe(false);
    expect(out.rejected).toEqual([{ article: "duties", reason: "tokens changed" }]);
  });

  it("discards a rewrite that changed a figure", () => {
    const authored = "A probationary period of six (06) months may be observed.";
    expect(refiner.rejectionReason(authored, "A probationary period of twelve (12) months may be observed."))
      .toBe("figures changed");
    // Reformatting a legal figure is changing it too — « six (06) » is the form
    // the Code uses and the form the contract must carry.
    expect(refiner.rejectionReason(authored, "A probationary period of 6 months may be observed."))
      .toBe("figures changed");
  });

  it("discards a rewrite that grew a heading, a fence, or a second clause", () => {
    const authored = "The Employee shall carry out the duties of the role with due care. ".repeat(4);
    expect(refiner.rejectionReason(authored, `## Duties\n\n${authored}`)).toBe("heading");
    expect(refiner.rejectionReason(authored, "```\n" + authored + "\n```")).toBe("code fence");
    expect(refiner.rejectionReason(authored, authored.repeat(3))).toMatch(/too long/);
    expect(refiner.rejectionReason(authored, "The Employee shall work.")).toMatch(/too short/);
    expect(refiner.rejectionReason(authored, "")).toBe("empty");
    // …and an honest rephrasing of the same length passes.
    expect(refiner.rejectionReason(authored, authored.replace(/due care/g, "proper care"))).toBeNull();
  });

  it("keeps the authored clause when there is no AI vendor, and never throws", async () => {
    // A tenant with no model configured gets the clause counsel reviewed.
    // Refinement is a finish, never a dependency.
    jest.spyOn(llm, "chat").mockRejectedValue(new Error("no vendor configured"));

    const out = await refiner.refine({}, { libraryKey: "CDI", language: "fr" });
    expect(out.overrides).toEqual({});
    expect(out.ai_generated).toBe(false);
    expect(out.rejected).toEqual([{ article: "duties", reason: "provider error" }]);

    // And the contract composes regardless.
    expect(composer.build(ROW, { clauseOverrides: out.overrides }).body_md.length).toBeGreaterThan(1000);
  });

  it("only ever offers the model a clause the library marked editable", async () => {
    const seen = [];
    jest.spyOn(llm, "chat").mockImplementation(async ({ messages }) => {
      seen.push(messages.find((m) => m.role === "user").content);
      return { text: "", provider: "gemini" };
    });

    await refiner.refine({}, { libraryKey: "CDI", language: "en" });

    // One clause, and it is the duties clause. Not the salary, not the notice
    // period, not the identification paragraph.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("{{term.job_title}}");
    expect(seen[0]).not.toMatch(/salary|remuneration|identity|born/i);
  });

  it("keeps the temperature low — a contract is not a place for invention", async () => {
    let opts = null;
    jest.spyOn(llm, "chat").mockImplementation(async (o) => {
      opts = o;
      return { text: "", provider: "gemini" };
    });
    await refiner.refine({}, { libraryKey: "CDI", language: "en" });
    expect(opts.temperature).toBeLessThanOrEqual(0.3);
  });

  it("tells the model the placeholders and the figures are not its to change", async () => {
    let captured = null;
    jest.spyOn(llm, "chat").mockImplementation(async ({ messages }) => {
      captured = messages;
      return { text: "", provider: "gemini" };
    });
    await refiner.refine({}, { libraryKey: "CDI", language: "fr" });

    const system = captured.find((m) => m.role === "system").content;
    expect(system).toMatch(/Reproduce every one of them EXACTLY/);
    expect(system).toMatch(/Reproduce every number and figure exactly/);
    // And in the language the contract is written in.
    expect(system).toMatch(/You write in French/);
  });
});

describe("tidying what a model returns", () => {
  it("strips a fence and a restated heading", () => {
    const raw = "```markdown\n## Duties\n\nThe Employee shall do the work.\n```";
    const out = refiner.tidy(raw);
    expect(out).toBe("The Employee shall do the work.");
  });

  it("strips the sentence a model writes before the answer", () => {
    expect(refiner.tidy("Here is the rewritten clause:\n\nThe Employee shall do the work."))
      .toBe("The Employee shall do the work.");
  });

  it("keeps a clause that needs no tidying", () => {
    const body = "The Employee shall do the work.\n\nAnd do it with care.";
    expect(refiner.tidy(body)).toBe(body);
  });

  it("returns null for nothing", () => {
    expect(refiner.tidy("")).toBeNull();
    expect(refiner.tidy(null)).toBeNull();
  });
});

describe("the clauses that reach the PDF", () => {
  const { contractArticles } = require("../../src/modules/documents/template/template.service");

  it("turns the composed body into the articles the renderer wants", () => {
    // THE BUG THIS CLOSES. The EMPLOYMENT_CONTRACT data builder said
    // `articles: []`, so every contract this system generated rendered a
    // letterhead, both parties, a signature block — and NOT ONE CLAUSE. A blank
    // form that looks entirely correct until somebody reads it.
    //
    // The composer emits `##` headings for exactly this reason: the renderer
    // already knew how to cut a body at them, and a contract edited by hand
    // afterwards stays editable in the way it always was.
    const built = composer.build(ROW);
    const arts = contractArticles(built.body_md);

    // Every article the composer emitted, plus the preamble.
    expect(arts.length).toBe(built.composed.articles.length + 1);
    expect(arts.map((a) => a.title)).toEqual(
      expect.arrayContaining(["BETWEEN THE UNDERSIGNED:", "ARTICLE 1: ENGAGEMENT AND DURATION"]),
    );
    // The terms survive the split — this is what actually lands on the page.
    const printed = arts.map((a) => a.body).join("\n");
    expect(printed).toContain("Ada Mbarga");
    expect(printed).toMatch(/500[\s\u202f\u00a0]000 XAF/);
  });

  it("cuts a section that has no heading, instead of printing the hashes", () => {
    const arts = contractArticles("## A\n\nFirst.\n\n##\n\nSign-off.");
    expect(arts).toEqual([
      { title: "A", body: "First." },
      { title: "", body: "Sign-off." },
    ]);
    // The failure this replaced: the sign-off stayed inside the clause above
    // it, carrying a literal "##" into the printed contract.
    expect(arts.some((a) => a.body.includes("##"))).toBe(false);
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

  it("keeps the closing out of the body, so it is not the last paragraph of the disputes clause", () => {
    // « Fait à Douala, le … » carries no `##` heading, so inside `body_md` the
    // renderer has nowhere to put it but inside the article above it — the
    // contract would print "in two original copies" as part of ARTICLE 12.
    const built = composer.build(ROW);
    expect(built.body_md).not.toMatch(/Fait à|in two \(02\) original/i);
    expect(built.columns.closing_md).toMatch(/two \(02\) original counterparts|deux \(02\) exemplaires/);
    expect(built.columns.signature_labels.map((s) => s.party)).toEqual(["EMPLOYEE", "EMPLOYER"]);
  });

  it("renders through the real template with no double numbering and no commercial furniture", () => {
    // Four defects at once, all of them invisible until somebody read the PDF:
    //   · every section was wrapped in "Article N — …", so a composed body
    //     printed "Article 1 — ARTICLE 1 : ENGAGEMENT ET DURÉE", and the
    //     preamble came out as "Article 1 — ENTRE LES SOUSSIGNÉS :";
    //   · a second parties block above a preamble that already names both
    //     parties, less completely and in a different format;
    //   · `k.signatureBlock` labels the counterparty "Pour le client" — on the
    //     document that defines an employment relationship;
    //   · the heading said "Contrat de travail" for a CDD.
    const registry = require("../../src/services/documents/templates/registry");
    const kit = require("../../src/services/documents/templates/kit");

    const built = composer.build({ ...ROW, language: "fr" });
    const c = built.columns;
    const data = {
      number: "CTR-2026-0014", kind: ROW.kind, effective_on: c.effective_on,
      employee_name: c.employee_snapshot.full_name, staff_no: c.employee_snapshot.staff_no,
      job_title: c.job_title, doc_title: c.title, library: c.clause_library_key,
      representative: { name: ROW.representative.full_name, title: ROW.representative.title },
      articles: contractArticles(built.body_md),
      closing: c.closing_md, signature_labels: c.signature_labels, currency: c.salary_currency,
    };
    const cfg = kit.mergeCfg({}, { language: c.language, show: { signature: true } });
    const html = registry.get("EMPLOYMENT_CONTRACT").build(
      data, cfg, { legal_name: "SLAS LOGISTICS SARL", address: "Akwa, Douala" }, null,
    );
    const text = html.slice(html.indexOf("<body")).replace(/<[^>]+>/g, " ");

    expect(text).not.toMatch(/Article \d+ — ARTICLE/i);
    expect(text).not.toMatch(/Pour le client|For the client|Pour la soci/i);
    expect(text).toContain("CONTRAT DE TRAVAIL À DURÉE INDÉTERMINÉE");
    // The two parties are named once, in the contract's own words.
    expect(text.match(/ENTRE LES SOUSSIGN/g)).toHaveLength(1);
    // …and the panel the employer signs names the person who binds it.
    expect(text).toMatch(/Marc-Aur.le Ngassa/);
    expect(text).toMatch(/G.rant/);
    // The closing sits below the clauses, not inside the last one.
    expect(text).toMatch(/exemplaires originaux/);
  });

  it("still numbers a body that was typed in by hand", () => {
    // A contract written before the libraries existed, or edited from scratch,
    // has plain headings and must keep the numbering the template used to add.
    const registry = require("../../src/services/documents/templates/registry");
    const kit = require("../../src/services/documents/templates/kit");
    const html = registry.get("EMPLOYMENT_CONTRACT").build(
      { number: "X", articles: [{ title: "Parties", body: "A and B." }, { title: "Notice", body: "30 days." }] },
      kit.mergeCfg({}, { language: "en" }), { legal_name: "X" }, null,
    );
    const text = html.slice(html.indexOf("<body")).replace(/<[^>]+>/g, " ");
    expect(text).toMatch(/Article 1 — Parties/);
    expect(text).toMatch(/Article 2 — Notice/);
  });
});

describe("where the employer's address comes from", () => {
  const repo = require("../../src/modules/hr/hr_contract/hr_contract.repo");

  it("reads the structured address, not just the entity's own columns", () => {
    /*
     * THE DEFECT THIS PINS. The preamble prints the registered office, the PO
     * box and the country — and `corporate_entity` HAS NO `po_box` column.
     * 0515 moved the structured address to `entity_address` and left
     * `corporate_entity.address` as a legacy free-text line, so a composition
     * query reading the entity row alone can never resolve `entity.po_box`:
     * EVERY contract refuses, naming a fact the operator has no field to fill.
     *
     * Found by composing against a real database. Nothing static could see it
     * — `to_jsonb(ce.*)` names no columns, so even the query-columns gate has
     * nothing to check — which is exactly why this test asserts on the SQL
     * rather than on a result nobody can produce without Postgres.
     */
    const sql = String(repo.composition);
    expect(sql).toMatch(/FROM entity_address/);
    expect(sql).toMatch(/po_box/);
    // The letterhead's precedence, not a second one invented here: a contract
    // naming a different office from the letterhead at the top of the same
    // page would be its own kind of defect.
    expect(sql).toMatch(/type = 'REGISTERED'\) DESC, a\.is_primary DESC/);
    // …and the legacy column still answers for a tenant with no structured row.
    expect(sql).toMatch(/ce\.address/);
  });

  it("only offers a signatory whose mandate covers today", () => {
    // A resigned director must never be offered as the person who binds the
    // company, and the picker the wizard reads must use the same filter the
    // composition resolves with — otherwise the screen offers somebody the
    // server would then decline to use.
    for (const fn of [String(repo.composition), String(repo.signatories)]) {
      expect(fn).toMatch(/effective_to\s+IS NULL OR/);
      expect(fn).toMatch(/effective_to\s+>= CURRENT_DATE/);
      expect(fn).toMatch(/effective_from\s+<= CURRENT_DATE/);
      expect(fn).toMatch(/is_active/);
      expect(fn).toMatch(/LEGAL_REPRESENTATIVE'\s*,\s*'AUTHORISED_SIGNATORY'/);
    }
  });

  it("reads the pay lines live on the day the contract takes effect", () => {
    // Not today's. A contract effective next month states the pay that will
    // then apply, and a backdated one states the pay that did — reading
    // CURRENT_DATE would put next month's raise into a contract signed last
    // year. Monthly lines only: a thirteenth month is not part of a monthly
    // gross.
    const sql = String(repo.composition);
    expect(sql).toMatch(/COALESCE\(hc\.effective_on, CURRENT_DATE\)/);
    expect(sql).toMatch(/periodicity = 'MONTHLY'/);
  });
});

describe("the language a contract prints in", () => {
  const { resolveDocLanguage } = require("../../src/modules/documents/template/template.service");

  it("takes the contract's own language over the operator's pick", () => {
    // An invoice is a projection: the figures are the same whichever language
    // the labels are in, so the operator may fairly choose. A contract's
    // clauses ARE the document. Printing English furniture over a French body
    // produces the bilingual instrument 12766 exists to prevent.
    expect(resolveDocLanguage("en", { language: "bilingual" }, "fr")).toBe("fr");
    expect(resolveDocLanguage(null, { language: "bilingual" }, "en")).toBe("en");
  });

  it("leaves every other document exactly as it was", () => {
    expect(resolveDocLanguage("en", { language: "fr" }, null)).toBe("en");
    expect(resolveDocLanguage(null, { language: "fr" }, null)).toBe("fr");
    expect(resolveDocLanguage(null, {}, null)).toBeUndefined();
    // A record that states nonsense does not get to render in nothing.
    expect(resolveDocLanguage("en", { language: "fr" }, "de")).toBe("en");
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
