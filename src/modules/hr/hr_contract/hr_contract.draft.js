/**
 * Drafting an employment document (MOD-12 / 0700, rewritten 14402).
 *
 * ── WHAT CHANGED, AND WHY IT HAD TO ────────────────────────────────────────
 *
 * This used to hand the whole document to a model: here are the agreed terms,
 * write "the clauses, the ordering, the register". The split was terms versus
 * prose, and it was the wrong line. What came back on 11 Oct 2026 was five
 * articles — engagement, term, pay, hours, place — with no professional
 * classification, no CNPS, no paid leave, no medical cover, no notice schedule
 * and no dispute route, on a company's headed paper, under a signature block.
 * It read perfectly. Nothing failed.
 *
 * The real line is not terms versus prose. It is WHAT THE PARTIES AGREE TO
 * versus WHAT THIS PARTICULAR PERSON DOES ALL DAY. The first is a library
 * (`hr_contract.clauses`): reviewed once, versioned with the code, the same
 * wording in every contract the product issues, with a tenant layer over it for
 * their own collective agreement and their own clauses. The second is the one
 * thing no library can know, and it is all the model is asked for now.
 *
 * So the model writes ONE clause body — the duties — and the rest of the
 * document is assembled around it. The blast radius of a bad generation is a
 * paragraph about loading containers, not a missing leave entitlement.
 *
 * ── ONE LANGUAGE, CHOSEN, NOT RESOLVED ─────────────────────────────────────
 *
 * The clauses are written in the contract's own language (`hr_contract.language`,
 * 14402) and the model is told to answer in it. A contract is not an invoice:
 * the text is what somebody signed, so it cannot be re-rendered into the other
 * language by whoever next presses Download.
 *
 * ── IT NEVER THROWS ────────────────────────────────────────────────────────
 *
 * A tenant with no AI vendor still gets a complete, signable contract — now
 * MORE complete than the model's, because only the duties clause is missing its
 * author and even that has a written fallback. The row records which produced
 * the duties so nobody believes a model reviewed a document it never saw.
 */
"use strict";

const llm = require("../../../services/ai/llm.service");
const { logger } = require("../../../config/logger");
const clauses = require("./hr_contract.clauses");

/** Cameroon's statutory default. A tenant's own figure always wins. */
const DEFAULT_NOTICE_DAYS = 30;

const money = (v) =>
  v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v);

const KIND_LABEL = {
  OFFER_LETTER: "offer letter",
  EMPLOYMENT: "employment contract",
  CONFIRMATION: "confirmation of employment letter",
  TERMINATION: "termination letter",
};

/** 'en' | 'fr', and nothing else ever reaches a clause. */
const asLang = (v) => (String(v || "").trim().toLowerCase() === "fr" ? "fr" : "en");

/**
 * The facts, in one place, so the library, the prompt and the fallback cannot
 * disagree about what was agreed.
 *
 * `config` is the tenant's own layer (`clauses.tenantConfig`), folded in here
 * rather than read inside a clause: a clause is a pure function of this object,
 * which is what makes the whole set testable without a database.
 */
function terms(input = {}, config = {}) {
  const tenant = clauses.tenantConfig(config);
  return {
    kind: input.kind || "EMPLOYMENT",
    lang: asLang(input.language || input.lang),
    employee_name: input.employee_name || "the employee",
    employee_cnps: input.employee_cnps || null,
    job_title: input.job_title || null,
    department: input.department || null,
    reports_to: input.reports_to || null,
    professional_category: input.professional_category || null,
    entity_name: input.entity_name || null,
    entity_country: input.entity_country || null,
    entity_address: input.entity_address || null,
    entity_rccm: input.entity_rccm || null,
    entity_niu: input.entity_niu || null,
    effective_on: input.effective_on || null,
    end_on: input.end_on || null,
    probation_ends_on: input.probation_ends_on || null,
    offer_valid_until: input.offer_valid_until || null,
    termination_reason: input.termination_reason || null,
    gross_salary: money(input.gross_salary),
    salary_currency: input.salary_currency || "XAF",
    allowances: (input.allowances || []).filter(Boolean).slice(0, 8),
    probation_months: input.probation_months ?? null,
    notice_days: input.notice_days ?? DEFAULT_NOTICE_DAYS,
    working_hours: input.working_hours || null,
    place_of_work: input.place_of_work || null,
    sop_titles: (input.sop_titles || []).filter(Boolean).slice(0, 12),
    // The tenant layer. Named individually rather than spread so a clause
    // reading `t.weekly_hours` has one obvious place to look for where it came
    // from, and so a stray settings key cannot shadow an agreed term.
    collective_agreement: tenant.collective_agreement,
    employer_cnps: input.employer_cnps || tenant.employer_cnps,
    weekly_hours: tenant.weekly_hours,
    leave_days_per_month: tenant.leave_days_per_month,
    // Filled by the model (or the fallback) before the clauses are built.
    duties_md: null,
  };
}

