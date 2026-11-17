#!/usr/bin/env node
/**
 * A LINK INTO ANOTHER PART OF THE PRODUCT IS OFFERED ONLY TO SOMEONE WHO CAN
 * OPEN IT.
 *
 *     node scripts/check-access-links.mjs          # the gate
 *     node scripts/check-access-links.mjs --list   # every cross-area link found
 *
 * ── WHAT IT CATCHES ─────────────────────────────────────────────────────────
 *
 * The ribbon, the rail, the ⌘K palette, the Settings cards and the Control
 * Tower launcher all ask `canOpenRoute` before they offer a destination. The
 * links INSIDE screens did not: "Open client" on a sale, "Open their account"
 * on an employee, "New invoice" on the Control Tower. An access audit on
 * 17 Nov 2026 found 44 of them, 37 unguarded, each one a button that a role
 * without the target module could see and that ended in "… is not part of
 * your access". The tenant's answer was: hide it.
 *
 * So: a file under `src/features/<area>/` that links, by a literal path, into a
 * route gated by a module and belonging to a DIFFERENT area, must ask first.
 * Shared components (`src/components`) and the shell (`src/app`) belong to no
 * area, so there every gated destination must ask.
 *
 * ── WHAT COUNTS AS ASKING ───────────────────────────────────────────────────
 *
 * Any of these, in the same file:
 *
 *   canOpen("/master/clients")        a `useCanOpenRoute()` predicate called on
 *                                     the target or on a prefix of it
 *   <AccessLink to="/master/clients"> the component that asks for you; so does
 *                                     `<HubCrumb>`, the breadcrumb
 *   canOpen(card.to)                  for a destination held as DATA (`to:`,
 *                                     `href=`, `route=` on a card list or a
 *                                     local link helper): the file asks about a
 *                                     variable, which is how a list is filtered
 *   // @access:open <reason>          on the line or the one above, for a link
 *                                     that is deliberately always offered. The
 *                                     reason is required.
 *
 * ── ITS LIMITS, SAID PLAINLY ────────────────────────────────────────────────
 *
 * It reads literal paths. A destination built entirely at run time (the
 * server's `link_url` on a notification, a route held in a variable) is
 * invisible to it. It compares AREAS, so a link between two modules of the
 * same area (HR to Payroll) is not flagged. And it checks that the file asks
 * about the right path, not that the answer is wired to the right element: a
 * `canOpen` call that guards nothing would pass. It is a floor, not a proof.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const client = join(here, "..");
const src = join(client, "src");
const features = join(src, "features");
const shared = [join(src, "components"), join(src, "app")];

const registry = JSON.parse(
  readFileSync(join(src, "app", "screen-registry.json"), "utf8"),
);
const screens = (registry.screens || []).filter((s) => typeof s.route === "string");
const byLength = [...screens].sort((a, b) => b.route.length - a.route.length);

/** The areas' base paths, read off areas.ts so a new area needs no edit here. */
const areasSrc = readFileSync(join(src, "app", "layout", "areas.ts"), "utf8");
const areaBases = [...areasSrc.matchAll(/basePath:\s*"(\/[^"]*)"/g)].map((m) => m[1]);

/** Folders whose name is not their area's first path segment. */
const FOLDER_BASE = {
  masterdata: "/master",
  // Screens that belong to no one area: every gated destination is "elsewhere".
  dashboard: null,
  help: null,
  access: null,
  auth: null,
  landing: null,
  public: null,
  legal: null,
  portal: null,
  scaffold: null,
};

const clean = (p) => p.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
const firstSegment = (p) => "/" + (clean(p).split("/")[1] || "");

/** The module that gates a path, or null when nothing does. */
function gateFor(path) {
  const p = clean(path);
  if (p === "/") return null; // home: everybody's
  const hit = byLength.find(
    (s) => s.route !== "/" && (p === s.route || p.startsWith(s.route + "/")),
  );
  if (hit) return hit.module_key || null;
  // A hub landing page is not registered; it is gated by its sections.
  if (areaBases.includes(p)) {
    const section = screens.find((s) => s.route.startsWith(p + "/") && s.module_key);
    return section ? section.module_key : null;
  }
  return null;
}

/** Own-account pages every signed-in person may open (lib/route-access.ts). */
const OWN_ACCOUNT = ["/security/my-security", "/notifications"];
const isOwn = (p) => OWN_ACCOUNT.some((o) => clean(p) === o || clean(p).startsWith(o + "/"));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !/\.(test|spec|stories)\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * Every literal destination in a file: `navigate("/x")`, `to="/x"`,
 * `to: "/x"`, `href="/x"`, and the static head of a template literal
 * (`` `/operations/files/${id}` `` reads as `/operations/files`).
 */
