/**
 * The token vocabulary a contract clause may use, and the resolver that fills it.
 *
 * ── WHY THIS IS NOT letterhead-blocks.resolveTokens ────────────────────────
 *
 * That resolver exists and works, and it deliberately DROPS a line whose tokens
 * all came back empty — "Licence n° {{entity.licence}}" printing as a dangling
 * "Licence n°" is worse than printing nothing, so a letterhead line that lost
 * its subject disappears.
 *
 * A contract clause must do the opposite. A clause that quietly vanishes because
 * the employee's date of birth was blank produces a shorter contract that still
 * looks complete — and the missing article is discovered by whoever needs to
 * rely on it, months later. So this resolver REFUSES: an unfilled required token
 * raises `CONTRACT_FACT_MISSING` naming the token, and generation stops.
 *
 * `optional` tokens are the exception, and they are exceptional on purpose:
 * a maiden name exists only for some people, a fixed-term end date only for
 * some contracts. Those are declared per token, not decided at the call site.
 *
 * ── REQUIREDNESS IS SOMETIMES A PROPERTY OF THE DOCUMENT ───────────────────
 *
 * `term.end_date` is genuinely optional to a CDI and inconceivable to omit from
 * a CDD — a fixed-term contract with no term is not a fixed-term contract. One
 * flag per token cannot say that, so a library may name the optional tokens IT
 * cannot do without (`requires`), and `fill` upgrades them for that document
 * only. The default stays permissive; the library tightens it.
 *
 * ── THE VOCABULARY IS CLOSED ───────────────────────────────────────────────
 *
 * An unknown token is an error, not an empty string. In a letterhead a guessed
 * token name costs a blank line; here it would silently strip a term from a
 * legal instrument. Every name a library may use is listed below, which is also
 * what lets `check:contract-libraries` prove that every token any of the 18
 * libraries references actually resolves.
 */
"use strict";

const { AppError } = require("../../utils/errors");

const clean = (v) => (v === null || v === undefined ? "" : String(v).trim());

/** dd/mm/yyyy — the form every date takes in these documents, in both languages. */
function dmy(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean(iso));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** French long form: "28 février 1970". Used where the contract reads as prose. */
const FR_MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function longDate(iso, language) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean(iso));
  if (!m) return "";
  const months = language === "en" ? EN_MONTHS : FR_MONTHS;
  const d = Number(m[3]);
  const month = months[Number(m[2]) - 1];
  return language === "en" ? `${d} ${month} ${m[1]}` : `${d}${d === 1 ? "er" : ""} ${month} ${m[1]}`;
}

/**
 * 650000 -> "650 000", grouped with a narrow no-break space so a figure can
 * never wrap across two lines of a contract.
 *
 * Normalised rather than left to `toLocaleString` alone: which space that
 * returns for fr-FR is an ICU detail that has already changed once (U+00A0
 * before ICU 72, U+202F after), and a contract that groups its thousands
 * differently depending on the Node the server happens to run is not a
 * document you can diff. U+202F is what Node 20 emits and what `kit.js`
 * already puts in every rendered PDF, so the figures agree across the page.
 */
function amount(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("fr-FR").replace(/[\u202f\u00a0]/g, "\u202f");
}

/**
 * The vocabulary.
 *
 * `get` reads the composed fact bundle. `optional: true` means an empty value is
 * a legitimate answer and the clause still renders; anything else missing stops
 * generation with the token named, because the alternative is a contract with a
 * hole where a legal identification belongs.
 */
