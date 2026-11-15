"use strict";
/**
 * Where a training video finds its browser (doc/TRAINING_VIDEOS.md §1).
 *
 * Playwright is not a dependency of the backend, so it is looked for where a session has it: on
 * the module path (a cloud session installs it globally), then in the client's own toolchain
 * (`client/node_modules`, where the layout gate's copy lives). Chromium is the image's own, never
 * Playwright's download: `PRAXIS_CHROMIUM`, else the first of the usual cloud paths that exists.
 */
const fs = require("node:fs");
const path = require("node:path");

function playwright() {
  for (const from of ["playwright", path.resolve(__dirname, "../../client/node_modules/playwright")]) {
    try {
      return require(from);
    } catch {
      /* try the next place */
    }
  }
  throw new Error("Playwright is not installed: run `npm ci` in client/ (doc/TRAINING_VIDEOS.md §1).");
}

function chromiumPath() {
  const wanted = [process.env.PRAXIS_CHROMIUM, process.env.CHROME_BIN, process.env.PUPPETEER_EXECUTABLE_PATH, "/opt/pw-browsers/chromium"];
  return wanted.find((p) => p && fs.existsSync(p)) || undefined;
}

/** A Chromium, headless, with `args` and any other launch options. */
function launch(options = {}) {
  return playwright().chromium.launch({ executablePath: chromiumPath(), ...options });
}

module.exports = { playwright, launch, chromiumPath };
