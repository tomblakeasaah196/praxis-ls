"use strict";

/**
 * The contract clause library, the tenant layer over it, and the single
 * language the document comes out in (14402).
 *
 * ── THE DOCUMENT THESE EXIST BECAUSE OF ────────────────────────────────────
 *
 * SLAS-CTR-2026-0001, 11 Oct 2026. A heading reading "Contrat de travail /
 * Employment contract" over five English articles; an employee with no
 * professional category; no CNPS, no paid leave, no medical cover, no notice
 * schedule, no dispute route; and Article 2 committing both parties to a fixed
 * term running from 2026 to 2046. It rendered cleanly, the API accepted every
 * field and no test went red.
 *
 * So these hold the three properties that document lacked: the statutory
 * subjects are always there, the language is one language, and a term that
 * cannot be right is REPORTED rather than quietly corrected.
 */

const clauses = require("../../src/modules/hr/hr_contract/hr_contract.clauses");

const TERMS = {
  entity_name: "Smart Logistics & Services Ltd",
  entity_address: "Douala, Cameroun",
  entity_rccm: "RC/DLA/2019/B/1234",
  entity_niu: "M042116033580Q",
  employer_cnps: "CM-55012",
  employee_name: "JBS Praxis",
  employee_cnps: "CM-88231",
  job_title: "Chief of Operations",
  department: "Operations",
  professional_category: "Cadre, category 10, step A",
  effective_on: "2026-08-23",
  end_on: null,
  probation_months: 3,
  probation_ends_on: "2026-11-23",
  gross_salary: 500000,
  salary_currency: "XAF",
  notice_days: 30,
  working_hours: "08:00 to 17:00, Monday to Friday",
  place_of_work: "Douala, Littoral Region, Cameroon",
  weekly_hours: 40,
  leave_days_per_month: 1.5,
  sop_titles: ["Staff Handbook"],
  duties_md: "- Take charge of import operations.",
};

const keysOf = (opts) => clauses.clausesFor(TERMS, opts).map((c) => c.key);

describe("the statutory floor", () => {
  it("settles every subject a Cameroonian employment contract is expected to settle", () => {
    expect(keysOf({ kind: "EMPLOYMENT", lang: "en" })).toEqual(
      expect.arrayContaining([
        "parties", "engagement", "category", "term", "probation", "place", "hours",
        "remuneration", "social", "leave", "absence", "notice", "misconduct",
        "final", "disputes",
      ]),
    );
  });

  it("names both sides of the social-security relationship", () => {
    // The employer's CNPS number as well as the employee's. A contract that
    // names only one side does not show that the employer is registered.
    const parties = clauses.clausesFor(TERMS, { kind: "EMPLOYMENT", lang: "en" }).find((c) => c.key === "parties");
    expect(parties.body).toContain("CM-55012");
    expect(parties.body).toContain("CM-88231");
  });

  it("refuses to let a tenant switch a statutory clause off", () => {
    // A floor that can be removed is not a floor. The request is IGNORED rather
    // than refused: the list is a stored preference that outlives the clause
    // set, and a key that is standard today may be statutory tomorrow.
    const config = { clauses: { disabled: ["leave", "social", "disputes", "confidentiality"] } };
    const keys = clauses.clausesFor(TERMS, { kind: "EMPLOYMENT", lang: "en", config }).map((c) => c.key);

    expect(keys).toEqual(expect.arrayContaining(["leave", "social", "disputes"]));
    // …while a clause that is only good practice does come off.
    expect(keys).not.toContain("confidentiality");
  });

  it("omits a clause whose fact was never supplied", () => {
    const bare = { ...TERMS, professional_category: null, place_of_work: null, gross_salary: null, probation_months: null };
    const keys = clauses.clausesFor(bare, { kind: "EMPLOYMENT", lang: "en" }).map((c) => c.key);

    expect(keys).not.toContain("category");
    expect(keys).not.toContain("place");
    expect(keys).not.toContain("remuneration");
    expect(keys).not.toContain("probation");
    // The clauses that depend on no fact are still there, so the contract does
    // not degrade into the five-article form this replaced.
    expect(keys).toEqual(expect.arrayContaining(["leave", "social", "notice", "disputes"]));
  });

  it("gives each kind of document its own clause set", () => {
    const confirmation = keysOf({ kind: "CONFIRMATION", lang: "en" });
    expect(confirmation).toContain("confirmation");
    // A certificate of employment is not a contract: it settles no terms.
    expect(confirmation).not.toContain("probation");
    expect(confirmation).not.toContain("notice");

    const termination = keysOf({ kind: "TERMINATION", lang: "en" });
    expect(termination).toContain("final");
    // Confidentiality has to outlive the employment or it was worth nothing.
    expect(termination).toContain("confidentiality");
  });
});

