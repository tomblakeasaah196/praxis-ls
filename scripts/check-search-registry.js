#!/usr/bin/env node
/**
 * Search gate — every page, every tab, every record type is findable, or it
 * does not merge (tenant review, meeting 6, PR 4 — owner decision G5: "Every
 * single one").
 *
 * ── WHY A GATE ──────────────────────────────────────────────────────────────
 *
 * ⌘K reads `client/src/app/screen-registry.json` for pages, hubs and tabs, and
 * `src/modules/**\/<module>.search.js` for records. Before this, the registry
 * was a file a new route was SUPPOSED to be added to, and nothing checked:
 * `tests/unit/ai-readiness.test.js` validated the shape of what was there and
 * could not see what was missing. A screen nobody registered is a screen ⌘K
 * cannot find, the ribbon cannot permission-filter (route-access.ts treats an
 * unregistered route as ungated) and the AI cannot cite — three silent
 * failures from one forgotten line. So the registry is now checked against the
 * code, in both directions.
 *
 * ── WHAT FAILS ──────────────────────────────────────────────────────────────
 *
 *   1. ROUTES. A `<Route path>` in client/src/app/app.tsx with no registry
 *      entry — a screen, a hub, or a redirect. A `<base>/:section` route is
 *      covered by its hub; its sections are checked by rule 2.
 *   2. HUB SECTIONS. A section in client/src/app/layout/areas.ts whose route is
 *      not a registered screen.
 *   3. TABS. A URL-addressable tab — any value a `useUrlTab(...)` call can
 *      take — with no `tabs[]` entry for its file, and an entry naming a tab
 *      the file no longer has.
 *   4. RECORDS. A module under src/modules with records (a controller and a
 *      repo) and neither a `<module>.search.js` provider nor a
 *      `// search:none <reason>` in its controller. The reason is required,
 *      exactly as for `// ai:none` (scripts/check-ai-manifest-coverage.js).
 *   5. STALE ENTRIES. A registry screen whose route the app no longer serves,
 *      a redirect whose target is not registered, a tab entry whose file is
 *      gone, a tab naming a record type no provider declares, a provider whose
 *      landing route is not a registered screen.
 *   6. FRENCH. Every screen, hub and tab carries `title_fr` — ⌘K finds pages
 *      in both languages, and a page with only an English title is a page a
 *      French desk cannot find by its own word.
 *
 * Making it the path of least resistance: `npm run new:screen --prefix client`
 * prints the registry entry with the rest of the scaffold.
 *
 *   node scripts/check-search-registry.js          # the gate
 *   node scripts/check-search-registry.js --list   # what is registered, by kind
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CLIENT = path.join(ROOT, "client/src");
const REGISTRY_FILE = path.join(CLIENT, "app/screen-registry.json");
const APP_FILE = path.join(CLIENT, "app/app.tsx");
const AREAS_FILE = path.join(CLIENT, "app/layout/areas.ts");
const MODULES = path.join(ROOT, "src/modules");
const LIST = process.argv.includes("--list");

const read = (p) => fs.readFileSync(p, "utf8");
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
/**
 * Comments out — a route or a tab named in prose is not one. A small scanner
 * rather than a regex, because the regex reads `accept="image/*"` as the start
 * of a block comment and swallows half a screen.
 */
function stripComments(src) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (quote) {
      out += ch;
      if (ch === "\\") { out += next || ""; i += 2; continue; }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; out += ch; i += 1; continue; }
    if (ch === "/" && next === "/") { while (i < src.length && src[i] !== "\n") i += 1; continue; }
    if (ch === "/" && next === "*") { const end = src.indexOf("*/", i + 2); i = end < 0 ? src.length : end + 2; continue; }
    out += ch;
    i += 1;
  }
  return out;
}
/** Param names do not matter: `/x/:id` and `/x/:orderId` are one route. */
const shape = (route) => route.split("?")[0].replace(/:[A-Za-z_]+/g, ":").replace(/\/+$/, "") || "/";

/* ── the code ─────────────────────────────────────────────────────────────── */

