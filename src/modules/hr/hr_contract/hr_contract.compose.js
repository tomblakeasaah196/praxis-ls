/**
 * From rows to a contract: what the composer needs, assembled from the record.
 *
 * ── WHERE THE FACTS COME FROM, AND WHY THAT ORDER ──────────────────────────
 *
 * Every term reads from the CONTRACT first and the employee second. That is not
 * a tie-break, it is the difference between a record and an instrument: a
 * contract states what the parties agreed, and the employee row states what is
 * true today. They are usually the same and they are allowed to diverge — a
 * signed contract at 600,000 does not change because somebody typed a raise
 * into the employee record this morning. So the contract's own columns win
 * wherever they are set, and the employee is what fills a DRAFT that nobody has
 * typed terms into yet.
 *
 * ── WHAT THIS MODULE MAY NOT DO ────────────────────────────────────────────
 *
 * Derive, never decide. `duration_months` is arithmetic on two dates the
 * parties agreed; `monthly_gross` is the sum of lines somebody entered. Neither
 * is a term this module chose. The one figure that is not read from the record
 * is the statutory working week, and it is a citation rather than a default —
 * see WEEKLY_HOURS below.
 */
"use strict";

const { buildBundle, compose, toMarkdown, dryRun } = require("../../../services/contracts/compose");
const libraries = require("../../../services/contracts/libraries");

/**
 * Cameroon's statutory working week: art. 80 of the Labour Code, forty hours in
 * all non-agricultural undertakings. Stated here rather than stored per
 * employee because it is the ceiling the contract is written against, not a
 * term the parties negotiate — an agreement for more is void to that extent,
 * not a different number to print. A tenant working the agricultural regime
 * (2,400 hours a year) overrides it on the contract.
 */
const WEEKLY_HOURS = 40;

/**
 * Whole months of a term, as a contract counts them.
 *
 * `end_on` is the LAST DAY of the term, not the day after it, so the length is
 * measured to the following morning: 1 October 2026 to 30 September 2027 is
 * twelve months, and reading it as eleven would have understated every fixed
 * term in the system by a month — including against the two-year ceiling in
 * art. 25.
 *
 * Floors, and returns null below one month rather than printing « une durée de
 * 0 mois ». A term shorter than a month is real (a fortnight's seasonal work)
 * and the clause that states it in months cannot express it, so the composer
 * refuses and names the fact instead of rounding it away.
 */
function monthsBetween(fromIso, toIso) {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fromIso || ""));
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(toIso || ""));
  if (!a || !b) return null;
  const dayAfter = new Date(Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]) + 1));
  const months =
    (dayAfter.getUTCFullYear() - Number(a[1])) * 12 + (dayAfter.getUTCMonth() + 1 - Number(a[2]));
  const whole = dayAfter.getUTCDate() >= Number(a[3]) ? months : months - 1;
  return whole > 0 ? whole : null;
}

const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
const num = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

/**
 * The monthly gross the contract states.
 *
 * Base plus every standing cash line. A benefit in kind is remuneration and is
 * taxed, but nobody is handed it — 12765 records that as `in_gross = false`,
 * and counting it here would make the contract state a figure the payslip can
 * never match. A deduction is not remuneration at all.
 */
function grossOf(baseSalary, lines) {
  const base = num(baseSalary) || 0;
  return (lines || []).reduce(
    (sum, l) => (l.in_gross && l.kind !== "DEDUCTION" ? sum + (num(l.amount) || 0) : sum),
    base,
  );
}

/** Which of the eighteen this contract is written from, and in which language. */
function pickLibrary(row, overrides = {}) {
  const employee = row.employee || {};
  const entity = row.entity || {};
  const employmentType = overrides.employment_type || row.employment_type || employee.employment_type || null;
  const language = overrides.language || row.language || entity.default_language || "fr";
  return {
    libraryKey: libraries.libraryKeyFor({ kind: row.kind, employmentType }),
    language,
    employmentType,
  };
}

/**
 * The facts, from the composition read.
 *
 * `overrides` is what the wizard is holding but has not saved — so the preview
 * shows the contract the operator is about to create, not the one on disk.
 */
