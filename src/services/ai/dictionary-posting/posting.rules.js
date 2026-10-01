/**
 * AI-suggested OHADA posting — the PURE half (meeting 6, F3 / F7).
 *
 *   normaliseLabel / cacheKey   the generic question's identity
 *   buildPrompt                 what Gemini is asked — label, category,
 *                               direction, nothing else
 *   parseGrounded               Gemini's native reply → { answer, sources,
 *                               searchSuggestion, queries, usage } — strict:
 *                               an answer that does not parse is a failure
 *   mapToTenant                 the generic SYSCOHADA numbers → THIS tenant's
 *                               chart: the account itself, else the nearest
 *                               existing postable leaf under it, else a mint
 *                               proposal for a person — never an invented
 *                               account, never a silent mint
 *   localSuggestion             the labelled fallback, from the tenant's own
 *                               audited lines, else doc/OHADA_KB.md defaults
 *   priceCall                   the model's own prices + the search fee
 *
 * No I/O here; the engine (engine.service.js) does the reading and writing.
 */
"use strict";

const { dictionaryPosting, dictionarySibling } = require("@praxis/shared");

/* ── The question's identity ─────────────────────────────────────────────── */

/**
 * Lower-case, accents stripped, punctuation and spaces collapsed, the sibling
 * suffixes removed — so "Gate-Pass Fee — Client Account" and "gate pass fee"
 * are one question, and every mode of a service shares it.
 */