const TOKENS = {
  /* ── The employee, as the identification clause names them ─────────────── */
  "employee.civility":        { get: (b) => b.employee.civility_label },
  "employee.full_name":       { get: (b) => clean(b.employee.full_name) },
  "employee.maiden_clause":   { get: (b) => b.employee.maiden_clause, optional: true },
  "employee.birth_date":      { get: (b) => longDate(b.employee.date_of_birth, b.language) },
  "employee.birth_place":     { get: (b) => clean(b.employee.place_of_birth) },
  "employee.father_name":     { get: (b) => clean(b.employee.father_name) },
  "employee.mother_name":     { get: (b) => clean(b.employee.mother_name) },
  "employee.nationality":     { get: (b) => b.employee.nationality_label },
  "employee.id_type":         { get: (b) => b.employee.id_type_label },
  "employee.id_number":       { get: (b) => clean(b.employee.id_document_number) },
  "employee.id_issued_on":    { get: (b) => longDate(b.employee.id_document_issued_on, b.language) },
  "employee.id_issued_at":    { get: (b) => clean(b.employee.id_document_issued_at) },
  "employee.residence":       { get: (b) => clean(b.employee.residence) },
  "employee.marital_status":  { get: (b) => b.employee.marital_label, optional: true },
  "employee.children":        { get: (b) => clean(b.employee.dependent_children), optional: true },
  "employee.staff_no":        { get: (b) => clean(b.employee.staff_no) },
  "employee.cnps_number":     { get: (b) => clean(b.employee.cnps_number), optional: true },

  /* ── The employer, and the person who binds it ─────────────────────────── */
  /* The employer identification block is required in full, and that is not
   * strictness for its own sake. Each of these sits behind a LABEL in the
   * preamble — « Boîte Postale : {{entity.po_box}}, Téléphone : … » — so an
   * empty one does not shrink the sentence, it leaves a labelled blank in the
   * paragraph that says who is bound by the contract. They are recorded once
   * per company on the entity screen, not per hire. */
  "entity.legal_name":        { get: (b) => clean(b.entity.legal_name) },
  "entity.legal_form":        { get: (b) => b.entity.legal_form_label },
  "entity.address":           { get: (b) => clean(b.entity.address) },
  "entity.po_box":            { get: (b) => clean(b.entity.po_box) },
  "entity.city":              { get: (b) => clean(b.entity.city), optional: true },
  "entity.country":           { get: (b) => b.entity.country_label },
  "entity.phone":             { get: (b) => clean(b.entity.phone) },
  "entity.email":             { get: (b) => clean(b.entity.email) },
  "entity.rccm":              { get: (b) => clean(b.entity.rccm), optional: true },
  "entity.niu":               { get: (b) => clean(b.entity.niu), optional: true },
  /* There is deliberately no `rep.civility`. `entity_person` records a role, a
   * name and a title and no courtesy title, and what binds the employer is the
   * NAME and the CAPACITY — « représentée par Marc-Aurèle Ngassa, agissant en
   * qualité de Gérant ». A token with no column behind it would have refused
   * every contract until somebody invented an answer. */
  "rep.name":                 { get: (b) => clean(b.representative.full_name) },
  "rep.title":                { get: (b) => clean(b.representative.title) },

  /* ── The engagement ────────────────────────────────────────────────────── */
  "term.job_title":           { get: (b) => clean(b.terms.job_title) },
  "term.category":            { get: (b) => clean(b.terms.occupational_category), optional: true },
  "term.department":          { get: (b) => clean(b.terms.department), optional: true },
  "term.start_date":          { get: (b) => longDate(b.terms.effective_on, b.language) },
  "term.end_date":            { get: (b) => longDate(b.terms.end_on, b.language), optional: true },
  /* NOT term.end_date. An offer's validity and a fixed term's expiry are two
   * different dates that happened to share a token, so an offer letter for a
   * CDD would have told the candidate the offer lapsed on the day the job
   * ended. Same for a confirmation letter, where the date the engagement
   * becomes definitive is the end of the PROBATION, not of the contract. */
  "term.offer_valid_until":   { get: (b) => longDate(b.terms.offer_valid_until, b.language), optional: true },
  "term.probation_end_date":  { get: (b) => longDate(b.terms.probation_ends_on, b.language), optional: true },
  "term.duration_months":     { get: (b) => clean(b.terms.duration_months), optional: true },
  "term.probation_months":    { get: (b) => clean(b.terms.probation_months), optional: true },
  "term.notice_days":         { get: (b) => clean(b.terms.notice_days), optional: true },
  "term.place_of_work":       { get: (b) => clean(b.terms.place_of_work) },
  "term.working_hours":       { get: (b) => clean(b.terms.working_hours) },
  "term.weekly_hours":        { get: (b) => clean(b.terms.weekly_hours) },

  /* ── The money ─────────────────────────────────────────────────────────── */
  "pay.base":                 { get: (b) => amount(b.pay.base_salary) },
  "pay.gross":                { get: (b) => amount(b.pay.monthly_gross) },
  "pay.currency":             { get: (b) => clean(b.pay.currency) },
  "pay.method":               { get: (b) => b.pay.method_label },
  "pay.allowance_lines":      { get: (b) => b.pay.allowance_lines, optional: true },

  /* ── The document itself ───────────────────────────────────────────────── */
  "doc.number":               { get: (b) => clean(b.doc.number), optional: true },
  "doc.place_signed":         { get: (b) => clean(b.doc.place_signed) },
  /* An unsigned contract has no signature date, and « Fait à Douala, le , en
   * deux exemplaires » is not what a document to be signed by hand should say.
   * So the blank is a RULE to write on, never nothing — which is also why this
   * token is not `optional`: it always resolves. */
  "doc.date_signed":          { get: (b) => longDate(b.doc.date_signed, b.language) || "……………………" },
  "doc.jurisdiction_city":    { get: (b) => clean(b.doc.jurisdiction_city) },
};