function factsFor(row, overrides = {}) {
  const employee = row.employee || {};
  const entity = row.entity || {};
  const lines = row.allowances || [];

  const pick = (key, ...fallbacks) => {
    if (overrides[key] !== undefined && overrides[key] !== null) return overrides[key];
    for (const v of fallbacks) if (v !== undefined && v !== null && v !== "") return v;
    return null;
  };

  const effectiveOn = iso(pick("effective_on", row.effective_on, employee.hired_on));
  const endOn = iso(pick("end_on", row.end_on));
  const baseSalary = num(pick("base_salary", row.base_salary, employee.base_salary));
  const placeOfWork = pick("place_of_work", row.place_of_work, employee.place_of_work);

  const terms = {
    job_title: pick("job_title", row.job_title, employee.job_title, row.vacancy_title),
    department: employee.department || null,
    effective_on: effectiveOn,
    end_on: endOn,
    duration_months: pick("duration_months", monthsBetween(effectiveOn, endOn)),
    probation_months: num(pick("probation_months", row.probation_months, employee.probation_months)),
    probation_ends_on: iso(pick("probation_ends_on", row.probation_ends_on)),
    notice_days: num(pick("notice_days", row.notice_days)),
    /* An offer's validity is `end_on` on an OFFER_LETTER row and nothing at all
     * on a contract — the two were one token until an offer letter for a CDD
     * told the candidate the offer lapsed on the day the job ended. */
    offer_valid_until: row.kind === "OFFER_LETTER" ? endOn : null,
    place_of_work: placeOfWork,
    working_hours: pick("working_hours", row.working_hours, employee.working_hours),
    weekly_hours: num(pick("weekly_hours", WEEKLY_HOURS)),
  };

  const pay = {
    base_salary: baseSalary,
    lines,
    monthly_gross: grossOf(baseSalary, lines),
    currency: pick("salary_currency", row.salary_currency, employee.salary_currency, "XAF"),
    method: pick("payment_method", employee.payment_method, "BANK_TRANSFER"),
  };

  const doc = {
    number: row.doc_number || null,
    date_signed: iso(row.signed_on),
    // Where it is signed defaults to where the work is done, and the competent
    // labour court is that of the place of work — so one answer, two uses,
    // and either can be overridden on the contract.
    place_signed: pick("place_signed", row.place_signed, placeOfWork, entity.incorporation_place),
    jurisdiction_city: pick("jurisdiction_city", row.jurisdiction_city, placeOfWork, entity.incorporation_place),
  };

  return { employee, entity, representative: row.representative || {}, terms, pay, doc };
}

/**
 * Compose the contract this row describes.
 *
 * `clauseOverrides` carries a rewritten clause body keyed by article — the one
 * thing the model is allowed to change, and the one thing a person editing the
 * text by hand changes. It is never a whole document.
 *
 * Throws CONTRACT_FACT_MISSING (422, naming every missing fact) rather than
 * producing a document with a hole in it.
 */
function build(row, { overrides = {}, clauseOverrides = {} } = {}) {
  const { libraryKey, language, employmentType } = pickLibrary(row, overrides);
  const facts = factsFor(row, overrides);
  const bundle = buildBundle(facts, language);
  const composed = compose({ libraryKey, language, bundle, overrides: clauseOverrides });
  return {
    composed,
    body_md: toMarkdown(composed),
    facts,
    // What the contract row must record about how it was made. Kept beside the
    // composition so the two cannot describe different documents.
    columns: {
      language,
      clause_library_key: composed.library_key,
      clause_library_version: composed.library_version,
      employment_type: employmentType,
      title: composed.title,
      job_title: facts.terms.job_title,
      base_salary: facts.pay.base_salary,
      gross_salary: facts.pay.monthly_gross,
      salary_currency: facts.pay.currency,
      probation_months: facts.terms.probation_months,
      notice_days: facts.terms.notice_days,
      working_hours: facts.terms.working_hours,
      place_of_work: facts.terms.place_of_work,
      effective_on: facts.terms.effective_on,
      end_on: facts.terms.end_on,
      place_signed: facts.doc.place_signed,
      jurisdiction_city: facts.doc.jurisdiction_city,
      /* « Fait à Douala, le … » and the two signature panels, resolved. Stored
       * rather than recomposed at print time: the library may be revised, and a
       * contract must print the closing it was composed with — the same reason
       * `clause_library_version` is pinned. Out of `body_md` because it carries
       * no heading, and a renderer that cuts at `##` would otherwise print it
       * as the last paragraph of the disputes clause. */
      closing_md: composed.closing,
      /*
       * STRINGIFIED, and it has to be.
       *
       * node-postgres binds a JS ARRAY as a Postgres array literal — `{…,…}` —
       * which a `jsonb` column rejects outright with 22P02, "invalid input
       * syntax for type json". A plain object is fine (it serialises to JSON),
       * which is why `employee_snapshot` and `pay_snapshot` below need nothing:
       * the two panels are the only top-level array here. Caught by writing a
       * composed contract to a real database — every save would have failed.
       *
       * The column reads back parsed, so `Array.isArray(signature_labels)` in
       * the document template is still the right check on the way out.
       */
      signature_labels: JSON.stringify(composed.signatures),
      // Frozen: the document renders from these, never from the live rows. A
      // correction typed next year must not rewrite a contract signed this one.
      employee_snapshot: facts.employee,
      pay_snapshot: { ...facts.pay },
    },
  };
}

/**
 * What is still missing, without refusing — the wizard asks this on every
 * keystroke and must never be answered with an exception.
 */
function readiness(row, { overrides = {} } = {}) {
  const { libraryKey, language, employmentType } = pickLibrary(row, overrides);
  const facts = factsFor(row, overrides);
  let result;
  try {
    result = dryRun({ libraryKey, language, bundle: buildBundle(facts, language) });
  } catch (err) {
    // NO_CLAUSE_LIBRARY: an employment type nobody authored a library for. Not
    // a missing fact — a missing document — so it is reported as its own thing
    // rather than as an empty token list that would read as "nearly ready".
    if (err && err.code === "NO_CLAUSE_LIBRARY") {
      return { ready: false, missing: [], library_key: libraryKey, language, employment_type: employmentType, error: err.code };
    }
    throw err;
  }
  return { ...result, library_key: libraryKey, language, employment_type: employmentType };
}

module.exports = {
  build, readiness, factsFor, pickLibrary, grossOf, monthsBetween, WEEKLY_HOURS,
};
