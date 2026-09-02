/**
 * Composing a contract: the facts on one side, an authored library on the other.
 *
 * ── WHAT CHANGED, AND WHY ──────────────────────────────────────────────────
 *
 * `hr_contract.draft` used to hand thirteen facts to a model and ask it for the
 * whole document. That is a reasonable way to get prose and a poor way to get
 * an instrument: two hires on identical terms produced different contracts,
 * the body could not be diffed, and a model outage meant no contract at all.
 * Worse, the model wrote in English against Cameroonian labour law and nothing
 * in the pipeline noticed.
 *
 * Composition inverts it. The eighteen libraries are the document; this module
 * fills them. Nothing here decides a term, invents a clause or reorders an
 * article — it resolves tokens and refuses when a fact the text relies on is
 * absent. `hr_contract.draft` still exists, reduced to what a model is actually
 * good at: rephrasing ONE clause that is marked `aiEditable`.
 *
 * ── THE BUNDLE IS BUILT ONCE ───────────────────────────────────────────────
 *
 * Every label a contract prints — « Mme », « Camerounaise », « virement
 * bancaire », « CNI » — is derived here rather than in the library text, so the
 * French and English libraries do not each carry their own copy of the same
 * mapping and drift apart. The libraries hold sentences; this holds vocabulary.
 */
"use strict";

const libraries = require("./libraries");
const { fill, assertComplete, amount, clean } = require("./clause-tokens");

/* ── Vocabulary. One table per label, both languages, so a library never
 *    hard-codes a word that the other language would have to translate. ──── */

const CIVILITY = {
  MR:   { fr: "M.",   en: "Mr" },
  MRS:  { fr: "Mme",  en: "Mrs" },
  MS:   { fr: "Mlle", en: "Ms" },
  DR:   { fr: "Dr",   en: "Dr" },
  PROF: { fr: "Pr",   en: "Prof" },
};

/** Gendered fallback when nobody recorded a civility — the contract's prose is
 *  gendered throughout and « M./Mme » is not an acceptable thing to print. */
const CIVILITY_BY_GENDER = { MALE: "MR", FEMALE: "MRS" };

const ID_TYPE = {
  CNI:              { fr: "CNI", en: "national identity card" },
  PASSPORT:         { fr: "passeport", en: "passport" },
  RESIDENCE_PERMIT: { fr: "carte de séjour", en: "residence permit" },
  OTHER:            { fr: "pièce d'identité", en: "identity document" },
};

const PAYMENT_METHOD = {
  BANK_TRANSFER: { fr: "virement bancaire", en: "bank transfer" },
  MOBILE_MONEY:  { fr: "mobile money", en: "mobile money" },
  CASH:          { fr: "espèces", en: "cash" },
  CHEQUE:        { fr: "chèque", en: "cheque" },
};

const MARITAL = {
  SINGLE:     { fr: "célibataire", en: "single" },
  MARRIED:    { fr: "marié(e)", en: "married" },
  DIVORCED:   { fr: "divorcé(e)", en: "divorced" },
  WIDOWED:    { fr: "veuf/veuve", en: "widowed" },
  SEPARATED:  { fr: "séparé(e)", en: "separated" },
  COHABITING: { fr: "en concubinage", en: "cohabiting" },
};

/**
 * Nationality as an adjective, which is what the clause needs — « de
 * nationalité Camerounaise », not « de nationalité CM ».
 *
 * Only the countries this product actually hires in are named. An unlisted code
 * falls back to the country's own name rather than to a guessed adjective: a
 * wrong demonym in a legal identification is worse than a clumsy one.
 */
/**
 * The country as a NOUN, for the employer's registered office.
 *
 * Separate table from NATIONALITY on purpose. Running the entity's country code
 * through the adjective table printed « dont le siège social est situé au …,
 * Camerounaise » — the company was given a nationality where the sentence
 * wanted a place. Same codes, different part of speech, so different table.
 */