const LINK = /(navigate\(\s*|\bto=\{?\s*|\bto:\s*|\bhref=\{?\s*|\broute=\{?\s*|\broute:\s*)(["'`])(\/[^"'`]*)\2?/g;

function linksIn(text) {
  const out = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(LINK)) {
      const how = m[1].trim();
      // A destination handed to something else as data, as opposed to a
      // `navigate()` call or a `<Link to>` written out in place.
      const asData = !/^navigate\(/.test(how) && !/<Link\b[^>]*$/.test(line.slice(0, m.index));
      // The components that ask for themselves.
      if (/<(?:AccessLink|HubCrumb)\b[^>]*$/.test(line.slice(0, m.index))) continue;
      let target = m[3];
      const cut = target.indexOf("${");
      if (cut >= 0) target = target.slice(0, cut);
      target = clean(target);
      if (target.length > 1) out.push({ line: i + 1, target, asData, text: line, above: lines[i - 1] || "" });
    }
  });
  return out;
}

/** Paths the file asks about: `canOpen("/x")`, `canOpenRoute(…, "/x")`, `<AccessLink to="/x">`. */
function askedIn(text) {
  const asked = [];
  for (const m of text.matchAll(/canOpen(?:Route)?\(\s*(?:[A-Za-z_.]+\s*,\s*)?(["'`])(\/[^"'`]*)\1?/g)) {
    const cut = m[2].indexOf("${");
    asked.push(clean(cut >= 0 ? m[2].slice(0, cut) : m[2]));
  }
  for (const m of text.matchAll(/<AccessLink\b[^>]*?\bto=\{?\s*(["'`])(\/[^"'`]*)\1?/gs)) {
    const cut = m[2].indexOf("${");
    asked.push(clean(cut >= 0 ? m[2].slice(0, cut) : m[2]));
  }
  return asked;
}

const MARKER = /@access:open\s+\S/;

const found = [];
/** The surfaces that ARE the navigation, or that own the access rule itself.
 *  They are filtered by `buildRibbon` / `canOpenRoute` as a whole and have
 *  their own tests; reading them link by link would only produce noise. */
const NAVIGATION = [
  "src/app/app.tsx",
  "src/app/layout/areas.ts",
  "src/app/layout/nav-model.ts",
  "src/app/layout/ribbon-model.ts",
  "src/components/command-palette.tsx",
];

const files = [
  ...walk(features).map((f) => ({ file: f, inFeatures: true })),
  // Shared components and the shell belong to no area, so for them every gated
  // destination is "somewhere else".
  ...shared.flatMap((d) => walk(d)).map((f) => ({ file: f, inFeatures: false })),
];

for (const { file, inFeatures } of files) {
  const rel = relative(client, file).split(sep).join("/");
  if (NAVIGATION.includes(rel)) continue;
  const folder = inFeatures ? relative(features, file).split(sep)[0] : null;
  const home = !inFeatures ? null : folder in FOLDER_BASE ? FOLDER_BASE[folder] : "/" + folder;
  const text = readFileSync(file, "utf8");
  const asked = askedIn(text);
  // `canOpen(card.to)`, `canOpen(href)`: the file asks about a variable.
  const asksVariable =
    /canOpen\(\s*[A-Za-z_][\w.]*\s*[),]/.test(text) ||
    // `<AccessLink to={card.to}>`: the component asks about whatever it is given.
    /<AccessLink\b[^>]*?\bto=\{\s*[A-Za-z_][\w.]*\s*\}/s.test(text);

  for (const link of linksIn(text)) {
    if (isOwn(link.target)) continue;
    const gate = gateFor(link.target);
    if (!gate) continue; // nothing gates it
    if (home && firstSegment(link.target) === home) continue; // same area
    const guarded =
      asked.some((a) => link.target === a || link.target.startsWith(a + "/") || a.startsWith(link.target + "/")) ||
      (link.asData && asksVariable) ||
      MARKER.test(link.text) ||
      MARKER.test(link.above);
    found.push({ file: rel, ...link, gate, guarded });
  }
}

const list = process.argv.includes("--list");
const open = found.filter((f) => !f.guarded);

if (list) {
  for (const f of found)
    console.log(`${f.guarded ? "ok  " : "OPEN"}  ${f.file}:${f.line}  →  ${f.target}  (${f.gate})`);
  console.log(`\n${found.length} cross-area links, ${found.length - open.length} guarded, ${open.length} open.`);
  process.exit(0);
}

if (open.length) {
  console.error(
    `\n✗ ${open.length} link(s) into another area are offered without asking whether the reader can open them:\n`,
  );
  for (const f of open) console.error(`    ${f.file}:${f.line}  →  ${f.target}  (${f.gate})`);
  console.error(
    `\n  Ask first: const canOpen = useCanOpenRoute(); … {canOpen("${open[0].target}") && <…>},` +
      `\n  or use <AccessLink to="…">, which draws nothing when the reader cannot open it.` +
      `\n  A link that is deliberately always offered takes // @access:open <reason>.` +
      `\n  doc/FRONTEND_GUIDE.md §3.19.\n`,
  );
  process.exit(1);
}

console.log(
  `check:access clean: ${found.length} links into another area, every one asks before it is offered.`,
);