describe("one language", () => {
  it("writes every clause in the language asked for and no other", () => {
    const en = clauses.clausesFor(TERMS, { kind: "EMPLOYMENT", lang: "en" });
    const fr = clauses.clausesFor(TERMS, { kind: "EMPLOYMENT", lang: "fr" });

    expect(en.map((c) => c.title)).toContain("Paid Leave");
    expect(fr.map((c) => c.title)).toContain("Congés payés");
    // Not one title carries both, which is the property the printed heading
    // "Contrat de travail / Employment contract" did not have.
    for (const c of [...en, ...fr]) expect(c.title).not.toMatch(/ \/ /);
  });

  it("keeps French typography French", () => {
    const fr = clauses.clausesFor(TERMS, { kind: "EMPLOYMENT", lang: "fr" });
    const money = fr.find((c) => c.key === "remuneration").body;
    const leave = fr.find((c) => c.key === "leave").body;

    // A non-breaking space for thousands and a comma for the decimal. A French
    // contract reading "1.5 jour" and "500,000 XAF" is read as a typo, or
    // worse, as a different number.
    expect(money).toContain("500 000 XAF");
    expect(leave).toContain("1,5 jour");
  });

  it("prints dates day first in both languages", () => {
    for (const lang of ["en", "fr"]) {
      const term = clauses.clausesFor({ ...TERMS, end_on: "2027-03-07" }, { kind: "EMPLOYMENT", lang }).find((c) => c.key === "term");
      // 7 March 2027, which on a US-configured reading of the ISO string is
      // exactly the month a licence expires in that nobody expected.
      expect(term.body).toContain("07/03/2027");
      expect(term.body).not.toContain("2027-03-07");
    }
  });
});

