#!/usr/bin/env node
/**
 * Prose gate (tenant review, 8 Oct 2026).
 *
 * THE COMPLAINT, VERBATIM: "there is a lot of supporting text on pages and
 * they are useless at first glance". The measurement behind it, before this
 * gate existed:
 *
 *     hint=            in client/src      805
 *     description=     in client/src      485
 *     .micro sentences in client/src      790
 *     ... of which master data alone      390
 *
 * Nobody decided a screen should carry nine paragraphs. Each one was added by
 * somebody being helpful about the field in front of them, and the cost landed
 * on a page none of them was looking at. That is exactly the shape of defect a
 * gate catches and a style guide does not: every individual addition is
 * reasonable and the total is unusable.
 *
 * WHAT IT ENFORCES (FRONTEND_GUIDE.md §3.17):
 *
 *   1. LENGTH    A hint printed on the page may not exceed MAX_VISIBLE chars.
 *                Past that it is an explanation, and explanations go behind
 *                `<Field about>` / `<InfoHint>`, where a user can ask for them.
 *   2. BUDGET    The number of visible prose sites in a file may not grow.
 *                Ratcheted through prose-baseline.json, which only ever
 *                shrinks, exactly like src/services/ai/write-contract-baseline.json.
 *   3. EYEBROW   `.eyebrow` is for a short label. A sentence in one is a
 *                paragraph wearing a caption's clothes.
 *   4. TITLE     English titles and headings are Title Case ("Service Types",
 *                not "Service types"). French keeps sentence case, which is
 *                correct French typography, so only English source is checked.
 *
 * WHY A SCRIPT AND NOT ESLINT. Same reason check-palette.mjs is a script: the
 * thing being measured is the TEXT inside an attribute, often wrapped in tr(),
 * sometimes a template literal, and the budget is a per-file total that no
 * single-node lint rule can see.
 *
 *   node scripts/check-prose.mjs [--app client] [--update-baseline]
 *
 * Exit 0 = the screens are quiet. Exit 1 = a list of what to shorten or hide.
 *
 * ESCAPE HATCH. `@prose:keep <reason>` on the line or the line above exempts a
 * site, and the reason is not optional. A permanent warning a user must read
 * before acting is the legitimate case: those are not hidden behind an ⓘ, they
 * are relocated to the control or to the confirm dialog, and where neither is
 * possible they stay visible and say so here.
 */
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Read a file that may not be there, without asking first.
 *
 * `existsSync(p)` followed by `readFileSync(p)` is a check-then-use: the file
 * can vanish between the two calls, and the read then throws the error the
 * check was meant to prevent (CodeQL js/file-system-race). Attempting the read
 * and handling its failure has no window to race in, and it is one call rather
 * than two.
 */
function readIfPresent(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, "..");
const repoRoot = join(clientRoot, "..");

const argv = process.argv.slice(2);
const appArg = argv.indexOf("--app");
const app = appArg === -1 ? "client" : argv[appArg + 1];
const UPDATE = argv.includes("--update-baseline");
const FIX_TITLES = argv.includes("--fix-titles");
/* `--only <substring>` narrows --fix-titles to the files whose key contains it.
 *
 * It is also what OPTS IN the object-literal bucket. A JSX `title=` that
 * matches CHROME_TITLE is chrome by a well-tested prefix rule and is safe to
 * retitle in bulk. An object-literal `label:` is not: the same property name
 * carries tab labels, select options and column headers (all names, all Title
 * Case) AND error strings like "SMTP login rejected" and password rules like
 * "A number" (all messages, all correctly sentence case). 991 of them are in
 * the tree. Bulk-retitling that set would wreck several hundred messages to fix
 * a few hundred names, so the object bucket moves one area at a time, behind a
 * flag, with the diff read afterwards. §3.18. */
const onlyArg = argv.indexOf("--only");
const ONLY = onlyArg === -1 ? null : argv[onlyArg + 1];
const appRoot = join(repoRoot, app);
const BASELINE = join(here, "prose-baseline.json");

/** Longest hint that may be PRINTED on the page. Roughly one short sentence.
 *  Chosen by reading the hints that survived review: the ones people called
 *  useful were all well under it, and every one anybody called noise was over. */
const MAX_VISIBLE = 80;
/** Longest string allowed inside `.eyebrow`. Two or three words. */
const MAX_EYEBROW = 24;
/** Visible prose sites allowed in a file nobody has had to make an exception
 *  for yet. Three is a screen that explains its hard parts; nine is a wall. */