const COUNTRY = {
  CM: { fr: "Cameroun", en: "Cameroon" },
  FR: { fr: "France", en: "France" },
  NG: { fr: "Nigéria", en: "Nigeria" },
  TD: { fr: "Tchad", en: "Chad" },
  CF: { fr: "République centrafricaine", en: "Central African Republic" },
  GA: { fr: "Gabon", en: "Gabon" },
  GQ: { fr: "Guinée équatoriale", en: "Equatorial Guinea" },
  CG: { fr: "Congo", en: "Congo" },
  CD: { fr: "République démocratique du Congo", en: "Democratic Republic of the Congo" },
  CI: { fr: "Côte d'Ivoire", en: "Côte d'Ivoire" },
  SN: { fr: "Sénégal", en: "Senegal" },
  BE: { fr: "Belgique", en: "Belgium" },
  GB: { fr: "Royaume-Uni", en: "United Kingdom" },
  US: { fr: "États-Unis", en: "United States" },
  IN: { fr: "Inde", en: "India" },
  CN: { fr: "Chine", en: "China" },
  LB: { fr: "Liban", en: "Lebanon" },
};

/**
 * The legal form, spelled out.
 *
 * A contract reads « SLAS LOGISTICS SARL, société à responsabilité limitée, dont
 * le siège… ». Printing the abbreviation the legal name already ends with gives
 * « SLAS LOGISTICS SARL, SARL », which is how you can tell a document was
 * generated. The OHADA forms are named here; anything else prints as recorded,
 * because a tenant in a jurisdiction this list does not cover knows its own
 * form better than a fallback would.
 */
const LEGAL_FORM = {
  SARL:  { fr: "société à responsabilité limitée", en: "private limited liability company" },
  SARLU: { fr: "société à responsabilité limitée unipersonnelle", en: "single-member private limited liability company" },
  SA:    { fr: "société anonyme", en: "public limited company" },
  SAS:   { fr: "société par actions simplifiée", en: "simplified joint-stock company" },
  SASU:  { fr: "société par actions simplifiée unipersonnelle", en: "single-member simplified joint-stock company" },
  SNC:   { fr: "société en nom collectif", en: "general partnership" },
  SCS:   { fr: "société en commandite simple", en: "limited partnership" },
  GIE:   { fr: "groupement d'intérêt économique", en: "economic interest grouping" },
  SCI:   { fr: "société civile immobilière", en: "property holding company" },
  EI:    { fr: "entreprise individuelle", en: "sole trader" },
};

const NATIONALITY = {
  CM: { fr: "Camerounaise", en: "Cameroonian" },
  FR: { fr: "Française", en: "French" },
  NG: { fr: "Nigériane", en: "Nigerian" },
  TD: { fr: "Tchadienne", en: "Chadian" },
  CF: { fr: "Centrafricaine", en: "Central African" },
  GA: { fr: "Gabonaise", en: "Gabonese" },
  GQ: { fr: "Équato-guinéenne", en: "Equatorial Guinean" },
  CG: { fr: "Congolaise", en: "Congolese" },
  CD: { fr: "Congolaise (RDC)", en: "Congolese (DRC)" },
  CI: { fr: "Ivoirienne", en: "Ivorian" },
  SN: { fr: "Sénégalaise", en: "Senegalese" },
  BE: { fr: "Belge", en: "Belgian" },
  GB: { fr: "Britannique", en: "British" },
  US: { fr: "Américaine", en: "American" },
  IN: { fr: "Indienne", en: "Indian" },
  CN: { fr: "Chinoise", en: "Chinese" },
  LB: { fr: "Libanaise", en: "Lebanese" },
};

const pick = (table, code, language, fallback = "") => {
  const row = table[String(code || "").toUpperCase()];
  return row ? row[language] || row.fr : fallback;
};

/**
 * Married-name clause. « FORMUM Epse FORGHAB » in the signed contract is a
 * birth name beside a married one, and it exists only where a name changed.
 *
 * Not language-dependent: "née" is the form used in English legal drafting too,
 * and the alternative ("formerly known as") says something weaker and different.
 * It carries its own leading comma so the surrounding sentence needs no
 * conditional punctuation — `{{employee.full_name}}{{employee.maiden_clause}},`
 * reads correctly whether or not there is a maiden name.
 */