function normaliseLabel(label) {
  return dictionarySibling
    .baseLabel(String(label || ""))
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** The label the question is asked about: English when given, else French. */
const questionLabel = ({ label_en, label_fr }) => (label_en && String(label_en).trim()) || String(label_fr || "").trim();

function cacheKey({ label_en, label_fr, category, direction }) {
  return [normaliseLabel(questionLabel({ label_en, label_fr })), String(category || "other"), direction || "*"].join("|");
}

/* ── The prompt ──────────────────────────────────────────────────────────── */

const SYSTEM = [
  "You are an expert accountant in the OHADA zone applying the revised SYSCOHADA (2017) chart of accounts,",
  "for a freight forwarder / logistics company in Cameroon (CEMAC), VAT 19.25 %.",
  "Use Google Search to check how OHADA / SYSCOHADA records the kind of line you are given.",
  "A débours (disbursement) is money paid in the client's name and re-billed at cost: it transits 4731 (Mandants),",
  "never classes 6 or 7, and carries no VAT of ours. Revenue of our own services is class 70 (706x). Our own costs are class 6.",
  "A deposit we lodge and recover is class 27 (275). Third parties are class 40 (suppliers) and 41 (clients).",
  "Answer with ONE JSON object and nothing else.",
].join(" ");

/**
 * The user turn. The label, category and direction are the WHOLE question —
 * no amounts, no client or supplier, no file, no tenant account label.
 */
function buildPrompt({ label_en, label_fr, category, direction }) {
  const label = questionLabel({ label_en, label_fr });
  const fr = label_en && label_fr && String(label_fr).trim() !== label ? ` (French: "${String(label_fr).trim()}")` : "";
  return [
    `Dictionary line: "${label}"${fr}. Category: ${category}.`,
    direction
      ? `Its direction is fixed: ${direction}.`
      : "Choose its direction: REVENUE (our own service sold), EXPENSE (our own cost), DISBURSEMENT (débours re-billed at cost) or ASSET (a deposit we lodge).",
    "Give the generic SYSCOHADA posting of this kind of line as JSON with exactly these keys:",
    '{"direction":"REVENUE|EXPENSE|DISBURSEMENT|ASSET","is_disbursement":true|false,',
    '"vat_treatment":"STANDARD|EXEMPT|DISBURSEMENT",',
    '"postings":[{"context":"sale|purchase|disbursement","debit":"<SYSCOHADA account number>","credit":"<SYSCOHADA account number>"}],',
    '"confidence":"high|medium|low","sources_agree":true|false,"rationale":"<two sentences>"}',
    "Use the most specific standard SYSCOHADA account numbers (4 digits where the plan has them).",
    "A REVENUE line posts in context sale (debit 4111, credit 706x). An EXPENSE or ASSET line posts in context purchase (credit 4011).",
    "A DISBURSEMENT line posts twice: purchase (debit 4731, credit 4011) and sale (debit 4111, credit 4731).",
  ].join("\n");
}

/* ── The reply ───────────────────────────────────────────────────────────── */

/** The JSON object inside a reply that may wrap it in a code fence or prose. */
function extractJson(text) {
  const s = String(text || "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const body = fenced ? fenced[1] : s;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * A native generateContent reply → the parts this feature uses. Throws a
 * typed error (`code`) for every failure, so the engine can fall back with
 * the reason: BLOCKED, EMPTY, UNPARSEABLE.
 */
function parseGrounded(data) {
  const fail = (code, message) => Object.assign(new Error(message), { code });
  if (data && data.promptFeedback && data.promptFeedback.blockReason) throw fail("BLOCKED", `Gemini refused the question (${data.promptFeedback.blockReason})`);
  const candidate = data && Array.isArray(data.candidates) ? data.candidates[0] : null;
  if (!candidate) throw fail("EMPTY", "Gemini returned no answer");
  const text = ((candidate.content && candidate.content.parts) || []).map((p) => p.text || "").join("");
  const parsed = dictionaryPosting.answer.safeParse(extractJson(text));
  if (!parsed.success) throw fail("UNPARSEABLE", "Gemini's answer did not match the posting contract");
  const gm = candidate.groundingMetadata || {};
  const sources = [];
  const seen = new Set();
  for (const ch of gm.groundingChunks || []) {
    const w = ch && ch.web;
    if (!w || !w.uri || seen.has(w.uri)) continue;
    seen.add(w.uri);
    sources.push({ title: w.title || w.uri, uri: w.uri });
  }
  const usage = data.usageMetadata || {};
  return {
    answer: parsed.data,
    sources,
    // Google requires the Search Suggestions to be shown with a grounded
    // answer, exactly as provided (renderedContent is their HTML + CSS).
    search_suggestion_html: (gm.searchEntryPoint && gm.searchEntryPoint.renderedContent) || null,
    queries: Array.isArray(gm.webSearchQueries) ? gm.webSearchQueries.length : 0,
    grounded: Boolean(gm.groundingChunks && gm.groundingChunks.length) || Boolean(gm.webSearchQueries && gm.webSearchQueries.length),
    usage: {
      input_tokens: Number(usage.promptTokenCount || 0),
      // Thinking tokens bill as output.
      output_tokens: Number(usage.candidatesTokenCount || 0) + Number(usage.thoughtsTokenCount || 0),
    },
  };
}

/** The structured part we may keep — never Google's text (see platform 0119). */
function cacheable(answer) {
  const rest = { ...answer };
  delete rest.rationale;
  return rest;
}

/* ── Price ───────────────────────────────────────────────────────────────── */

/** The price row for a model: the longest matching prefix, else '*'. */
function priceFor(prices, model) {
  const id = String(model || "").replace(/^models\//, "");
  let best = null;
  for (const p of prices || []) {
    if (p.model_prefix === "*") continue;
    if (id.startsWith(p.model_prefix) && (!best || p.model_prefix.length > best.model_prefix.length)) best = p;
  }
  return best || (prices || []).find((p) => p.model_prefix === "*") || null;
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;

/**
 * { tokens, search } in the price row's currency. `search` is per query on a
 * 'query'-priced model (Gemini 3.x) and per grounded prompt on a
 * 'prompt'-priced one (2.5) — one prompt, whatever the query count.
 */
function priceCall(price, { input_tokens = 0, output_tokens = 0, queries = 0, grounded = false }) {
  if (!price) return { tokens: 0, search: 0, currency: null };
  const tokens = (Number(input_tokens) / 1e6) * Number(price.input_per_1m) + (Number(output_tokens) / 1e6) * Number(price.output_per_1m);
  const units = price.search_unit === "prompt" ? (grounded ? 1 : 0) : Number(queries || 0);
  const search = (units * Number(price.search_fee || 0)) / Number(price.search_fee_per || 1000);
  return { tokens: round6(tokens), search: round6(search), currency: price.currency || "USD", search_units: units };
}

/* ── Mapping onto THIS tenant's chart ────────────────────────────────────── */

/**
 * One SYSCOHADA number → this tenant's chart.
 *   exact  the account exists and is postable
 *   child  the nearest EXISTING postable leaf under it ("706" → "7061")
 *   mint   nothing usable: a proposal for the existing "create account" panel,
 *          pre-filled (code, French label from the parent where known, the
 *          longest existing ancestor) — for a person to confirm
 */
function mapAccount(code, accounts) {
  const c = String(code);
  const byCode = new Map(accounts.map((a) => [String(a.code), a]));
  const hit = byCode.get(c);
  if (hit && hit.is_postable !== false) return { suggested: c, account: c, how: "exact" };
  const leaves = accounts
    .filter((a) => a.is_postable !== false && String(a.code).length > c.length && String(a.code).startsWith(c))
    .sort((a, b) => String(a.code).length - String(b.code).length || String(a.code).localeCompare(String(b.code)));
  if (leaves[0]) return { suggested: c, account: String(leaves[0].code), how: "child" };
  const parent = accounts
    .map((a) => String(a.code))
    .filter((x) => x.length < c.length && c.startsWith(x))
    .sort((a, b) => b.length - a.length)[0];
  return { suggested: c, account: null, how: "mint", mint: { code: c, parent_code: parent || null, label_fr: (hit && hit.label_fr) || null } };
}

/**
 * The tax code a rule should carry, from our VAT treatment and the tenant's
 * own codes. A débours carries none (the database refuses one); STANDARD takes
 * the tenant's standard sales VAT on a sale, its recoverable purchase VAT on a
 * purchase; EXEMPT takes none.
 */
function taxFor(context, vatTreatment, taxCodes) {
  if (vatTreatment !== "STANDARD" || context === "disbursement") return null;
  const by = (code) => (taxCodes || []).find((t) => String(t.code) === code);
  const t = context === "sale" ? by("TVA_STD") : by("TVA_INPUT_PURCH") || by("TVA_STD");
  return t ? t.tax_code_id : null;
}

/**
 * The generic answer as THIS tenant's posting rules, ready for the wizard, and
 * the confidence after mapping: lowered one step when an account had to be
 * mapped to a leaf under it or proposed for minting, and when the model said
 * its sources disagree (F3).
 */
function mapToTenant(answer, { accounts, taxCodes }) {
  let confidence = answer.confidence;
  if (answer.sources_agree === false) confidence = dictionaryPosting.lowerConfidence(confidence);
  let adjusted = false;
  const rules = answer.postings.map((p) => {
    const debit = mapAccount(p.debit, accounts);
    const credit = mapAccount(p.credit, accounts);
    if (debit.how !== "exact" || credit.how !== "exact") adjusted = true;
    const disb = answer.is_disbursement === true;
    return {
      applies_context: p.context,
      debit_account: debit.account,
      credit_account: credit.account,
      tax_code_id: disb ? null : taxFor(p.context, answer.vat_treatment, taxCodes),
      is_disbursement: disb,
      mapping: { debit, credit },
    };
  });
  if (adjusted) confidence = dictionaryPosting.lowerConfidence(confidence);
  return { rules, confidence, needs_mint: rules.some((r) => r.mapping.debit.how === "mint" || r.mapping.credit.how === "mint") };
}

/* ── The local fallback ──────────────────────────────────────────────────── */

/**
 * doc/OHADA_KB.md defaults by direction — §6 (débours through 4731), §8.2/8.3
 * (the two débours entries), §8.5 (an ordinary supplier invoice), the class 7
 * revenue mapping (706x) and class 27 deposits.
 */
const KB_DEFAULTS = {
  DISBURSEMENT: {
    is_disbursement: true,
    vat_treatment: "DISBURSEMENT",
    postings: [
      { context: "purchase", debit: "4731", credit: "4011" },
      { context: "sale", debit: "4111", credit: "4731" },
    ],
    ref: "doc/OHADA_KB.md §6, §8.2, §8.3",
  },
  REVENUE: { is_disbursement: false, vat_treatment: "STANDARD", postings: [{ context: "sale", debit: "4111", credit: "706" }], ref: "doc/OHADA_KB.md §5 class 7, §8.3" },
  EXPENSE: { is_disbursement: false, vat_treatment: "STANDARD", postings: [{ context: "purchase", debit: "638", credit: "4011" }], ref: "doc/OHADA_KB.md §5 class 6, §8.5" },
  ASSET: { is_disbursement: false, vat_treatment: "EXEMPT", postings: [{ context: "purchase", debit: "275", credit: "4011" }], ref: "doc/OHADA_KB.md §5 class 2" },
};

const CATEGORY_DIRECTION = { disbursement: "DISBURSEMENT", service: "REVENUE", overhead: "EXPENSE", asset: "ASSET", other: "EXPENSE" };

/**
 * The labelled local suggestion ("Suggested without a web search"), from:
 *   1. the tenant's OWN audited line most like this one (same category, a
 *      trigram-similar name — the company audited all 177 seeded rows, 9082),
 *      when it is similar enough to trust; else
 *   2. the OHADA KB default for the direction (chosen, or implied by the
 *      category).
 * `similar` is [{ label, direction, is_disbursement, rules: [{applies_context,
 * debit_account, credit_account}], similarity }], best first.
 */
function localSuggestion({ category, direction, similar = [] }) {
  const dir = direction || CATEGORY_DIRECTION[category] || "EXPENSE";
  const match = (similar || []).find((s) => s.rules && s.rules.length && (!direction || s.direction === direction));
  if (match && Number(match.similarity) >= 0.35) {
    const answer = {
      direction: match.direction,
      is_disbursement: match.is_disbursement === true,
      vat_treatment: match.is_disbursement ? "DISBURSEMENT" : match.taxed ? "STANDARD" : "EXEMPT",
      postings: match.rules
        .filter((r) => r.debit_account && r.credit_account)
        .slice(0, 3)
        .map((r) => ({ context: r.applies_context, debit: String(r.debit_account), credit: String(r.credit_account) })),
      confidence: Number(match.similarity) >= 0.6 ? "medium" : "low",
    };
    if (answer.postings.length) {
      return { answer, basis: { kind: "tenant_line", label: match.label, code: match.code, similarity: Number(match.similarity) } };
    }
  }
  const kb = KB_DEFAULTS[dir];
  return {
    answer: { direction: dir, is_disbursement: kb.is_disbursement, vat_treatment: kb.vat_treatment, postings: kb.postings, confidence: "low" },
    basis: { kind: "ohada_kb", ref: kb.ref },
  };
}

module.exports = {
  SYSTEM,
  normaliseLabel,
  questionLabel,
  cacheKey,
  buildPrompt,
  extractJson,
  parseGrounded,
  cacheable,
  priceFor,
  priceCall,
  mapAccount,
  taxFor,
  mapToTenant,
  localSuggestion,
  KB_DEFAULTS,
  CATEGORY_DIRECTION,
};