function appRoutes() {
  const src = stripComments(read(APP_FILE));
  const out = new Set();
  const re = /<Route\b\s+(?:(index)\b|path=(?:"([^"]+)"|\{"([^"]+)"\}))/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[1]) { out.add("/"); continue; }
    const p = m[2] || m[3];
    if (p === "*") continue;
    out.add(p.startsWith("/") ? p : `/${p}`);
  }
  return out;
}

function areas() {
  const src = stripComments(read(AREAS_FILE));
  const start = src.indexOf("export const AREAS");
  const body = src.slice(start);
  const out = [];
  const areaRe = /\{\s*key:\s*"([^"]+)",\s*label:\s*"([^"]+)",\s*basePath:\s*"([^"]*)"(?:,\s*to:\s*"([^"]*)")?\s*,\s*sections:\s*\[([\s\S]*?)\]\s*,?\s*\}/g;
  let m;
  while ((m = areaRe.exec(body))) {
    const [, key, label, basePath, to, sectionsSrc] = m;
    const sections = [];
    const secRe = /\{\s*key:\s*"([^"]+)",\s*label:\s*"([^"]+)"(?:,\s*to:\s*"([^"]+)")?\s*\}/g;
    let s;
    while ((s = secRe.exec(sectionsSrc))) sections.push({ key: s[1], label: s[2], route: s[3] || `${basePath}/${s[1]}` });
    out.push({ key, label, basePath, route: to || basePath || "/", sections });
  }
  return out;
}

function walk(dir, test, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") walk(p, test, acc); }
    else if (test(e.name, p)) acc.push(p);
  }
  return acc;
}

/** Every file that binds a tab to `?tab=`, and every value that tab can take. */
function urlTabs() {
  const files = walk(CLIENT, (n) => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) && n !== "use-url-tab.ts");
  const out = new Map();
  for (const f of files) {
    const src = stripComments(read(f));
    if (!/\buseUrlTab\s*[<(]/.test(src)) continue;
    const values = new Set();
    // Every array literal bound to a *TABS const: the tab lists themselves.
    const constRe = /const\s+([A-Z0-9_]*TABS)\b[^=]*=\s*\[([\s\S]*?)\]/g;
    let m;
    while ((m = constRe.exec(src))) for (const v of m[2].matchAll(/"([^"]+)"/g)) values.add(v[1]);
    // …and literals written into the call itself ([...BASE_TABS, "Website"]).
    const callRe = /useUrlTab\s*(?:<[^>]*>)?\s*\(([\s\S]*?)\)\s*;/g;
    while ((m = callRe.exec(src))) for (const v of m[1].matchAll(/"([^"]+)"/g)) values.add(v[1]);
    out.set(rel(f), values);
  }
  return out;
}

/** Modules with records, and how each answers search. */
function recordModules() {
  const out = [];
  const visit = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    const controllers = files.filter((f) => f.endsWith(".controller.js"));
    if (controllers.length && files.some((f) => f.endsWith(".repo.js"))) {
      const provider = files.find((f) => f.endsWith(".search.js")) || null;
      let optOut = null;
      for (const c of controllers) {
        const m = read(path.join(dir, c)).match(/\/\/\s*search:none\b[ \t:—-]*(.*)$/m);
        if (m) { optOut = { file: c, reason: (m[1] || "").trim() }; break; }
      }
      out.push({ dir: path.relative(MODULES, dir).split(path.sep).join("/"), provider, optOut });
    }
    for (const e of entries) if (e.isDirectory()) visit(path.join(dir, e.name));
  };
  visit(MODULES);
  return out;
}

function providerTypes() {
  const registry = require(path.join(ROOT, "src/services/search/registry"));
  return registry.providers();
}

/* ── the check ────────────────────────────────────────────────────────────── */

/**
 * @param {object} [over]  for tests: a registry object, a module list
 *                         (recordModules' shape) or a provider list to check
 *                         instead of the tree's own.
 */