function maidenClause(employee) {
  const maiden = clean(employee.maiden_name);
  return maiden ? `, née ${maiden}` : "";
}

/**
 * The allowance table Article 3 prints.
 *
 * Rendered here, not in the library, because it is a LIST whose length depends
 * on the person — a token that resolved to one line would have to be authored
 * as many lines, and a contract must not print an empty row for an allowance
 * nobody has.
 *
 * Only cash lines appear against the gross. A benefit in kind is remuneration
 * and is taxed, but nobody is handed it, so listing it inside a total the
 * payslip must match would make the contract state a figure that never arrives.
 */
function allowanceLines(pay, language) {
  const currency = clean(pay.currency);
  const label = language === "en" ? "Basic salary" : "Salaire de base";
  const rows = [`— ${label} : ${amount(pay.base_salary)} ${currency}`];
  for (const line of pay.lines || []) {
    if (!line.in_gross || line.kind === "DEDUCTION") continue;
    rows.push(`— ${clean(line.label)} : ${amount(line.amount)} ${currency}`);
  }
  const inKind = (pay.lines || []).filter((l) => !l.in_gross && l.kind !== "DEDUCTION");
  if (inKind.length) {
    const note = language === "en"
      ? "Benefits in kind (taxable, not paid in cash):"
      : "Avantages en nature (imposables, non versés en espèces) :";
    rows.push("", note);
    for (const l of inKind) rows.push(`— ${clean(l.label)} : ${amount(l.amount)} ${currency}`);
  }
  return rows.join("\n");
}

/**
 * Everything the tokens read, assembled from the rows the repo loaded.
 *
 * `language` is carried on the bundle because half the vocabulary above depends
 * on it, and threading it through every `get` would be the kind of parameter
 * that is right in fourteen places and forgotten in the fifteenth.
 */
function buildBundle({ employee = {}, entity = {}, representative = {}, terms = {}, pay = {}, doc = {} }, language) {
  const civilityCode = employee.civility || CIVILITY_BY_GENDER[String(employee.gender || "").toUpperCase()] || "";
  return {
    language,
    employee: {
      ...employee,
      civility_label: pick(CIVILITY, civilityCode, language),
      maiden_clause: maidenClause(employee),
      nationality_label: pick(NATIONALITY, employee.nationality, language, clean(employee.nationality)),
      id_type_label: pick(ID_TYPE, employee.id_document_type || "CNI", language),
      marital_label: pick(MARITAL, employee.marital_status, language),
      // ", " not " ": « Rue 1.234, Akwa Douala » ran the street into the city.
      residence: [clean(employee.residence_address), clean(employee.residence_city)].filter(Boolean).join(", "),
    },
    entity: {
      ...entity,
      country_label: pick(COUNTRY, entity.country_code, language, clean(entity.country_code)),
      legal_form_label: pick(LEGAL_FORM, entity.legal_form, language, clean(entity.legal_form)),
    },
    // Name and capacity only — see clause-tokens.js for why there is no civility.
    representative: { ...representative },
    terms,
    pay: {
      ...pay,
      method_label: pick(PAYMENT_METHOD, pay.method, language),
      allowance_lines: allowanceLines(pay, language),
    },
    doc,
  };
}

/**
 * The heading an article is printed under.
 *
 * The number is applied HERE and nowhere else. It used to be typed into the
 * heading itself, which meant the moment an article was dropped the ones below
 * it went on claiming numbers that no longer described the document. A letter's
 * sections are not articles and take no number at all.
 */
function headingFor(library, heading, number) {
  if (number === null) return heading;
  return library.language === "en" ? `ARTICLE ${number}: ${heading}` : `ARTICLE ${number} : ${heading}`;
}

