/**
 * Every search provider, discovered (tenant review, meeting 6, PR 4 — G5).
 *
 * The same principle as the AI action registrar (`services/ai/action-
 * registrar.js`): walk `src/modules` for `<module>.search.js`, and what is not
 * declared does not exist. Nobody edits a central list to make a module
 * searchable — the module says so next to itself — and
 * `scripts/check-search-registry.js` fails the build on a module with records
 * that neither declares a provider nor writes down why it has none.
 *
 * A provider file exports one provider or an array (client master answers for
 * clients AND their contacts). Two providers claiming one `type` is a load
 * error, not a silent overwrite: the palette groups by type, and a duplicate
 * would merge two modules' results under one heading with one module's grant.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const MODULES_DIR = path.resolve(__dirname, "../../modules");

function discoverProviderFiles(dir = MODULES_DIR, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) discoverProviderFiles(p, out);
    else if (e.name.endsWith(".search.js")) out.push(p);
  }
  return out.sort();
}

let cached = null;

/** Every provider, in a stable order (by file path, then declaration). */
function providers() {
  if (cached) return cached;
  const all = [];
  const seen = new Map();
  for (const file of discoverProviderFiles()) {
    // dynamic require: discovered under src/modules (trusted, local)
    const exported = require(file);
    for (const p of Array.isArray(exported) ? exported : [exported]) {
      if (!p || typeof p.search !== "function" || !p.type || !p.module) {
        throw new Error(`search provider in ${path.relative(MODULES_DIR, file)} is malformed (needs type, module, search)`);
      }
      if (seen.has(p.type)) {
        throw new Error(`search type "${p.type}" is declared twice: ${seen.get(p.type)} and ${path.relative(MODULES_DIR, file)}`);
      }
      seen.set(p.type, path.relative(MODULES_DIR, file));
      all.push({ ...p, file: path.relative(MODULES_DIR, file).split(path.sep).join("/") });
    }
  }
  cached = all;
  return all;
}

/** For tests: forget the cache. */
function reset() {
  cached = null;
}

module.exports = { providers, discoverProviderFiles, reset, MODULES_DIR };