const DEFAULT_BUDGET = 3;

/* Words English title case leaves lowercase unless they open or close the
   title. Kept deliberately short: the long preposition lists are where title
   casing turns into bikeshedding. */
const MINOR = new Set([
  "a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet",
  "as", "at", "by", "in", "of", "off", "on", "per", "to", "up", "via", "with",
  "from", "into", "over", "vs",
]);

/* Strings that look like titles but are values, glyphs or code. */
/* Not a title: a glyph, an empty string, or a TRANSLATION KEY. `title={t("hr.myPayslips")}`
   passes a dotted key through to i18next, so the English a reader sees lives
   in the catalogue and capitalising the key would only break the lookup. */
const SKIP_TITLE = /^[^A-Za-z]*$|^\s*$|^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/;

/* A dialog title that NAMES AN OPERATION is chrome and is Title Cased: "New
   Service Type", "Edit Expense Rate". A dialog title that SPEAKS to the user
   ("Remove the account manager?") is a message and keeps sentence case, which
   is why this is a prefix list and not a catch-all. */
const CHROME_TITLE = /^(New|Edit|Add|Create|Duplicate|Import|Export|Manage|Assign|Rename|Upload|Download|Choose|Select|Configure) [^.?!]*[^.?!\s]$/;

/**
 * Components whose `title` (or `legend`, or `area`) is STRUCTURALLY chrome.
 *
 * The first version of this rule classified by the STRING: a title was chrome
 * if it began with New, Edit, Add and so on. That was the wrong axis. It let
 * through every section card, every fieldset legend and every breadcrumb,
 * which is where the tenant found them: "Overview & format", "Usage across the
 * system", "Rate history vs XAF", "Hub › Master data". The rule in CLAUDE.md
 * said section and card titles were chrome; the gate never looked at one.
 *
 * A component knows what it is. `<SectionCard title>` is always a heading and
 * `toast.success()` is always a message, whatever words either is given, so
 * the component is the reliable axis and the wording is not. Message-bearing
 * components (EmptyState, Callout, ErrorState, toast) are deliberately absent.
 */