function check(over = {}) {
  const reg = over.registry || JSON.parse(read(REGISTRY_FILE));
  const screens = reg.screens || [];
  const hubs = reg.hubs || [];
  const redirects = reg.redirects || [];
  const tabs = reg.tabs || [];
  const sectionHubs = reg.section_hubs || [];
  const problems = [];
  const say = (rule, msg) => problems.push({ rule, msg });

  const routes = appRoutes();
  const areaList = areas();
  const hubBases = new Set(areaList.filter((a) => a.basePath).map((a) => a.basePath));
  const sectionRoutes = new Set(areaList.flatMap((a) => a.sections.map((s) => s.route)));
  // A hub that keeps its sections in its own component (Smart Comms) declares
  // them in section_hubs[]; each must still be a string its source switches on.
  for (const h of sectionHubs) {
    const file = path.join(ROOT, h.source || "");
    if (!h.source || !fs.existsSync(file)) { say("stale", `section hub ${h.route}: ${h.source} does not exist.`); continue; }
    const src = read(file);
    for (const key of h.sections || []) {
      if (!src.includes(`"${key}"`)) say("stale", `section hub ${h.route}: "${key}" is not a section of ${h.source} any more.`);
      sectionRoutes.add(`${h.route}/${key}`);
    }
    hubBases.add(h.route);
  }

  const staffScreens = screens.filter((s) => s.app !== "public-web");
  const registered = new Set([
    ...staffScreens.map((s) => shape(s.route)),
    ...hubs.map((h) => shape(h.route)),
    ...redirects.map((r) => shape(r.route)),
  ]);

  // 1. Every route the app serves is registered.
  for (const r of routes) {
    const m = r.match(/^(.*)\/:section$/);
    if (m && hubBases.has(m[1])) continue; // a hub's sections — rule 2
    if (!registered.has(shape(r))) say("route", `${r} is routed in client/src/app/app.tsx but has no registry entry (screens[], hubs[] or redirects[]).`);
  }

  // 2. Every hub section is a registered screen; every hub is registered.
  const screenRoutes = new Set(staffScreens.map((s) => shape(s.route)));
  for (const a of areaList) {
    if (a.basePath && !registered.has(shape(a.route))) say("hub", `area "${a.key}" (${a.route}) has no registry entry — add it to hubs[].`);
    for (const s of a.sections) {
      if (!screenRoutes.has(shape(s.route))) say("section", `section "${a.key}/${s.key}" (${s.route}) is in areas.ts but not a registered screen.`);
    }
  }
  for (const h of sectionHubs) {
    for (const key of h.sections || []) {
      if (!screenRoutes.has(shape(`${h.route}/${key}`))) say("section", `section "${h.route}/${key}" (section_hubs) is not a registered screen.`);
    }
  }

  // 5a. Every registered staff route still exists.
  const routeShapes = new Set([...routes].map(shape));
  const servedBySection = (r) => {
    const m = r.match(/^(\/[^/]+)\/[^/:]+$/);
    return !!m && routeShapes.has(shape(`${m[1]}/:section`)) && sectionRoutes.has(r);
  };
  for (const s of staffScreens) {
    const r = s.route.split("?")[0];
    if (!routeShapes.has(shape(r)) && !servedBySection(r)) say("stale", `screen "${s.id}" points at ${s.route}, which the app no longer routes.`);
  }
  for (const h of hubs) if (!routeShapes.has(shape(h.route))) say("stale", `hub "${h.id}" points at ${h.route}, which the app no longer routes.`);
  for (const rd of redirects) {
    if (!routeShapes.has(shape(rd.route))) say("stale", `redirect ${rd.route} is not routed in app.tsx any more — drop the entry.`);
    if (!rd.to || !(screenRoutes.has(shape(rd.to)) || hubs.some((h) => shape(h.route) === shape(rd.to)))) {
      say("stale", `redirect ${rd.route} → ${rd.to}: the target is not a registered screen or hub.`);
    }
  }

  // 3. Tabs, both directions.
  const fileTabs = urlTabs();
  const entriesByFile = new Map();
  for (const t of tabs) {
    if (!entriesByFile.has(t.source)) entriesByFile.set(t.source, new Set());
    entriesByFile.get(t.source).add(t.value);
  }
  for (const [file, values] of fileTabs) {
    const have = entriesByFile.get(file) || new Set();
    for (const v of values) if (!have.has(v)) say("tab", `${file}: tab "${v}" is URL-addressable (useUrlTab) but has no tabs[] entry.`);
  }
  for (const t of tabs) {
    if (!fs.existsSync(path.join(ROOT, t.source))) { say("stale", `tab "${t.id}" names ${t.source}, which no longer exists.`); continue; }
    const values = fileTabs.get(t.source);
    if (!values) say("stale", `tab "${t.id}": ${t.source} no longer calls useUrlTab.`);
    else if (!values.has(t.value)) say("stale", `tab "${t.id}": ${t.source} has no tab "${t.value}" any more.`);
  }

  // 4. Records: a provider, or a reasoned opt-out.
  const mods = over.modules || recordModules();
  for (const m of mods) {
    if (m.provider) continue;
    if (!m.optOut) say("records", `src/modules/${m.dir} has records but no ${path.basename(m.dir)}.search.js and no "// search:none <reason>" in its controller.`);
    else if (m.optOut.reason.replace(/[^A-Za-z]/g, "").length < 8) say("records", `src/modules/${m.dir}/${m.optOut.file}: "// search:none" needs a reason.`);
  }
  let providers = over.providers || [];
  if (!over.providers) {
    try {
      providers = providerTypes();
    } catch (err) {
      say("records", `the search providers do not load: ${err.message}`);
    }
  }
  const types = new Set(providers.map((p) => p.type));
  for (const p of providers) {
    if (!screenRoutes.has(shape(p.route))) say("stale", `search provider "${p.type}" (${p.file}) lands on ${p.route}, which is not a registered screen.`);
  }
  for (const t of tabs) {
    for (const ty of t.record_types || []) if (!types.has(ty)) say("stale", `tab "${t.id}" opens a "${ty}", which no search provider declares.`);
  }

  // 6. French titles.
  for (const s of staffScreens) if (!s.title_fr) say("french", `screen "${s.id}" has no title_fr.`);
  for (const h of hubs) if (!h.title_fr) say("french", `hub "${h.id}" has no title_fr.`);
  for (const t of tabs) if (!t.title_fr) say("french", `tab "${t.id}" has no title_fr.`);

  return { problems, counts: { routes: routes.size, screens: staffScreens.length, hubs: hubs.length, redirects: redirects.length, tabs: tabs.length, providers: providers.length, optedOut: mods.filter((m) => !m.provider && m.optOut).length } };
}

