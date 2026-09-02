#!/usr/bin/env node
/**
 * The eighteen clause libraries are the contract. This proves they are intact.
 *
 * ── WHY A GATE AND NOT JUST TESTS ──────────────────────────────────────────
 *
 * The libraries are DATA, not code, and they will be edited by whoever is
 * asked to bring a clause into line with counsel's review. That is the point of
 * them — a lawyer can read the text beside the article it implements and say
 * yes or no. But it means the usual protection does not apply: a typo in a
 * token name is not a syntax error, a clause added to the French library and
 * forgotten in the English is not a type error, and an article that lost its
 * `basis` still renders perfectly. Every one of those produces a contract that
 * looks entirely correct and is not.
 *
 * So this checks the properties the whole design rests on, and nothing else:
 *
 *   1. ALL EIGHTEEN EXIST — nine keys × two languages, each loadable.
 *   2. THE PAIRS AGREE — fr and en carry the same article keys IN THE SAME
 *      ORDER, the same `requires`, the same `aiEditable` and the same
 *      `omitWhenMissing`. They are one document in two languages; a clause in
 *      one and not the other is two different contracts, silently.
 *   3. EVERY TOKEN RESOLVES — a `{{term.job_titel}}` is not an error anywhere
 *      else in the stack. `clause-tokens` throws on it at COMPOSE time, which
 *      is to say in front of a user, on a document that was about to be signed.
 *   4. EVERY ARTICLE CITES ITS AUTHORITY — an article with no `basis` is a
 *      clause somebody invented, and the review this whole design exists to
 *      make possible cannot be done on one.
 *   5. NO ARTICLE NUMBERS ITS OWN HEADING — the composer numbers what it
 *      actually emitted, so an authored "ARTICLE 4" goes on claiming a number
 *      the document no longer has the moment a clause above it is dropped.
 *   6. `requires` AND `omitWhenMissing` NAME REAL, OPTIONAL TOKENS — naming a
 *      token that is already required is a no-op the author believed did
 *      something, and naming one that does not exist is a silent no-op too.
 *   7. THE LIBRARY THIS DOCUMENT NEEDS IS REACHABLE — every employment type
 *      the employee form offers maps to a library that exists.
 *
 * Exits 1 on any violation, naming the file and the reason.
 */
"use strict";

const path = require("path");

const libraries = require(path.join(__dirname, "..", "src", "services", "contracts", "libraries"));
const { TOKENS, tokensIn } = require(path.join(__dirname, "..", "src", "services", "contracts", "clause-tokens"));

/** The employment types the employee form offers — client/src/features/hr/employee-form-model.ts. */
const EMPLOYMENT_TYPES = ["CDI", "CDD", "STAGE", "INTERIM", "CONSULTANT", "TEMPORARY"];

const problems = [];
const fail = (where, why) => problems.push(`${where}: ${why}`);

/** Every piece of authored text in a library, with a label for the message. */
function textsOf(lib) {
  const out = [];
  if (lib.preamble) {
    out.push(["preamble.heading", lib.preamble.heading]);
    out.push(["preamble.body", lib.preamble.body]);
  }
  for (const a of lib.articles || []) {
    out.push([`${a.key}.heading`, a.heading]);
    out.push([`${a.key}.body`, a.body]);
  }
  if (lib.closing) {
    out.push(["closing.body", lib.closing.body]);
    for (const s of lib.closing.signatures || []) out.push([`closing.${s.party}.mention`, s.mention]);
  }
  return out;
}

// ── 1. All eighteen ────────────────────────────────────────────────────────
const loaded = new Map();
for (const key of libraries.LIBRARY_KEYS) {
  for (const language of libraries.LANGUAGES) {
    try {
      loaded.set(`${key}:${language}`, libraries.get(key, language));
    } catch (err) {
      fail(`${key}:${language}`, `no library — ${err.message}`);
    }
  }
}
const expected = libraries.LIBRARY_KEYS.length * libraries.LANGUAGES.length;
if (libraries.all().length !== expected) {
  fail("libraries/index.js", `registers ${libraries.all().length} libraries, expected ${expected}`);
}

