/**
 * The ONE door from this app into `packages/shared` — by deep path, one module
 * at a time, never the package index.
 *
 * WHY A DEEP PATH. The index pulls Zod and the ISO country and currency tables,
 * and this app's first paint has ~11 kB of gzipped headroom
 * (`scripts/check-bundle.mjs`; the note in `packages/shared/index.js`). A
 * module reached through this door must require nothing — `text/title-case.js`
 * is the first, and the reason the door exists: the owner made Title Case the
 * standard for every label on the site and the portal (tenant review of
 * 29 Sep 2026, D5), and the rule is the financial dictionary's, unchanged.
 * Two copies of a casing rule are two rules.
 *
 * WHY THREE SETTINGS, NOT ONE. `packages/shared` is CommonJS — the API
 * requires it with no build step — and this app is ESM end to end:
 *
 *   - `alias`           — `@praxis/shared/…` is the repo's directory; this app
 *                         does not install the package (CI installs only its
 *                         own dependencies).
 *   - `optimizeInclude` — DEV. Vite serves source files verbatim, and a file
 *                         with `exports.x =` in it does not run in a browser.
 *                         Naming it here has esbuild pre-bundle it to ESM.
 *   - `commonjsInclude` — BUILD. Rollup applies CommonJS interop only to what
 *                         this matches, and the default is node_modules alone.
 *                         `/node_modules/` must stay: overriding replaces it.
 *
 * Imported by vite.config.ts AND vitest.config.ts so the build and the tests
 * cannot disagree about what resolves — the failure `client/config/
 * shared-alias.ts` was written to end.
 */
import path from "node:path";

/** Each deep module this app imports. Add one here when you import one. */
export const SHARED_DEEP_MODULES = ["@praxis/shared/text/title-case"];

export function sharedDeep(appDir: string) {
  return {
    alias: { "@praxis/shared": path.resolve(appDir, "../packages/shared") },
    optimizeInclude: SHARED_DEEP_MODULES,
    commonjsInclude: [/node_modules/, /packages[\\/]shared/],
  };
}
