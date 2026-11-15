"use strict";

/**
 * THE PDF RASTER STACK MUST SURVIVE THE RUNTIME IMAGE.
 *
 * §8.4 step 1: "If the upload is a PDF, rasterise page 1 at 300 dpi." A
 * scan-to-PDF from an office copier is the most common way a hand-signed page
 * comes back, so this is not an edge of Tier 4 — it is the main road.
 *
 * ── WHY A DEPENDENCY TEST, OF ALL THINGS ───────────────────────────────────
 *
 * PR-5 originally shipped with `sharp` alone, whose libvips build here has no
 * PDF support at all (`sharp.format.pdf.input` is false on file, buffer and
 * stream). Every copier scan threw, was swallowed, and was filed as
 * "the DataMatrix could not be decoded reliably" — a sentence about the paper,
 * for a failure that never opened the file. The fix added `pdfjs-dist` and
 * `@napi-rs/canvas`.
 *
 * Two later changes, each sensible alone, removed the evidence that the fix
 * still works:
 *
 *   1. The raster tests in signature-wet-barcode.test.js are `test.skip` under
 *      GITHUB_ACTIONS — the real rasterise costs ~6s, so they run locally only.
 *      No pull request executes them.
 *   2. The pdfjs/canvas require moved INSIDE `rasterisePdf`, so a missing
 *      module no longer fails at boot. It fails on the first returned scan,
 *      inside a catch that turns it into `PDF_RASTERIZE_FAILED` — which reads
 *      like a damaged fax, not like a missing dependency.
 *
 * So the failure got later and quieter at the same moment its test stopped
 * running in CI. This file is the cheap half of putting that back: it asserts
 * the stack is present and correctly DECLARED, in milliseconds, on every
 * commit. The other half is the `docker exec` probe in the docker-build job,
 * which is the only place that can prove the modules survive the image the
 * `--omit=dev` install actually produces.
 */

const path = require("path");
const pkg = require("../../package.json");

/** Everything `rasterisePdf` reaches for, and why each one is load-bearing. */
const REQUIRED = [
  ["pdfjs-dist", "renders page 1 of a returned PDF to a canvas (§8.4 step 1)"],
  ["@napi-rs/canvas", "the canvas backend pdfjs draws into under Node"],
];

describe("the PDF raster stack ships in production", () => {
  test.each(REQUIRED)("%s is a production dependency — %s", (name) => {
    // The Dockerfile runs `npm install --omit=dev`, so a devDependency is not
    // pruned "eventually" — it is absent from the image that serves traffic,
    // while every local test and every CI job still passes.
    expect(Object.keys(pkg.dependencies)).toContain(name);
    expect(Object.keys(pkg.devDependencies || {})).not.toContain(name);
  });

  test("there is no `canvas` package: pdfjs-dist 4 reaches @napi-rs/canvas by its own name", () => {
    // pdfjs-dist 3 resolved its backend by the bare name `canvas`, so package.json aliased `canvas` to
    // @napi-rs/canvas, and pdfjs still installed its own nested native `canvas` (and the vulnerable
    // node-tar behind it) next to the alias. pdfjs-dist 4 asks for @napi-rs/canvas directly, the alias
    // is gone, and a `canvas` entry coming back would bring that native build and its tar chain with it.
    expect(Object.keys(pkg.dependencies)).not.toContain("canvas");
  });

  test.each(REQUIRED)("%s resolves", (name) => {
    // Cheap: resolution only, no rasterising, no browser. This is the
    // assertion the skipped raster tests stopped making on pull requests.
    expect(() => require.resolve(name)).not.toThrow();
  });

  test("the exact entry point rasterisePdf imports is resolvable", () => {
    // Not the package root. `pdfjs-dist/legacy/build/pdf.mjs` is the build that runs on the Node versions
    // we support (the modern build needs newer syntax), and it is ESM only, so it is loaded with a dynamic
    // import. A major-version bump that drops the legacy path would leave the root resolving perfectly
    // while decode fails on every scan.
    const entry = "pdfjs-dist/legacy/build/pdf.mjs";
    expect(() => require.resolve(entry)).not.toThrow();
    expect(path.isAbsolute(require.resolve(entry))).toBe(true);
  });

  test("barcode.js still reaches for exactly these modules", () => {
    // Pins the list above to the code. If rasterisePdf grows a new dependency
    // and nobody adds it here, the docker probe is the next thing that would
    // notice — after a merge rather than before one.
    const fs = require("fs");
    const src = fs.readFileSync(require.resolve("../../src/services/signatures/barcode.js"), "utf8");
    const builtins = new Set(require("module").builtinModules);
    const required = [...src.matchAll(/(?:require\(|import\()["']([^"']+)["']\)/g)].map((m) => m[1]);
    const external = required.filter((r) => !r.startsWith(".") && !builtins.has(r.replace(/^node:/, "")));

    for (const r of external) {
      // Every non-relative require in the decoder must be a declared
      // production dependency — the subpath forms included.
      const root = r.startsWith("@") ? r.split("/").slice(0, 2).join("/") : r.split("/")[0];
      expect(Object.keys(pkg.dependencies)).toContain(root);
    }
    expect(external).toEqual(expect.arrayContaining(["pdfjs-dist/legacy/build/pdf.mjs", "@napi-rs/canvas"]));
  });
});