describe("the tenant layer", () => {
  it("names the tenant's own collective agreement wherever a clause refers to one", () => {
    const config = { collective_agreement: "the Convention Collective Nationale des Transports" };
    const t = { ...TERMS, ...clauses.tenantConfig(config), collective_agreement: config.collective_agreement };
    const leave = clauses.clausesFor(t, { kind: "EMPLOYMENT", lang: "en", config }).find((c) => c.key === "leave");

    expect(leave.body).toContain("Convention Collective Nationale des Transports");
  });

  it("falls back to the generic reference rather than a blank", () => {
    // "the applicable collective agreement" is a correct and complete
    // reference on its own: which agreement covers the employer is a matter of
    // law, not of what this contract says about it.
    const leave = clauses.clausesFor({ ...TERMS, collective_agreement: null }, { kind: "EMPLOYMENT", lang: "en" }).find((c) => c.key === "leave");
    expect(leave.body).toContain("the applicable collective agreement");
  });

  it("adds the tenant's own clauses after the library's", () => {
    const config = {
      clauses: {
        custom: [{
          key: "cargo", kinds: ["EMPLOYMENT"],
          title_en: "Client Cargo and Customs Documents",
          body_en: "The Employee shall not release cargo or a customs document without the written authorisation of the operations manager.",
          title_fr: "Marchandises et documents douaniers",
          body_fr: "Le Salarié ne peut libérer une marchandise ou un document douanier sans autorisation écrite du responsable des opérations.",
        }],
      },
    };
    const en = clauses.clausesFor(TERMS, { kind: "EMPLOYMENT", lang: "en", config });
    const fr = clauses.clausesFor(TERMS, { kind: "EMPLOYMENT", lang: "fr", config });

    expect(en[en.length - 1].key).toBe("cargo");
    expect(en[en.length - 1].body).toContain("written authorisation");
    expect(fr[fr.length - 1].body).toContain("autorisation écrite");
  });

  it("drops a tenant clause that is missing a title or a body", () => {
    // It ends up in a signed document. "undefined" printed as an article is
    // not a thing to find out about from a counterparty.
    const config = { clauses: { custom: [{ key: "broken", title_en: "Something" }, { key: "alsobroken", body_en: "Something" }] } };
    const keys = clauses.clausesFor(TERMS, { kind: "EMPLOYMENT", lang: "en", config }).map((c) => c.key);
    expect(keys).not.toContain("broken");
    expect(keys).not.toContain("alsobroken");
  });

  it("takes the tenant's working week and leave rate over the statutory floor", () => {
    const config = { terms: { weekly_hours: 39, leave_days_per_month: 2 } };
    const tenant = clauses.tenantConfig(config);
    expect(tenant.weekly_hours).toBe(39);
    expect(tenant.leave_days_per_month).toBe(2);

    // …and a nonsense value falls back rather than printing "0 hours a week".
    const broken = clauses.tenantConfig({ terms: { weekly_hours: 0, leave_days_per_month: "" } });
    expect(broken.weekly_hours).toBe(clauses.DEFAULT_WEEKLY_HOURS);
    expect(broken.leave_days_per_month).toBe(clauses.DEFAULT_LEAVE_DAYS_PER_MONTH);
  });
});

describe("the review", () => {
  const codes = (t, kind = "EMPLOYMENT") => clauses.review(t, { kind }).map((r) => r.code);

  it("catches the twenty-year fixed term", () => {
    // Article 2 of the contract the tenant was holding: a CDD from 2026-08-23
    // to 2046-08-18. Both readings are valid dates, the API accepted it and
    // the PDF printed it.
    expect(codes({ ...TERMS, effective_on: "2026-08-23", end_on: "2046-08-18" })).toContain("fixed_term_too_long");
    // A two-year term is within the ceiling and is not flagged.
    expect(codes({ ...TERMS, effective_on: "2026-08-23", end_on: "2028-08-18" })).not.toContain("fixed_term_too_long");
  });

  it("catches a probation beyond the ceiling and a week beyond the statutory hours", () => {
    expect(codes({ ...TERMS, probation_months: 8 })).toContain("probation_too_long");
    expect(codes({ ...TERMS, weekly_hours: 48 })).toContain("hours_above_statutory");
    expect(codes(TERMS)).not.toContain("probation_too_long");
    expect(codes(TERMS)).not.toContain("hours_above_statutory");
  });

  it("names the facts whose clauses will be missing", () => {
    const out = codes({ ...TERMS, professional_category: null, place_of_work: null, employer_cnps: null });
    expect(out).toEqual(expect.arrayContaining(["no_category", "no_place_of_work", "no_employer_cnps"]));
  });

  it("says nothing about a contract that has everything", () => {
    expect(clauses.review(TERMS, { kind: "EMPLOYMENT" })).toEqual([]);
  });
});

