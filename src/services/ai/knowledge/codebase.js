/**
 * Repo/docs/UI -> knowledge items for the AI global corpus. Walks a set of roots,
 * reads text files, returns { kind, ref, title, content }. Skips deps/vendor.
 *
 * UI awareness (see doc/AI_READINESS.md): client/src is walked (kind "ui") so the
 * AI can read the frontend, and the canonical screen registry
 * (client/src/app/screen-registry.json) is emitted as structured "ui-screen"
 * cards — one per screen, mapping screen -> route -> module -> purpose -> actions.
 * That is what lets the assistant navigate/guide ("where do I raise an invoice?")
 * and ground per-module beck-and-call, not just read raw component text.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../../..");
const ROOTS = ["src", "migrations", "scripts", "doc", "client/src"];
const EXT = new Set([".js", ".sql", ".md", ".json", ".ts", ".tsx", ".jsx"]);
const SKIP = new Set(["node_modules", ".git", "coverage", "dist", "build", "media", "uploads"]);
const MAX_BYTES = 200 * 1024;

function kindFor(ref) {
  if (ref.startsWith("doc/")) return "doc";
  if (ref.startsWith("client/")) return "ui";
  return "codebase";
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (EXT.has(path.extname(e.name))) out.push(full);
  }
}

/**
 * Structured screen cards from the UI screen registry. One compact card per
 * screen so semantic recall over "which screen / how do I get to X" is precise.
 */
function screenCards() {
  const regPath = path.join(ROOT, "client/src/app/screen-registry.json");
  let reg;
  try {
    reg = JSON.parse(fs.readFileSync(regPath, "utf8"));
  } catch {
    return [];
  }
  const screens = Array.isArray(reg.screens) ? reg.screens : [];
  return screens.map((s) => {
    const actions = (s.actions || []).join(", ") || "none";
    const content =
      `UI screen "${s.title}" (id: ${s.id}). Route: ${s.route}. ` +
      `Area: ${s.area}. Module: ${s.module_key || "n/a"}. ` +
      `Purpose: ${s.purpose} AI actions reachable here: ${actions}.`;
    return { kind: "ui-screen", ref: `ui:screen/${s.id}`, title: `Screen: ${s.title}`, content };
  });
}

function collect() {
  const files = [];
  for (const r of ROOTS) walk(path.join(ROOT, r), files);
  const items = [];
  for (const f of files) {
    let stat;
    try {
      stat = fs.statSync(f);
    } catch {
      continue;
    }
    if (stat.size > MAX_BYTES) continue;
    const ref = path.relative(ROOT, f).replace(/\\/g, "/");
    items.push({ kind: kindFor(ref), ref, title: ref, content: fs.readFileSync(f, "utf8") });
  }
  // Structured UI screen cards on top of the raw files.
  return items.concat(screenCards());
}

module.exports = { collect, screenCards, ROOT, ROOTS };