if (require.main === module) {
  const { problems, counts } = check();
  if (LIST) {
    console.warn(JSON.stringify(counts, null, 2));
    for (const p of problems) console.warn(`  ${p.rule.padEnd(8)} ${p.msg}`);
    process.exit(0);
  }
  if (!problems.length) {
    console.warn(
      `[search-registry] ok — ${counts.routes} routes, ${counts.screens} screens, ${counts.hubs} hubs, ${counts.redirects} redirects, ${counts.tabs} tabs; ${counts.providers} record providers, ${counts.optedOut} modules opted out with a reason.`,
    );
    process.exit(0);
  }
  console.error(`\nSEARCH REGISTRY FAILED — ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  · [${p.rule}] ${p.msg}`);
  console.error(`
⌘K finds every page, tab and record (meeting 6, G5), and this is what makes
that true. Fix each line above:

  · a new route, hub or tab → add it to client/src/app/screen-registry.json
    (screens[], hubs[], redirects[] or tabs[]) with an English and a French
    title. \`npm run new:screen --prefix client\` prints a screen entry for you.
  · a module with records → add src/modules/<group>/<module>/<module>.search.js
    (src/services/search/provider.js has the contract), or put
        // search:none — <why nobody looks these up by name or number>
    at the top of its controller.
  · a stale entry → remove it, or point it at where the thing lives now.
`);
  process.exit(1);
}

module.exports = { check, appRoutes, areas, urlTabs, recordModules, shape };