/**
 * Fill a library from a bundle.
 *
 * Collects EVERY missing fact before refusing, so an HR officer is told about
 * all of them at once rather than discovering them one save at a time. The
 * `overrides` map lets a clause that a model rewrote (or a person edited)
 * replace the authored body for that article only — keyed by article, so
 * nothing can slip a whole document past the library.
 *
 * Two things decide whether an absent fact stops the document or shapes it:
 * `library.requires` upgrades an optional token this document cannot do
 * without, and `article.omitWhenMissing` drops an article whose subject does
 * not exist. Both are authored in the library; nothing is inferred here.
 */
function compose({ libraryKey, language, bundle, overrides = {} }) {
  const library = libraries.get(libraryKey, language);
  const required = new Set(library.requires || []);
  const missing = [];
  const take = (raw) => {
    const r = fill(raw, bundle, required);
    missing.push(...r.missing);
    return r;
  };

  const preamble = library.preamble ? take(library.preamble.body).text : "";

  const articles = [];
  const omitted = [];
  for (const a of library.articles) {
    const authored = overrides[a.key] !== undefined ? overrides[a.key] : a.body;
    // Resolved BEFORE the omission decision, so `empty` reports what this
    // article's own text actually failed to fill rather than what the bundle
    // happens to hold.
    const resolved = fill(authored, bundle, required);
    const absent = (a.omitWhenMissing || []).filter((t) => resolved.empty.includes(t));
    if (absent.length) {
      // Recorded, never silent. The wizard and the audit trail both show which
      // clause was left out and which fact left it out.
      omitted.push({ key: a.key, heading: a.heading, because: absent });
      continue;
    }
    missing.push(...resolved.missing);
    articles.push({
      key: a.key,
      // A letter's sections are not numbered as articles — see `sectionStyle`.
      number: library.sectionStyle === "letter" ? null : articles.length + 1,
      heading: a.heading,
      basis: a.basis,
      ai_edited: Object.prototype.hasOwnProperty.call(overrides, a.key),
      body: resolved.text,
    });
  }
  for (const a of articles) a.printed_heading = headingFor(library, a.heading, a.number);

  const closing = library.closing ? take(library.closing.body).text : "";
  const signatures = (library.closing?.signatures || []).map((s) => ({
    party: s.party,
    label: s.label,
    mention: take(s.mention).text,
  }));

  assertComplete(missing);

  return {
    library_key: library.key,
    library_version: library.version,
    language: library.language,
    section_style: library.sectionStyle || "articles",
    title: library.title,
    preamble_heading: library.preamble?.heading || "",
    preamble,
    articles,
    omitted,
    closing,
    signatures,
  };
}

/**
 * The composed document as markdown, for `hr_contract.body_md`.
 *
 * `##` headings, because `template.service.contractArticles()` already cuts the
 * body at `##` into the sections the PDF renders — the renderer did not need to
 * learn a new shape, and a contract edited by hand afterwards stays editable in
 * exactly the way it was before.
 */
function toMarkdown(composed) {
  const out = [];
  if (composed.preamble_heading) out.push(`## ${composed.preamble_heading}`);
  if (composed.preamble) out.push(composed.preamble);
  for (const a of composed.articles) {
    out.push(`## ${a.printed_heading || a.heading || ""}`.trimEnd());
    out.push(a.body);
  }
  if (composed.closing) out.push(composed.closing);
  return out.filter((s) => clean(s) !== "").join("\n\n");
}

/** What is missing, without throwing — the wizard's readiness view. */
function dryRun({ libraryKey, language, bundle }) {
  try {
    compose({ libraryKey, language, bundle });
    return { ready: true, missing: [] };
  } catch (err) {
    if (err && err.code === "CONTRACT_FACT_MISSING") {
      return { ready: false, missing: (err.details && err.details.missing) || [] };
    }
    throw err;
  }
}

module.exports = {
  buildBundle, compose, toMarkdown, dryRun, allowanceLines, headingFor,
  CIVILITY, ID_TYPE, PAYMENT_METHOD, MARITAL, NATIONALITY, COUNTRY, LEGAL_FORM,
};