/**
 * What the model is asked for: the duties, and nothing else.
 *
 * The facts still travel with the request, and the first rule still says they
 * are agreed terms — not because the model is writing them any more, but
 * because a duties paragraph for a Chief of Operations on 500,000 XAF should
 * not describe a job that pays twice that. It is context for the register, and
 * repeating a figure back into the prose is explicitly refused.
 */
function promptMessages(t) {
  const facts = [
    `Document type: ${KIND_LABEL[t.kind] || "employment contract"}`,
    `Employer: ${t.entity_name || "the employer"}${t.entity_country ? ` (${t.entity_country})` : ""}`,
    `Employee: ${t.employee_name}`,
    t.job_title ? `Job title: ${t.job_title}` : null,
    t.department ? `Department: ${t.department}` : null,
    t.professional_category ? `Professional category: ${t.professional_category}` : null,
    t.reports_to ? `Reports to: ${t.reports_to}` : null,
    t.place_of_work ? `Place of work: ${t.place_of_work}` : null,
    t.gross_salary !== null ? `Gross monthly salary (context only, do not restate): ${t.gross_salary} ${t.salary_currency}` : null,
    t.sop_titles.length ? `Company procedures that already cover how the work is done: ${t.sop_titles.join("; ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const language = t.lang === "fr"
    ? "Write in FRENCH, in the register of a Cameroonian employment contract."
    : "Write in ENGLISH, in the register of a Cameroonian employment contract.";

  return [
    {
      role: "system",
      content: [
        "You write ONE clause of an employment contract for an employer in the OHADA/CEMAC region (Cameroon labour law): the DUTIES of the role, and nothing else.",
        "",
        language,
        "",
        "RULES, in order of importance:",
        "1. Output ONLY the duties. No heading, no clause number, no title, no preamble, no signature block. The surrounding contract is assembled around what you return.",
        "2. Do NOT restate the salary, the dates, the notice period, the probation, the working hours or the place of work. Every one of those is a clause of its own and repeating it creates two statements of the same term that can disagree.",
        "3. Describe what this person actually does: 4 to 8 duties, as a markdown bullet list, each one a single sentence beginning with a verb.",
        "4. Invent nothing. Where you were given no detail about the role, write the duties that the job title plainly implies and stop.",
        "5. No placeholders like [NAME] or TBD. No commentary about what you have written.",
      ].join("\n"),
    },
    {
      role: "user",
      content: `Write the duties clause for this role.\n\n${facts}`,
    },
  ];
}

/**
 * Strip what the model was told not to produce.
 *
 * Kept from the version that drafted whole contracts, because models reliably
 * add a title line and a signature block however firmly they are asked not to,
 * and both are supplied by the letterhead template — leaving them in produces a
 * document with the company name twice and two places to sign, which is
 * precisely the sort of thing nobody notices until it is printed.
 */
function tidy(text) {
  if (!text) return null;
  let out = String(text).trim();
  // A fenced block around the whole answer.
  const fence = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(out);
  if (fence) out = fence[1].trim();
  // A leading H1 title — the template prints the title.
  out = out.replace(/^#\s+.*\n+/, "");
  /* Everything from a signature block onwards.
   *
   * Two things this has to get right and an obvious pattern gets wrong: the
   * leading `\s*` (the heading sits after a BLANK line, so a pattern anchored
   * to one newline never reaches the `##`), and `signatures?` rather than
   * `signature\b` — the heading models actually write is the plural, and `\b`
   * between "signature" and "s" is not a boundary, so the whole block survived. */
  const sig = out.search(/\n\s*#{0,3}\s*(signatures?|signed by|signed:|for and on behalf|in witness whereof)/i);
  if (sig > 0) out = out.slice(0, sig).trim();
  return out || null;
}

/** The longest duties clause worth printing. Past this the model has stopped
 *  describing a job and started writing a contract of its own. */
const MAX_DUTIES_CHARS = 2400;

/**
 * `tidy`, plus the things that only matter when the answer is a CLAUSE BODY
 * rather than a whole document.
 *
 * A stray `## Duties` heading is the common one: left in, the renderer splits
 * on it and the contract gains a phantom article in the middle of the
 * engagement clause, numbered as if it were agreed.
 */
function tidyDuties(text) {
  const base = tidy(text);
  if (!base) return null;
  const out = base
    .split("\n")
    .filter((line) => !/^\s*#{1,6}\s/.test(line))
    .join("\n")
    .trim();
  if (!out) return null;
  return out.length > MAX_DUTIES_CHARS ? `${out.slice(0, MAX_DUTIES_CHARS).trimEnd()}.` : out;
}

/**
 * The duties clause, written without a model.
 *
 * Deliberately a real sentence rather than a stub: this is what a tenant with
 * no AI vendor gets, and the clause it sits in is the one a line manager reads
 * first. It says what the job title already says and stops, which is the same
 * rule the model is held to for a role it was told nothing about.
 */
function templateDuties(t) {
  if (!t.job_title) return null;
  const where = t.department
    ? t.lang === "fr" ? ` du département ${t.department}` : ` of the ${t.department} department`
    : "";
  return t.lang === "fr"
    ? `Le Salarié exerce les fonctions attachées au poste de ${t.job_title}${where}, telles qu'elles résultent de sa qualification et des instructions de l'Employeur.`
    : `The Employee shall carry out the duties attaching to the post of ${t.job_title}${where}, as they follow from their classification and from the Employer's instructions.`;
}

/**
 * Draft a document body. NEVER throws.
 *
 * Call OUTSIDE a transaction — it is a model call of several seconds, and this
 * deployment runs a 12-connection-per-tenant ceiling.
 *
 * `config` is the tenant's `hr_contract` settings section, read by the caller
 * so this function makes exactly one round trip of its own (the model call).
 *
 * @returns { body_md, ai_generated, ai_model, language, review }
 */
async function draft(client, input = {}, { config = {} } = {}) {
  const t = terms(input, config);
  let aiGenerated = false;
  let aiModel = "template";

  // The duties clause is the only thing a model is asked for, and only for the
  // documents that have one. A confirmation letter and a termination letter
  // describe a status, not a job.
  const wantsDuties = t.kind === "EMPLOYMENT" || t.kind === "OFFER_LETTER";
  if (wantsDuties) {
    try {
      const { text, provider } = await llm.chat({
        client,
        messages: promptMessages(t),
        temperature: 0.3, // A contract is not a place for invention.
      });
      const duties = tidyDuties(text);
      // Under this, the model has not described a job. The written fallback is
      // better than one line that looks finished.
      if (duties && duties.length > 80) {
        t.duties_md = duties;
        aiGenerated = true;
        aiModel = provider || "ai";
      } else {
        logger.warn({ provider, length: duties ? duties.length : 0 }, "[hr_contract] duties too short — falling back to the written clause");
      }
    } catch (err) {
      logger.warn({ err }, "[hr_contract] AI drafting failed — falling back to the written clause");
    }
  }
  if (!t.duties_md) t.duties_md = templateDuties(t);

  const set = clauses.clausesFor(t, { kind: t.kind, lang: t.lang, config });
  return {
    body_md: clauses.toMarkdown(set),
    ai_generated: aiGenerated,
    ai_model: aiModel,
    language: t.lang,
    // What a human should look at before issuing it. Warnings, never edits —
    // see `clauses.review`.
    review: clauses.review(t, { kind: t.kind }),
  };
}

module.exports = {
  draft,
  terms,
  tidy,
  tidyDuties,
  templateDuties,
  promptMessages,
  DEFAULT_NOTICE_DAYS,
  KIND_LABEL,
  MAX_DUTIES_CHARS,
};