const TOKEN_RE = /\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/gi;

/** Every token name a piece of authored text references, in order. */
function tokensIn(text) {
  const out = [];
  String(text || "").replace(TOKEN_RE, (_, name) => {
    out.push(String(name).toLowerCase());
    return "";
  });
  return out;
}

/**
 * Fill one authored string.
 *
 * Returns `{ text, missing, empty }` rather than throwing, so the caller can
 * collect EVERY missing fact across the whole contract and report them together
 * — being told about one blank field at a time, six times, is how a form gets
 * abandoned. `assertComplete` below is what turns that into a refusal.
 *
 * `empty` is the optional tokens that came back blank. The composer uses it to
 * decide whether an article whose subject does not exist should be printed at
 * all: "a probationary period of  months" is not a clause, it is a defect.
 *
 * @param {Set<string>|string[]} [required]  optional tokens this document treats
 *        as required — see the header. Anything not listed keeps its own flag.
 */
function fill(raw, bundle, required) {
  const req = required instanceof Set ? required : new Set(required || []);
  const missing = [];
  const empty = [];
  const text = String(raw || "").replace(TOKEN_RE, (_, rawName) => {
    const name = String(rawName).toLowerCase();
    const tok = TOKENS[name];
    if (!tok) {
      // A name nobody defined. In a letterhead this costs a blank line; here it
      // would silently strip a term from a legal instrument.
      throw new AppError("UNKNOWN_CONTRACT_TOKEN", `No such contract token: {{${name}}}`, 500, { token: name });
    }
    const v = clean(tok.get(bundle));
    if (!v) {
      if (!tok.optional || req.has(name)) missing.push(name);
      else empty.push(name);
    }
    return v;
  });
  return { text, missing, empty };
}

/** Refuse to produce a contract that has a hole in it. */
function assertComplete(missing) {
  const unique = [...new Set(missing)];
  if (!unique.length) return;
  throw new AppError(
    "CONTRACT_FACT_MISSING",
    `This contract cannot be generated yet — ${unique.length} fact${unique.length === 1 ? "" : "s"} the text relies on ${unique.length === 1 ? "is" : "are"} missing.`,
    422,
    { missing: unique },
  );
}

module.exports = { TOKENS, tokensIn, fill, assertComplete, dmy, longDate, amount, clean };
