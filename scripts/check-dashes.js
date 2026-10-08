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
const { readFileSync, writeFileSync } = require("node:fs");

/** See check-prose.mjs: existsSync-then-readFileSync is a check-then-use the
 *  file can slip through (CodeQL js/file-system-race). Attempt, then handle. */
function readIfPresent(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}
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

/* The `$` binds to the LAST alternative only, which is what is wanted: a
   declaration file ends in .d.ts, while the other four are substrings that
   can appear anywhere in a path. Grouped explicitly so the precedence is
   stated rather than relied upon (CodeQL js/regex/missing-regexp-anchor). */
const SKIP = /\.(?:test|spec)\.|\.stories\.|__tests__|node_modules|(?:\.d\.ts)$/;

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
 * Pull the readable text out of a line: string literals, plus JSX TEXT NODES.
 *
 * The second half was a real miss. `<option value="">—</option>` renders an em
 * dash to the user and contains no string literal at all, so a literal-only
 * scan called the file clean while the dash was on screen. JSX text between
 * two tags is copy as surely as anything in quotes, and that is where the
 * empty-value dashes live.
 */
function literals(line) {
  const out = [];
  const re = /(["'`])((?:(?!\1)[^\\]|\\.)*)\1/g;
  let m;
  while ((m = re.exec(line))) out.push(m[2]);
  const jsx = /> *([^<>{}"'`]*[\u2013\u2014\u2015][^<>{}"'`]*?) *</g;
  while ((m = jsx.exec(line))) out.push(m[1]);

  /* A CONTINUATION LINE of wrapped JSX text.
   *
   * The two patterns above both need the text between a ">" and a "<" on one
   * line. The formatter does not oblige: a long paragraph is wrapped, and its
   * middle lines carry neither tag. That is how five printed lines of KYC
   * guidance, em dash and all, passed this gate while being the longest piece
   * of copy on the screen. A line that is bare prose (no tag, no brace, no
   * quote) and holds a dash is copy by elimination. */
  if (
    /[\u2013\u2014\u2015]/.test(line) &&
    !/[<>{}"'`]/.test(line) &&
    !line.includes("//") &&   // a trailing line comment, still out of scope
    /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(line)
  ) {
    out.push(line.trim());
  }
  return out;
}

function files() {
  const out = execFileSync("git", ["ls-files", ...GLOBS], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  /* An unmerged path is printed once per stage, so a conflicted merge
     counts every dash in it three times. Dedupe. */
  return [...new Set(out.split("\n").filter(Boolean))].filter((f) => !SKIP.test(f));
}

/**
 * THE EMPTY-VALUE GLYPH IS NOT COPY.
 *
 * A string that is ONLY a dash, or a word wrapped in them ("— none —"), is the
 * "no value here" marker in a table cell, a stat tile or a select. It is
 * typography, not writing: it has no voice, it cannot be rephrased, and it is
 * not what reads as machine-written. Banning it would mean 196 edits in master
 * data alone, every one of them replacing a conventional marker with a blank
 * cell or a word that is longer than the column.
 *
 * This is a DECISION, not an oversight, and it is a one-line decision to
 * reverse: delete this function and the gate will list every one of them.
 * `lib/format.ts` is where most are minted (`money()` and friends return it),
 * so changing the marker product-wide is a change in one file.
 */
function emptyValueGlyph(text) {
  return (
    /^\s*[\u2013\u2014\u2015]\s*$/.test(text) ||
    /^\s*[\u2013\u2014\u2015][^\u2013\u2014\u2015]{0,24}[\u2013\u2014\u2015]\s*$/.test(text)
  );
}

const hits = {};
for (const f of files()) {
  const lines = readFileSync(join(repoRoot, f), "utf8").split("\n");
  /* Whether this line is inside a /* ... *\/ block.
   *
   * Comments are out of scope by decision, and the old test for one was
   * "the line starts with //, * or /*". The comments in this repository are
   * prose paragraphs that do not re-prefix every line, so their middle lines
   * looked exactly like wrapped JSX text and the widened reader below started
   * reporting them. Tracking the state is the only way to tell a sentence in a
   * comment from a sentence on the screen. */
  let inBlockComment = false;
  lines.forEach((line, i) => {
    const wasInComment = inBlockComment;
    const opens = (line.match(/\/\*/g) || []).length;
    const closes = (line.match(/\*\//g) || []).length;
    if (opens > closes) inBlockComment = true;
    else if (closes > opens) inBlockComment = false;
    if (wasInComment || inBlockComment) return;
    if (exempt(lines, i) || mechanical(line)) return;
    for (const lit of literals(line)) {
      if (emptyValueGlyph(lit)) continue;
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
  console.error(`dash-baseline.json written: ${total} dashes in tenant-readable copy across ${Object.keys(counts).length} files.`);
  process.exit(0);
}

const baselineSrc = readIfPresent(BASELINE);
const baseline = baselineSrc === null ? {} : JSON.parse(baselineSrc);

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
console.error(`check:dashes clean: ${total} remaining in tenant-readable copy, none added.`);
