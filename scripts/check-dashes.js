#!/usr/bin/env node
/**
 * Dash gate (tenant review, 8 Oct 2026): "No emdashes or double dashes
 * anywhere. It screams AI."
 *
 * He is right, and the reason is worth writing down rather than treating as
 * taste. An em dash in product copy is almost always a sentence doing two
 * jobs: a statement, a dash, and then the caveat, the aside or the second
 * thought that the writer could not bear to drop. That is the exact shape of
 * the over-explaining this whole change set is removing, so the two rules pull
 * in the same direction. Splitting "Nobody yet — messages go to the client
 * inbox team" into a label and an ⓘ is better copy AND less of it.
 *
 * SCOPE: WHAT A TENANT READS, AND NOTHING ELSE.
 *
 * Code comments and doc/ keep their dashes permanently. That was a deliberate
 * call: there are ~24,000 of them, rewriting them would collide with every
 * open branch, and no customer will ever see one. What this gate covers is the
 * product surface:
 *
 *     client/ platform-console/ public-web/   UI strings, labels, placeholders
 *     src/services/documents/templates        invoices, waybills, PDFs
 *     src/services/spreadsheet                xlsx and CSV exports
 *     src/**\/*.copy.js, site copy            marketing and portal text
 *
 * WHAT IS NOT A DASH VIOLATION, mechanically exempted because a literal ban on
 * "--" would not survive first contact with this repo:
 *
 *     var(--border), --shadow-l     920 CSS custom properties
 *     --check, --fast, --app        431 CLI flags in our own scripts
 *     -- comment                    SQL comment syntax in migrations
 *     i--, --count                  decrement operators
 *     ---                           Markdown front matter and rules
 *
 * REPLACEMENTS. A colon when the second half explains the first ("Nobody yet:
 * messages go to the inbox team"). A full stop when it is a second thought.
 * A comma when it is an aside. If none of the three fit, the sentence was
 * carrying two ideas and wants to be two sentences, or one of them belongs
 * behind an ⓘ.
 *
 *   node scripts/check-dashes.js [--update-baseline]
 *
 * Exit 0 = nothing a tenant reads contains one. Exit 1 = the list.
 *
 * ESCAPE HATCH: `@dash:keep <reason>` on the line or the line above. The one
 * case seen so far is a value that genuinely is a dash, such as a range
 * rendered from data the tenant supplied.
 */
const { readFileSync, writeFileSync, existsSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

const repoRoot = join(__dirname, "..");
const BASELINE = join(__dirname, "dash-baseline.json");
const UPDATE = process.argv.includes("--update-baseline");

/** Where a tenant-readable string can live. */
const GLOBS = [
  "client/src/**/*.tsx",
  "client/src/**/*.ts",
  "platform-console/src/**/*.tsx",
  "platform-console/src/**/*.ts",
  "public-web/**/*.tsx",
  "public-web/**/*.ts",
  "src/services/documents/templates/**/*.js",
  "src/services/spreadsheet/**/*.js",
];

const SKIP = /\.(test|spec)\.|\.stories\.|__tests__|node_modules|\.d\.ts$/;

/* The dashes themselves: em, en, horizontal bar, and "--" used as punctuation
   (surrounded by whitespace, or sitting between two word characters). */
const EM = /[—–―]/;
const DOUBLE = /(?:\s--\s|\w--\w)/;

/* A line is exempt wholesale when the dash cannot be copy. */
function mechanical(line) {
  return (
    /var\(\s*--/.test(line) ||          // CSS custom property read
    /^\s*--[\w-]+\s*:/.test(line) ||    // CSS custom property declaration
    /--[\w-]+\s*(?:=|,|\)|\]|$)/.test(line) && /argv|process\.argv|exec|spawn|npm |node |script/.test(line) ||
    /^\s*(?:\/\/|\*|\/\*)/.test(line) || // a comment line: out of scope by design
    /^\s*#/.test(line) ||
    /^\s*---+\s*$/.test(line) ||         // markdown rule / front matter
    /\w--|--\w/.test(line) && /\+\+|--;|--\)/.test(line) // decrement
  );
}

function exempt(lines, i) {
  const re = /@dash:keep\s+\S+/;
  return re.test(lines[i] || "") || re.test(lines[i - 1] || "");
}

/**
 * Pull the string literals out of a line. Only their CONTENTS can be copy, so
 * this is what keeps CLI flags, CSS and operators out of the result without
 * needing to enumerate every one of them.
 */
function literals(line) {
  const out = [];
  const re = /(["'`])((?:\\.|(?!\1).)*)\1/g;
  let m;
  while ((m = re.exec(line))) out.push(m[2]);
  return out;
}

function files() {
  const out = execFileSync("git", ["ls-files", ...GLOBS], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.split("\n").filter(Boolean).filter((f) => !SKIP.test(f));
}

const hits = {};
for (const f of files()) {
  const lines = readFileSync(join(repoRoot, f), "utf8").split("\n");
  lines.forEach((line, i) => {
    if (exempt(lines, i) || mechanical(line)) return;
    for (const lit of literals(line)) {
      if (EM.test(lit) || DOUBLE.test(lit)) {
        (hits[f] ||= []).push({ line: i + 1, text: lit.slice(0, 90) });
        break;
      }
    }
  });
}

const counts = Object.fromEntries(
  Object.entries(hits).map(([f, v]) => [f, v.length]),
);

if (UPDATE) {
  writeFileSync(BASELINE, `${JSON.stringify(counts, null, 2)}\n`);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`dash-baseline.json written: ${total} dashes in tenant-readable copy across ${Object.keys(counts).length} files.`);
  process.exit(0);
}

const baseline = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, "utf8"))
  : {};

/* The ratchet: a file may always lose dashes and may never gain them. A file
   with none today may never acquire one. */
const fails = [];
for (const [f, n] of Object.entries(counts)) {
  const allowed = baseline[f] ?? 0;
  if (n > allowed) fails.push({ f, n, allowed });
}

if (fails.length) {
  console.error(`\nEm dashes (or " -- ") in copy a tenant reads:\n`);
  for (const { f, n, allowed } of fails) {
    console.error(`  ${f}: ${n} (allowed ${allowed})`);
    for (const h of hits[f].slice(0, 3)) {
      console.error(`      L${h.line}  ${h.text}`);
    }
  }
  console.error(`\nUse a colon, a full stop or a comma. If none fits, the sentence is two sentences.`);
  console.error(`Exempt a genuine data dash with @dash:keep <reason>.\n`);
  process.exit(1);
}
const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`check:dashes clean: ${total} remaining in tenant-readable copy, none added.`);