for (const [id, lib] of loaded) {
  const [key, language] = id.split(":");

  // The library knows what it is.
  if (lib.key !== key) fail(id, `declares key "${lib.key}"`);
  if (lib.language !== language) fail(id, `declares language "${lib.language}"`);
  if (!lib.version) fail(id, "carries no version — a contract generated from it could not be traced to any wording");
  if (!lib.jurisdiction) fail(id, "names no jurisdiction");
  if (!lib.title) fail(id, "has no title");
  if (!Array.isArray(lib.articles) || !lib.articles.length) fail(id, "has no articles");

  const seen = new Set();
  for (const a of lib.articles || []) {
    const at = `${id} ${a.key || "(unnamed)"}`;
    if (!a.key) fail(id, "an article has no key");
    if (seen.has(a.key)) fail(at, "duplicate article key");
    seen.add(a.key);
    /* A letter's sign-off — « Veuillez agréer … » — is a section with no
     * heading, and that is the only place one is legitimate. An article of a
     * numbered instrument with no heading would print as "ARTICLE 7 : ". */
    if (!a.heading && lib.sectionStyle !== "letter") {
      fail(at, "no heading — only a letter may carry a headingless section");
    }
    if (!a.body || !String(a.body).trim()) fail(at, "no body");

    // ── 4. Authority ───────────────────────────────────────────────────────
    if (!a.basis || String(a.basis).trim().length < 10) {
      fail(at, "no `basis` — an article with no authority is a clause somebody invented");
    }
    // ── 5. The composer owns the numbering ─────────────────────────────────
    if (/^\s*ARTICLE\s*\d/i.test(String(a.heading || ""))) {
      fail(at, `heading "${a.heading}" numbers itself — the composer numbers what it emitted, and an authored number survives a dropped clause above it`);
    }
    if (typeof a.aiEditable !== "boolean") {
      fail(at, "`aiEditable` must be declared true or false — the leash is not a default");
    }
    // ── 6a. omitWhenMissing names a real, optional token ───────────────────
    for (const token of a.omitWhenMissing || []) {
      if (!TOKENS[token]) fail(at, `omitWhenMissing names "${token}", which is not a token`);
      else if (!TOKENS[token].optional) {
        fail(at, `omitWhenMissing names "${token}", which is already required — the article can never be dropped, so the entry does nothing`);
      } else if (!tokensIn(a.body).includes(token)) {
        fail(at, `omitWhenMissing names "${token}", which this article's body never uses`);
      }
    }
  }

  // ── 6b. requires names a real, optional token the document actually uses ──
  const allTokens = new Set(textsOf(lib).flatMap(([, text]) => tokensIn(text)));
  for (const token of lib.requires || []) {
    if (!TOKENS[token]) fail(id, `requires "${token}", which is not a token`);
    else if (!TOKENS[token].optional) {
      fail(id, `requires "${token}", which is already required everywhere — the entry does nothing`);
    } else if (!allTokens.has(token)) {
      fail(id, `requires "${token}", which this document never uses`);
    }
  }

  // ── 3. Every token resolves ───────────────────────────────────────────────
  for (const [where, text] of textsOf(lib)) {
    for (const token of tokensIn(text)) {
      if (!TOKENS[token]) {
        fail(`${id} ${where}`, `uses {{${token}}}, which no token defines — this throws at COMPOSE time, in front of a user`);
      }
    }
  }

  // The two signature panels a contract is signed in.
  if (lib.closing) {
    const parties = (lib.closing.signatures || []).map((s) => s.party);
    if (!parties.length) fail(id, "closing carries no signature panels");
    for (const s of lib.closing.signatures || []) {
      if (!s.party) fail(id, "a signature panel names no party");
      if (!s.label) fail(id, `the ${s.party} signature panel has no label`);
    }
  }
}

// ── 2. The pairs agree ─────────────────────────────────────────────────────
const listOf = (lib, get) => (lib.articles || []).map(get).join("|");
for (const key of libraries.LIBRARY_KEYS) {
  const fr = loaded.get(`${key}:fr`);
  const en = loaded.get(`${key}:en`);
  if (!fr || !en) continue;

  if (listOf(fr, (a) => a.key) !== listOf(en, (a) => a.key)) {
    fail(key, "the French and English articles differ in key or order — one document in two languages, not two documents");
  }
  if ((fr.requires || []).join("|") !== (en.requires || []).join("|")) {
    fail(key, "`requires` differs between fr and en — the same document cannot need a fact in one language and not the other");
  }
  if (listOf(fr, (a) => String(a.aiEditable)) !== listOf(en, (a) => String(a.aiEditable))) {
    fail(key, "`aiEditable` differs between fr and en — a model may rewrite a clause in one language and not the other");
  }
  if (listOf(fr, (a) => (a.omitWhenMissing || []).join(","))
      !== listOf(en, (a) => (a.omitWhenMissing || []).join(","))) {
    fail(key, "`omitWhenMissing` differs between fr and en — the same facts would produce different documents");
  }
  if (fr.version !== en.version) fail(key, "the two languages carry different versions");
  if (fr.sectionStyle !== en.sectionStyle) fail(key, "the two languages lay out differently");
}

// ── 7. Every employment type reaches a library ─────────────────────────────
for (const type of EMPLOYMENT_TYPES) {
  const resolved = libraries.libraryKeyFor({ kind: "EMPLOYMENT", employmentType: type });
  if (!libraries.LIBRARY_KEYS.includes(resolved)) {
    fail("libraryKeyFor", `employment type ${type} resolves to "${resolved}", which is not a library`);
  }
}

if (problems.length) {
  console.error(`\nContract-library gate: ${problems.length} problem${problems.length === 1 ? "" : "s"}\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("\nSee src/services/contracts/libraries/_shape.js for what a library must be.\n");
  process.exit(1);
}

const articles = libraries.all().reduce((n, l) => n + l.articles.length, 0);
const used = new Set(libraries.all().flatMap((l) => textsOf(l).flatMap(([, t]) => tokensIn(t))));
console.log(
  `Contract-library gate: clean — ${loaded.size} libraries, ${articles} articles, `
  + `every one citing its authority; ${used.size} of ${Object.keys(TOKENS).length} tokens in use, all resolving.`,
);