const CHROME_COMPONENT =
  /<(?:PageHeader|Section|SectionCard|Panel|Fieldset|HubCrumb)\b[^>]*?\b(?:title|legend|area)=\{?\s*(?:tr|tv|t)?\(?\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1/;

/* `<PageHeader title>` IS THE PAGE'S <h1>, and it was the hole nobody looked
 * for. §3.18 has named page titles as chrome since it was written, and the
 * tenant's own words were "titles and major lines should be Title Case
 * (Service Types, not Service types)" — a page title is the most prominent
 * chrome on a screen and the first thing he meant. It was unchecked anyway:
 * CHROME_COMPONENT covered the five components added when the rule was
 * widened, PageHeader was not one of them, and the generic `title=` rule only
 * fires on a CHROME_TITLE prefix (New, Edit, Add), which a page title does not
 * carry. 81 screens rendered a sentence-case <h1>.
 *
 * `<Dialog title>` is deliberately NOT here. A dialog names a form ("New
 * Service Type") or speaks to the user ("Remove the account manager?"), and
 * only CHROME_TITLE can tell those apart, so it keeps the prefix rule. That
 * part of §3.18 is still not enforced by component and UI_SIMPLIFICATION.md
 * says so rather than implying the gate covers it. */

/**
 * Chrome DEFINED IN AN OBJECT LITERAL, which neither gate could see.
 *
 * THE HOLE THIS CLOSES. Both gates read JSX attributes (`title=`, `hint=`) and
 * CSS classes (`.micro`, `.hint`). A tab bar, a nav array, a KPI config, a
 * wizard-step list and an option set are none of those:
 *
 *     const TABS = [
 *       { key: "mine", label: "My mailbox", ... },      // a tab bar
 *     ];
 *     const DRILLDOWN = { title: "Revenue · locked invoices" };
 *
 * so ten sentence-case tabs on the Smart Comms setup page survived two sweeps
 * that both reported the area clean on the strength of this gate. The tenant
 * found them by opening the screen. This is the third round that happened in,
 * which is why the properties are read now rather than documented as a gap.
 *
 * WHY A PROPERTY NAME AND NOT A COMPONENT. Everywhere else this gate classifies
 * by component, because a component knows what it is and the wording does not.
 * An object literal has no component: it is consumed somewhere else entirely,
 * often in another file. What it does have is a property name, and `label`,
 * `title` and `tabLabel` are the three the codebase uses for "the words a
 * person reads for this thing". `text`, `name` and `description` are
 * deliberately absent: `badge.text` is a count ("3 locked invoices"), `name` is
 * usually a record's own data, and `description` lives behind the ⓘ by
 * convention and costs the reader nothing.
 *
 * MESSAGES ARE STRUCTURALLY EXCLUDED. An `empty: {}` / `emptyState: {}` block
 * is an <EmptyState>'s props, and <EmptyState> is a message component wherever
 * it renders, so the whole block is skipped by indent rather than by guessing
 * at its wording. Everything else that is a message rather than a name carries
 * `@prose:keep <reason>`, which is where the clause-shaped options live (see
 * §3.18).
 */
const OBJ_CHROME = /\b(?:label|title|tabLabel)\s*:\s*(?:(?:tr|tv|t|trc)\(\s*)?(["'])((?:(?!\1)[^\\]|\\.)*)\1/g;

function files() {
  const out = execFileSync(
    "git",
    ["ls-files", "src/**/*.tsx", "src/**/*.ts", "app/**/*.tsx", "components/**/*.tsx"],
    { cwd: appRoot, encoding: "utf8" },
  );
  return out
    .split("\n")
    .filter(Boolean)
    .filter((f) => !/\.(test|spec)\.|\.stories\./.test(f));
}

/**
 * The brace-balanced text of a `{...}` attribute value opening at `from`.
 *
 * `title={title || (draft ? tr("Continue this draft") : tr("New message"))}`
 * is one expression spread over as much of the line as it needs, and the first
 * `}` in it belongs to the inner `tr()` call's argument list in the general
 * case. Counting braces is the only way to know where the attribute ends; a
 * non-nesting `\{[^}]*\}` stops in the middle and takes half a ternary with it.
 */
function attrExpr(lines, i, from) {
  let depth = 0;
  let out = "";
  for (let j = i; j < Math.min(i + 5, lines.length); j++) {
    const line = j === i ? lines[j].slice(from) : lines[j];
    for (const ch of line) {
      if (ch === "{") depth++;
      if (depth > 0) out += ch;
      if (ch === "}") {
        depth--;
        if (depth === 0) return out;
      }
    }
    if (depth === 0) break;
    out += " ";
  }
  return out;
}

/**
 * EVERY string literal a computed attribute can render, `tr()`-wrapped or bare.
 *
 * THE HOLE THIS CLOSES. `literal()` below expects the attribute to OPEN with a
 * quote or a `tr(`. Anything else returns null and the site was dropped with no
 * warning at all, so
 *
 *     title={tr("New message")}                                    was checked
 *     title={title || (draft ? tr("Continue this draft")
 *                            : tr("New message"))}                 was NOT
 *
 * and the mail composer's dialog read "New message" through two sweeps that
 * both reported the area clean. A computed title renders one of its branches,
 * so every branch is a title and every branch is checked. Tested against
 * CHROME_TITLE individually, which is what keeps this conservative: "New
 * message" is chrome by its prefix and is flagged, "Continue this draft" is
 * not and is left alone.
 */
function literals(expr) {
  const out = [];
  const re = /(["'])((?:(?!\1)[^\\]|\\.)*)\1/g;
  let m;
  while ((m = re.exec(expr)) !== null) {
    const text = m[2].replace(/\\(["'])/g, "$1");
    if (text) out.push(text);
  }
  return out;
}

/** `tr("x")`, `tv("x", …)`, `"x"`, `{"x"}` all yield x. Template literals and
 *  anything with an interpolation are skipped: their rendered length is not
 *  knowable here and guessing produces false failures. */
function literal(raw) {
  if (!raw) return null;
  const m = raw.match(/^\s*\{?\s*(?:tr|tv|t)\(\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1/)
    || raw.match(/^\s*\{?\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1/);
  if (!m) return null;
  return m[2].replace(/\\(["'])/g, "$1");
}

function exempt(lines, i) {
  const here = lines[i] || "";
  const above = lines[i - 1] || "";
  const re = /@prose:keep\s+\S+/;
  return re.test(here) || re.test(above);
}

function isTitleCase(s) {
  /* The apostrophe stays INSIDE the word: stripping it turned "Person's" into
     "Person" + "s", and a bare lowercase "s" is not a minor word, so a
     correctly cased title failed the check. */
  const words = s
    .replace(/[(),:;?!."“”]/g, " ")
    .split(/[\s/]+/)
    .filter(Boolean);
  if (!words.length) return true;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!/[a-z]/i.test(w)) continue;          // numbers, glyphs, acronyms
    if (w === w.toUpperCase()) continue;       // XAF, OHADA, B/L
    if (/^[a-z]+\d/.test(w)) continue;         // v1, h2
    const first = i === 0 || i === words.length - 1;
    const minor = MINOR.has(w.toLowerCase());
    const capped = w[0] === w[0].toUpperCase();
    if (!capped && (first || !minor)) return false;
  }
  return true;
}

/** The repair isTitleCase() asks for. Minor words stay lowercase unless they
 *  open or close the title; anything already carrying an interior capital
 *  (acronyms, "PraxisAI", "B/L") is left exactly as the author wrote it. */
function titleCase(s) {
  const parts = s.split(/(\s+|\/)/);
  const words = parts.filter((x) => /\S/.test(x) && x !== "/");
  let seen = 0;
  return parts
    .map((part) => {
      if (!/\S/.test(part) || part === "/") return part;
      seen++;
      const lead = part.match(/^[^A-Za-z]*/)[0];
      const core = part.slice(lead.length);
      const body = core.replace(/[^A-Za-z]*$/, "");
      const tail = core.slice(body.length);
      if (!body) return part;
      if (body !== body.toLowerCase()) return part;      // already capitalised or an acronym
      const first = seen === 1 || seen === words.length;
      const out = MINOR.has(body.toLowerCase()) && !first
        ? body.toLowerCase()
        : body[0].toUpperCase() + body.slice(1);
      return lead + out + tail;
    })
    .join("");
}

/** Classes that render a paragraph of helper text to the reader. */
const PROSE_CLASS =
  /<(?:p|span|small|li|dd)\b[^>]*className="[^"]*(?:\bmicro\b|\bhint\b|text-xs[^"]*text-muted-foreground|text-sm[^"]*text-muted-foreground)[^"]*"/;

/**
 * The visible text of the element opening at `lines[i]`, joined across however
 * many lines the formatter spread it over.
 *
 * Returns null when there is no prose: nested markup, a bare interpolation
 * (`{children}`, `{row.note}`) whose length is not knowable here, or an empty
 * element. Guessing at those produces false failures, and a gate people have
 * to argue with is a gate they turn off.
 */
function elementText(lines, i, startCol) {
  let blob = lines[i].slice(startCol);
  for (let j = i; j < Math.min(i + 14, lines.length); j++) {
    if (j > i) blob += " " + lines[j];
    if (/<\/(?:p|span|div|li|dd|small)>/.test(lines[j])) break;
  }
  /* Find the end of the OPENING TAG, not the first ">" in the blob. An
     attribute can hold an arrow function (`onClick={() => save()}`), and its
     ">" came first, so a naive strip left half the attributes in the text and
     reported `className=rounded-md px-2 py-1 ...` as a 115-character hint. */
  let text = blob
    .replace(/=>/g, "\u0000")     // hide arrows from the tag-end search
    .replace(/^[^>]*>/, "")        // past the opening tag
    .replace(/\u0000/g, "=>")
    .replace(/<[^>]*>/g, " ");     // any nested tags

  /* Strip JSX expressions until nothing changes: a multi-line ternary nests
     braces, and one pass of a non-nesting pattern leaves the inner halves
     behind as if they were prose. */
  for (let pass = 0; pass < 6; pass++) {
    const next = text.replace(/\{[^{}]*\}/g, " ");
    if (next === text) break;
    text = next;
  }

  /* A brace still standing means the content is computed, so its rendered
     length is not knowable from the source. Measuring it anyway is how a gate
     starts reporting things nobody can act on. */
  if (/[{}]/.test(text)) return null;

  text = text.replace(/["'`]/g, "").replace(/\s+/g, " ").trim();
  return text.length ? text : null;
}

const problems = { long: [], eyebrow: [], title: [], objTitle: [] };
const counts = {};

for (const f of files()) {
  const abs = join(appRoot, f);
  const src = readFileSync(abs, "utf8");
  const lines = src.split("\n");
  const key = `${app}/${f}`;
  let visible = 0;
  /* Object-literal scan state, per file: whether we are inside a block comment
     (a JSDoc example of a tab array is not a tab array) and, when inside an
     `empty: {}` block, the indent that block opened at. */
  let inBlockComment = false;
  let emptyIndent = null;

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (inBlockComment) {
      if (trimmed.includes("*/")) inBlockComment = false;
    } else if (trimmed.startsWith("/*") && !trimmed.includes("*/")) {
      inBlockComment = true;
    }
    const indent = line.match(/^\s*/)[0].length;
    if (emptyIndent !== null && indent <= emptyIndent) emptyIndent = null;
    if (/^\s*(?:empty|emptyState)\s*:\s*\{/.test(line)) emptyIndent = indent;

    if (exempt(lines, i)) return;

    /* 1 + 2. Visible helper text.

       `hint` is PRINTED under its control, so it is what this measures, along
       with a paragraph carrying .micro or .hint.

       `description` is deliberately NOT counted any more. Every component that
       takes one now renders it behind an ⓘ (Dialog, PageHeader, entity 360's
       Section, Chart), so a long description costs the reader nothing. Counting
       it made the gate report text that is no longer on the screen, which is
       worse than not measuring: it would have had somebody shortening copy to
       satisfy a number that no user can see. The rule the codebase now holds is
       one line: `description` is explanation and lives behind the ⓘ, `hint` is
       visible and is capped. */
    const hint = line.match(/\bhint=(\{?\s*(?:tr|tv|t)?\(?\s*["'][^]*)/);
    if (hint) {
      const text = literal(hint[1]);
      if (text !== null) {
        visible++;
        if (text.length > MAX_VISIBLE) {
          problems.long.push({ key, line: i + 1, len: text.length, text });
        }
      }
    }
    /* A PARAGRAPH, however it is spelled and however it is wrapped.
     *
     * This used to read only the rest of the SAME LINE, and only when the text
     * was a quoted string. Both assumptions were wrong, and wrong in the
     * direction that hid the worst offenders:
     *
     *   <p className="mb-2 micro text-muted-foreground">
     *     Add each compliance document and upload its file - a PDF or a clear
     *     photo. No file yet? ...
     *
     * is bare JSX text starting on the NEXT line, so the gate saw nothing and
     * five printed lines sailed through. The longer the sentence, the more
     * likely the formatter wrapped it, so the gate was blindest exactly where
     * the problem was worst. 147 paragraphs over the cap were invisible.
     *
     * The class list was too narrow too: `.micro` and `.hint` were checked
     * while 835 `text-xs/text-sm text-muted-foreground` paragraphs, which look
     * identical on screen, were not checked at all.
     */
    const para = line.match(PROSE_CLASS);
    if (para) {
      const text = elementText(lines, i, para.index + para[0].length);
      /* A SENTENCE, not a label. `.micro` is also the class on "Account
         Manager" and "Also Notify", which are two-word captions over a value
         and are not what this gate is about. Counting those made a screen look
         noisier the more it was cleaned up. */
      if (text !== null && text.length > MAX_EYEBROW) {
        visible++;
        if (text.length > MAX_VISIBLE) {
          problems.long.push({ key, line: i + 1, len: text.length, text });
        }
      }
    }

    /* 3. A sentence wearing an eyebrow. */
    const eye = line.match(/className="(?:[^"]*\s)?eyebrow(?:\s[^"]*)?"/);
    if (eye) {
      const text = literal(line.slice(eye.index + eye[0].length).replace(/^[^>]*>/, ""));
      if (text !== null && text.length > MAX_EYEBROW) {
        problems.eyebrow.push({ key, line: i + 1, text });
      }
    }

    /* 4. Title Case, but only on CHROME.
       A message is sentence case and must stay that way: "Could not save it"
       is not improved by becoming "Could Not Save It". So the rule applies to
       the labels that name things (dialog titles that open a form, page
       headings) and, below this loop, to the navigation and the screen
       registry. Everything else is prose and is left alone. */
    const title = line.match(/\btitle=(\{?\s*(?:tr|tv|t)?\(?\s*["'][^]*)/);
    if (title) {
      const text = literal(title[1]);
      if (text && CHROME_TITLE.test(text) && !isTitleCase(text)) {
        problems.title.push({ key, line: i + 1, text, abs });
      }
    }
    /* A COMPUTED title, whose branches literal() cannot see. See literals(). */
    const computed = line.indexOf("title={");
    if (computed !== -1 && literal(line.slice(computed + 6)) === null) {
      const expr = attrExpr(lines, i, computed + 6);
      for (const text of literals(expr)) {
        if (CHROME_TITLE.test(text) && !isTitleCase(text)) {
          problems.title.push({ key, line: i + 1, text, abs });
        }
      }
    }
    /* A chrome component's own title, whatever words it carries. Matched
       across the opening tag rather than one line, because the title of a
       section with three other props is rarely on the same line as its name. */
    const openTag = lines.slice(i, Math.min(i + 6, lines.length)).join(" ");
    const chrome = openTag.match(CHROME_COMPONENT);
    if (chrome && /^<(?:PageHeader|Section|SectionCard|Panel|Fieldset|HubCrumb)\b/.test(line.trim())) {
      const text = chrome[2];
      if (!SKIP_TITLE.test(text) && text.length <= 60 && !isTitleCase(text)) {
        problems.title.push({ key, line: i + 1, text, abs });
      }
    }
    const h = line.match(/<h1[^>]*>\s*\{?\s*(?:tr|tv|t)?\(?\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1/);
    if (h && !SKIP_TITLE.test(h[2]) && h[2].length <= 60 && !isTitleCase(h[2])) {
      problems.title.push({ key, line: i + 1, text: h[2], abs });
    }

    /* 5. Chrome defined in an object literal. See OBJ_CHROME. */
    if (!inBlockComment && emptyIndent === null && !trimmed.startsWith("//") && !trimmed.startsWith("*")) {
      OBJ_CHROME.lastIndex = 0;
      let m;
      while ((m = OBJ_CHROME.exec(line)) !== null) {
        const text = m[2].replace(/\\(["'])/g, "$1");
        if (SKIP_TITLE.test(text) || text.length > 60) continue;
        if (!/[A-Za-z]{2}/.test(text)) continue;
        if (isTitleCase(text)) continue;
        problems.objTitle.push({ key, line: i + 1, text, abs });
      }
    }
  });

  if (visible) counts[key] = visible;
}

/*
 * THE NAVIGATION AND THE SCREEN REGISTRY.
 *
 * These two files ARE the app's chrome: `areas.ts` is every ribbon area and
 * hub section, `screen-registry.json` is every page title that ⌘K and the
 * breadcrumbs render. The tenant's examples were all from here ("Corporate
 * entities", "Expense rates"), so this is where the rule earns its keep.
 *
 * `title_fr` and any other French field is deliberately NOT checked. Title
 * case is an English convention; French takes sentence case ("Types de
 * service"), and capitalising every word there would read as broken to the
 * francophone half of this product's users.
 */
/* BOTH copies of the navigation. areas.ts drives the ribbon and the rail;
   nav-model.ts drives the shell's drawer, and it holds the SAME labels again.
   Only areas.ts was checked at first, so the drawer kept the old sentence-case
   names after the ribbon was retitled, and the two disagreed in the same
   build. If a third copy appears it goes in this list. */
for (const rel of ["src/app/layout/areas.ts", "src/app/layout/nav-model.ts"]) {
  const AREAS = join(appRoot, rel);
  const areasSrc = readIfPresent(AREAS);
  if (areasSrc === null) continue;
  areasSrc.split("\n").forEach((line, i) => {
    const m = line.match(/\blabel:\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1/);
    if (m && !SKIP_TITLE.test(m[2]) && !isTitleCase(m[2])) {
      problems.title.push({ key: `${app}/${rel}`, line: i + 1, text: m[2], abs: AREAS });
    }
  });
}
const REGISTRY = join(appRoot, "src/app/screen-registry.json");
const registrySrc = readIfPresent(REGISTRY);
if (registrySrc !== null) {
  registrySrc.split("\n").forEach((line, i) => {
    const m = line.match(/"title":\s*"((?:[^"\\]|\\.)*)"/);
    if (m && !SKIP_TITLE.test(m[1]) && !isTitleCase(m[1])) {
      problems.title.push({ key: `${app}/src/app/screen-registry.json`, line: i + 1, text: m[1], abs: REGISTRY });
    }
  });
}

if (FIX_TITLES) {
  /*
   * Rewrites the English chrome label AND moves its dictionary key with it.
   *
   * This second half is the part that is easy to forget and expensive to miss:
   * `tr()` and `navT()` look a translation up BY ITS ENGLISH TEXT, and a miss
   * falls back to English silently. So retitling "Quote requests" without
   * moving the key would leave the French build rendering English on that one
   * label, with nothing failing anywhere. The key moves on both sides; only the
   * English VALUE is retitled, because French does not take title case.
   */
  const renames = new Map();
  const byFile = new Map();
  const fixable = ONLY
    ? [...problems.title, ...problems.objTitle].filter((x) => x.key.includes(ONLY))
    : problems.title;
  for (const p of fixable) {
    const next = titleCase(p.text);
    if (next === p.text) continue;
    renames.set(p.text, next);
    if (!byFile.has(p.abs)) byFile.set(p.abs, []);
    byFile.get(p.abs).push({ ...p, next });
  }

  for (const [abs, list] of byFile) {
    const lines = readFileSync(abs, "utf8").split("\n");
    for (const p of list) {
      /* The title is not always on the line the problem was recorded at: a
         <SectionCard> with four props puts its `title` two lines below its
         name, and that is where the opening tag was matched from. Search the
         tag's span rather than a single line. */
      let done = false;
      for (let i = p.line - 1; i < Math.min(p.line + 5, lines.length) && !done; i++) {
        for (const q of ['"', "'"]) {
          const from = q + p.text + q;
          if (lines[i].includes(from)) {
            lines[i] = lines[i].replace(from, q + p.next + q);
            done = true;
            break;
          }
        }
      }
    }
    writeFileSync(abs, lines.join("\n"));
  }

  /* WHICH KEYS MAY MOVE.
   *
   * A dictionary key is the English text itself, and the same English can be
   * rendered from several places for different reasons: "Yard noise filter"
   * is a section title on the calls page AND a checkbox label in the call
   * overlay. Retitling the section and moving the key took the French away
   * from the checkbox, silently, because tr() falls back to English on a miss.
   *
   * So a key only moves when the OLD spelling has left the source entirely.
   * Where it has not, the new key is ADDED and the old one stays, and both
   * call sites keep their translation.
   */
  const sourceBlob = files()
    .map((rel) => readIfPresent(join(appRoot, rel)) ?? "")
    .join("\n");

  const dictPath = join(appRoot, "src/lib/i18n-dict.ts");
  const dictSrc = readIfPresent(dictPath);
  if (dictSrc !== null) {
    let dict = dictSrc;
    const split = dict.indexOf("export const fr");
    let en = split === -1 ? dict : dict.slice(0, split);
    let fr = split === -1 ? "" : dict.slice(split);
    for (const [from, to] of renames) {
      const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (sourceBlob.includes(`"${from}"`)) {
        /* STILL RENDERED UNDER ITS OLD SPELLING, so the key may not move. The
         * new one is ADDED beside it instead, carrying the same translation,
         * and both call sites keep their French.
         *
         * Skipping outright is what this did before, and it was a silent
         * untranslate: "New message" is a key with a real French value, it
         * survives in a CODE COMMENT and a scaffold spec (neither of which
         * renders anything), so the key was held back while the composer's
         * dialog had already become "New Message" — a spelling with no key at
         * all, which tr() answers with the English. Seven of the 66 retitles in
         * this round landed that way. Adding is safe where moving is not:
         * a key nothing reads is dead weight, a key something reads is a
         * translation. */
        const frVal = fr.match(new RegExp(`"${esc}":\\s*"((?:[^"\\\\]|\\\\.)*)"`));
        const escTo = to.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (frVal && !new RegExp(`"${escTo}":`).test(fr)) {
          fr = fr.replace(frVal[0], `${frVal[0]},\n    "${to}": "${frVal[1]}"`);
        }
        const enVal = en.match(new RegExp(`"${esc}":\\s*"(?:[^"\\\\]|\\\\.)*"`));
        if (enVal && !new RegExp(`"${escTo}":`).test(en)) {
          en = en.replace(enVal[0], `${enVal[0]},\n    "${to}": "${to}"`);
        }
        continue;
      }
      // English: move the key and retitle the value, but only where the value
      // is the identity string. A hand-written English override stays.
      en = en.replace(
        new RegExp(`"${esc}":\\s*"${esc}"`, "g"),
        `"${to}": "${to}"`,
      );
      en = en.replace(new RegExp(`"${esc}":`, "g"), `"${to}":`);
      // French: the key moves, the translation does not.
      fr = fr.replace(new RegExp(`"${esc}":`, "g"), `"${to}":`);
    }
    writeFileSync(dictPath, en + fr);
  }

  console.log(`--fix-titles: retitled ${renames.size} chrome labels across ${byFile.size} files, dictionary keys moved.`);
  process.exit(0);
}

const baselineSrc = readIfPresent(BASELINE);
const baseline = baselineSrc === null
  ? { budget: {}, longCopy: {}, objTitle: {} }
  : JSON.parse(baselineSrc);

if (UPDATE) {
  const longCopy = {};
  for (const p of problems.long) longCopy[p.key] = (longCopy[p.key] || 0) + 1;
  /* OBJECT-LITERAL CHROME IS RATCHETED AND THE OTHER TITLE RULES ARE NOT.
   *
   * A JSX `title=` has never had a baseline: it is a hard failure, and widening
   * the extractor to read a computed one (see literals()) surfaced 71 real
   * sentence-case dialog titles that were all fixed in the same change, so it
   * keeps that contract.
   *
   * The object-literal rule could not land the same way. It reads every option
   * set, tab bar and column list in three apps, which is 955 sites, and holding
   * the whole tree to it in one commit is how a gate gets reverted. So it
   * ratchets, exactly like budget and longCopy: an area is swept to zero and
   * can never regrow, and new code in a file nobody has excused is held to the
   * rule immediately. */
  const objTitle = {};
  for (const p of problems.objTitle) objTitle[p.key] = (objTitle[p.key] || 0) + 1;
  writeFileSync(
    BASELINE,
    `${JSON.stringify({ budget: counts, longCopy, objTitle }, null, 2)}\n`,
  );
  console.log(`prose-baseline.json written: ${Object.keys(counts).length} files with visible prose, ${problems.long.length} long strings, ${problems.objTitle.length} object-literal chrome labels.`);
  process.exit(0);
}

/* The ratchet. A file may always get quieter and may never get louder. A file
   nobody has excused yet gets DEFAULT_BUDGET and no long copy at all. */
const fails = [];
for (const [key, n] of Object.entries(counts)) {
  const allowed = baseline.budget?.[key] ?? DEFAULT_BUDGET;
  if (n > allowed) {
    fails.push(`  ${key}: ${n} visible hints, budget ${allowed}`);
  }
}
const longByFile = {};
for (const p of problems.long) longByFile[p.key] = (longByFile[p.key] || 0) + 1;
const longFails = [];
for (const [key, n] of Object.entries(longByFile)) {
  const allowed = baseline.longCopy?.[key] ?? 0;
  if (n > allowed) {
    longFails.push({ key, n, allowed });
  }
}

const objByFile = {};
for (const p of problems.objTitle) objByFile[p.key] = (objByFile[p.key] || 0) + 1;
const objFails = [];
for (const [key, n] of Object.entries(objByFile)) {
  const allowed = baseline.objTitle?.[key] ?? 0;
  if (n > allowed) objFails.push({ key, n, allowed });
}

let bad = 0;
if (longFails.length) {
  bad++;
  console.error(`\nVisible hints longer than ${MAX_VISIBLE} characters (move to <Field about> or <InfoHint>):\n`);
  for (const { key, n, allowed } of longFails) {
    console.error(`  ${key}: ${n} long (allowed ${allowed})`);
    for (const p of problems.long.filter((x) => x.key === key).slice(0, 4)) {
      console.error(`      L${p.line} (${p.len}) ${p.text.slice(0, 96)}`);
    }
  }
}
if (fails.length) {
  bad++;
  console.error(`\nToo much text printed on the page:\n${fails.join("\n")}`);
  console.error(`\n  Shorten it, fold it into the control, or move it behind <Field about>.`);
}
if (problems.eyebrow.length) {
  bad++;
  console.error(`\nA sentence in an .eyebrow (that class is for a two-word label):\n`);
  for (const p of problems.eyebrow) console.error(`  ${p.key}:${p.line}  ${p.text.slice(0, 80)}`);
}
if (problems.title.length) {
  bad++;
  console.error(`\nEnglish titles are Title Case ("Service Types", not "Service types"):\n`);
  for (const p of problems.title.slice(0, 40)) console.error(`  ${p.key}:${p.line}  ${p.text}`);
  if (problems.title.length > 40) console.error(`  ... and ${problems.title.length - 40} more`);
}
if (objFails.length) {
  bad++;
  console.error(`\nChrome defined in an object literal is Title Case too (tab, option, column, pill and CTA labels):\n`);
  for (const { key, n, allowed } of objFails) {
    console.error(`  ${key}: ${n} sentence-case (allowed ${allowed})`);
    for (const p of problems.objTitle.filter((x) => x.key === key).slice(0, 4)) {
      console.error(`      L${p.line}  ${p.text}`);
    }
  }
  console.error(`\n  Title Case a name; keep a clause and mark it @prose:keep <reason>. §3.18.`);
}

if (bad) {
  console.error(`\nFRONTEND_GUIDE.md §3.17 has the ladder. Exempt a line with @prose:keep <reason>.\n`);
  process.exit(1);
}
console.log(`check:prose (${app}) clean: ${Object.keys(counts).length} files carry visible prose, all within budget.`);