describe("what the PDF prints", () => {
  const registry = require("../../src/services/documents/templates/registry");
  const kit = require("../../src/services/documents/templates/kit");

  const ENTITY = { legal_name: "Smart Logistics & Services Ltd", address: "Douala, Cameroun", rccm: "RC/DLA/2019/B/1234", niu: "M042116033580Q" };
  const render = (data, language) =>
    registry.get("EMPLOYMENT_CONTRACT").build(data, kit.mergeCfg({}, { language }), ENTITY, null);
  const titleOf = (html) => (/<div class="ttl">([^<]*)<\/div>/.exec(html) || [])[1];

  const DOC = {
    number: "SLAS-CTR-2026-0001",
    kind: "EMPLOYMENT",
    language: "en",
    effective_on: "2026-08-23",
    employee_name: "JBS Praxis",
    job_title: "Chief of Operations",
    party: { name: "JBS Praxis", lines: ["Chief of Operations", "Cadre, category 10, step A"] },
    articles: [{ title: "Engagement and Duties", body: "The Employer engages the Employee as Chief of Operations." }],
  };

  it("titles the document in one language, in Title Case", () => {
    // The heading the tenant was holding: "Contrat de travail / Employment
    // contract". Two languages joined by a slash, and the English half in
    // sentence case.
    expect(titleOf(render(DOC, "en"))).toBe("Employment Contract");
    expect(titleOf(render(DOC, "fr"))).toBe("Contrat de travail");
  });

  it("leaves no slash to join two languages with, whatever cfg.language says", () => {
    // `k.t` prints a pair as "fr / en" for ANY language it does not recognise,
    // which is how a bilingual heading reached a signed contract in the first
    // place. This template hands it no pair at all, so an unrecognised
    // language degrades to English rather than to both.
    const html = render(DOC, "bilingual");
    expect(titleOf(html)).toBe("Employment Contract");
    expect(html).not.toContain("Employeur / Employer");
    expect(html).not.toContain("Contrat de travail / Employment");
  });

  it("names the document after its KIND, not after the doc type", () => {
    // A termination letter headed "Employment Contract" is not a cosmetic
    // error. All four kinds render through this one template.
    expect(titleOf(render({ ...DOC, kind: "TERMINATION" }, "en"))).toBe("Notice of Termination");
    expect(titleOf(render({ ...DOC, kind: "OFFER_LETTER" }, "en"))).toBe("Offer of Employment");
    expect(titleOf(render({ ...DOC, kind: "CONFIRMATION" }, "fr"))).toBe("Attestation d'emploi");
  });

  it("numbers articles without an em dash", () => {
    // "ARTICLE 1 — ENGAGEMENT" on a printed contract, against a house rule
    // that bans the em dash in anything a tenant reads.
    const html = render(DOC, "en");
    expect(html).toContain("Article 1. Engagement and Duties");
    expect(html).not.toContain("— Engagement");
  });

  it("prints the effective date day first", () => {
    expect(render(DOC, "en")).toContain("23/08/2026");
  });
});

describe("which language a contract renders in", () => {
  const { resolveDocLanguage } = require("../../src/modules/documents/template/template.service");

  it("lets the contract's own language beat the operator's pick", () => {
    // Everywhere else the operator wins: they are looking at the client's file
    // when they press Download. A contract is different — its body IS the
    // agreement and does not translate itself, so re-rendering it in the other
    // language produces French chrome over English articles under the same
    // document number and the same verification code.
    expect(resolveDocLanguage("fr", null, "fr", "EMPLOYMENT_CONTRACT", "en")).toBe("en");
  });

  it("falls through for a contract drafted before the column existed", () => {
    expect(resolveDocLanguage("fr", null, "en", "EMPLOYMENT_CONTRACT", null)).toBe("fr");
    expect(resolveDocLanguage(null, null, "fr", "EMPLOYMENT_CONTRACT", null)).toBe("fr");
  });

  it("leaves every other document exactly as it was", () => {
    expect(resolveDocLanguage("fr", null, "en", "INVOICE", null)).toBe("fr");
    expect(resolveDocLanguage(null, { language: "fr" }, "en", "INVOICE", null)).toBe("fr");
  });
});
