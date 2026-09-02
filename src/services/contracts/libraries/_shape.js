/**
 * What a clause library is, and the rules every one of the eighteen obeys.
 *
 * ── WHY EIGHTEEN FILES AND NOT ONE WITH CONDITIONS ─────────────────────────
 *
 * A CDD is not a CDI with a date on it. The Labour Code caps its term and its
 * renewals, converts it to a CDI if work continues past the term, and gives it
 * an end-of-contract indemnity a CDI has no concept of. A stage is not a
 * contract of employment at all. Expressing those as flags on a shared body
 * would mean the conditional logic becomes the thing counsel has to audit —
 * and counsel reads contracts, not code.
 *
 * So each library is one document, readable end to end, in one language. What
 * is shared between them is the TOKEN VOCABULARY and the composer, never the
 * clause text.
 *
 * ── THE SHAPE ──────────────────────────────────────────────────────────────
 *
 *   key         CDI | CDD | STAGE | INTERIM | CONSULTANT | TEMPORARY
 *               | OFFER_LETTER | CONFIRMATION | TERMINATION
 *   language    'fr' | 'en'   — one, never both. A contract is signed in a
 *               language; a bilingual instrument raises which-version-governs.
 *   jurisdiction'CM'          — the body of law the text is written against.
 *   version     The date-stamped revision. Recorded on every contract generated
 *               from it (`hr_contract.clause_library_version`), so a document
 *               issued last March can be traced to the wording in force then.
 *   title       The heading the document carries.
 *   preamble    The « ENTRE LES SOUSSIGNÉS » block — the parties, before Article 1.
 *   requires    Optional tokens THIS document cannot do without. See below.
 *   articles[]  Ordered. Each: { key, heading, body, basis, aiEditable,
 *                                omitWhenMissing? }
 *   closing     The « Fait à … » block above the signatures.
 *
 * ── THE HEADINGS CARRY NO NUMBERS ──────────────────────────────────────────
 *
 * `heading` is "ENGAGEMENT ET DURÉE", never "ARTICLE 1 : ENGAGEMENT ET DURÉE".
 * The composer numbers the articles it actually emitted, so the numbering
 * cannot disagree with the document: an authored number would have gone on
 * saying "ARTICLE 4" after the article above it was dropped. Anything that
 * needs to point at another clause names it — a cross-reference by number is
 * the same bug written twice.
 *
 * ── `requires` — REQUIREDNESS THE TOKEN TABLE CANNOT STATE ─────────────────
 *
 * `term.end_date` is genuinely optional to a CDI and inconceivable to omit from
 * a CDD. One flag per token cannot say that, so each library names the optional
 * tokens it hard-requires and the resolver upgrades them for that document
 * only.
 *
 * ── `omitWhenMissing` — THE ONLY WAY A CLAUSE MAY DISAPPEAR ────────────────
 *
 * An article listing a token here is DROPPED when that token is empty, and the
 * drop is recorded on the composed document (`omitted[]`) rather than being
 * silent. It is for clauses whose subject may genuinely not exist: art. 28
 * makes probation a stipulation, so an engagement with none agreed has no
 * probation article — as against "une période d'essai de  mois", which is not a
 * clause but a defect. Everything else that is missing REFUSES; see
 * clause-tokens.js for why that asymmetry is deliberate.
 *
 * ── `basis` IS NOT DECORATION ──────────────────────────────────────────────
 *
 * Every article names the provision it implements. That is what makes a review
 * possible: a lawyer can read the clause beside its authority and say yes or
 * no, rather than having to reconstruct the intent. An article with no basis
 * is a clause somebody invented, and `check:contract-libraries` fails on one.
 *
 * ── `aiEditable` IS THE LEASH ──────────────────────────────────────────────
 *
 * Gemini may rewrite ONLY articles marked true — in practice the duties clause,
 * where prose about a particular job genuinely helps. Everything else is
 * statutory or numeric and is rendered exactly as authored. A model that
 * "improves" a notice period has rewritten the agreement.
 *
 * ── STATUS ────────────────────────────────────────────────────────────────
 *
 * These are TEMPLATES, drafted against Loi n° 92/007 du 14 août 1992 portant
 * Code du Travail and the practice evidenced by the tenant's own signed
 * contracts. They are not legal advice and have not been settled by counsel.
 * `doc/CONTRACT_LIBRARIES.md` carries the review log; the same posture
 * doc/OHADA_KB.md takes with its [VERIFY] markers on tax rates applies here,
 * for the same reason.
 */
"use strict";

/** The nine library keys. Twelve full bodies + six letters = eighteen files. */
const FULL_BODY_KEYS = ["CDI", "CDD", "STAGE", "INTERIM", "CONSULTANT", "TEMPORARY"];
const LETTER_KEYS = ["OFFER_LETTER", "CONFIRMATION", "TERMINATION"];
const LIBRARY_KEYS = [...FULL_BODY_KEYS, ...LETTER_KEYS];
const LANGUAGES = ["fr", "en"];

/** The revision every library in this release carries. Bump on any text change. */
const LIBRARY_VERSION = "2026-09-CM-1";

module.exports = { FULL_BODY_KEYS, LETTER_KEYS, LIBRARY_KEYS, LANGUAGES, LIBRARY_VERSION };
