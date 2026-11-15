"use strict";
/* global document, window */
/**
 * Film a video's shots (doc/TRAINING_VIDEOS.md §4): each desktop or phone shot is signed in off
 * camera, then recorded as full-resolution captures taken back to back, each with its time, while
 * its lines play out. A line's actions start as its narration starts and the next line waits for
 * both, so the picture and the voice stay together however long a screen takes.
 *
 * Writes <out>/shots/<shot>/NNNNN.jpg and <out>/shots/<shot>/take.json:
 *   { start, end, frames: [{ file, t }], lines: [{ id, at }] }   (times in seconds since the epoch)
 */
const fs = require("node:fs");
const path = require("node:path");
const { launch } = require("./browser");
const { DESKTOP, PHONE } = require("./style");

/** The browsers filming presents as: Chrome on a Windows computer and on an Android phone. */
const UA = Object.freeze({
  desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  phone: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
});

/** The pause between sentences, and before a shot's first line and after its last (so a cut never clips a word). */
const GAP = 0.7;
const LEAD = 0.35;
const TAIL = 0.45;

const sleep = (s) => new Promise((r) => setTimeout(r, Math.max(0, s) * 1000));
/** `promise`, or a rejection after `seconds`: a browser connection that stops answering must not hold a take for ever. */
const within = (promise, seconds, what) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} did not answer in ${seconds}s`)), seconds * 1000))]);
const now = () => Date.now() / 1000;

/** The pointer drawn on desktop shots: a white arrow with a dark edge that follows the mouse. */
const CURSOR = `(() => {
  const draw = () => {
    if (document.getElementById("video-cursor")) return;
    const c = document.createElement("div");
    c.id = "video-cursor";
    c.innerHTML = '<svg width="22" height="30" viewBox="0 0 22 30"><path d="M2 2 L2 24 L8 18.5 L12.2 28 L16 26.3 L11.8 17 L19.5 17 Z" fill="#fff" stroke="#111" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none",
      transform: "translate(760px, 420px)", filter: "drop-shadow(0 1px 1.5px rgba(0,0,0,.35))" });
    document.documentElement.appendChild(c);
    const follow = (e) => { if (e.clientX || e.clientY) c.style.transform = "translate(" + (e.clientX - 2) + "px," + (e.clientY - 2) + "px)"; };
    for (const type of ["mousemove", "dragover", "drag"]) addEventListener(type, follow, true);
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", draw); else draw();
})();`;

/** Let a screen finish drawing: the page loaded, and a beat for the data and the entrance animations. */
async function settle(page, ms = 450) {
  await page.waitForLoadState("domcontentloaded").catch(() => null);
  await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => null);
  await sleep(ms / 1000);
}

/** A name as a person reads it: exact, in any case (the screen sets labels in capitals; the page holds them in sentence case). */
const named = (name) => (name instanceof RegExp ? name : new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"));

/** What a line's `do`, `before` and `after` receive: the page and the moves a person makes on it. */
function hands(page, { phone, origin }) {
  let at = { x: 760, y: 420 };
  const find = (target) => {
    if (typeof target !== "string" && !(target instanceof RegExp)) return target;
    const opts = { name: named(target) };
    return page.getByRole("button", opts).or(page.getByRole("link", opts)).or(page.getByRole("tab", opts))
      .or(page.getByRole("menuitem", opts)).or(page.getByRole("option", opts)).first();
  };
  const glide = async (loc) => {
    await loc.waitFor({ state: "visible", timeout: 15000 });
    await loc.scrollIntoViewIfNeeded();
    // Measured again after each glide: a list that closes or opens as the pointer travels moves what
    // it aims at, and a press where it was can land outside a dialog and close it.
    for (let tries = 0; tries < 4; tries++) {
      const box = await loc.boundingBox();
      const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      if (tries && Math.hypot(to.x - at.x, to.y - at.y) < 3) break;
      const steps = tries ? 6 : Math.max(12, Math.round(Math.hypot(to.x - at.x, to.y - at.y) / 18));
      await page.mouse.move(to.x, to.y, { steps });
      at = to;
      await sleep(0.18);
    }
  };
  const s = {
    page,
    phone,
    find,
    /** Open an address in the app (a cut, not a click). */
    go: async (where) => { await page.goto(origin + where); await settle(page); },
    /** Move to and press a button, link, tab, menu item or option by its name, or a Locator. */
    click: async (target) => {
      const loc = find(target);
      if (phone) { await loc.waitFor({ state: "visible", timeout: 15000 }); await loc.scrollIntoViewIfNeeded(); await sleep(0.25); await loc.tap(); }
      else { await glide(loc); await page.mouse.down(); await sleep(0.06); await page.mouse.up(); }
      await settle(page, 350);
    },
    /** Move the pointer to something without pressing it (nothing on a phone). */
    hover: async (target) => { if (!phone) await glide(find(target)); },
    /** Type into a field by its label (or a Locator), at a person's pace. */
    type: async (field, text, { delay = 45, clear = true } = {}) => {
      const loc = typeof field === "string" ? page.getByLabel(field, { exact: true }).first() : field;
      if (phone) await loc.tap(); else { await glide(loc); await loc.click(); }
      if (clear) await loc.fill("");
      await loc.pressSequentially(text, { delay });
    },
    /** Press a key or a chord (Control+K), as a person would. */
    key: async (combo) => { await page.keyboard.press(combo); await sleep(0.25); },
    /** Scroll the page (or the element `inside`) by `dy` pixels, smoothly. */
    scroll: async (dy, inside) => {
      if (inside) await glide(find(inside));
      for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, dy / 12); await sleep(0.03); }
      await sleep(0.2);
    },
    wait: sleep,
    settle: (ms) => settle(page, ms),
  };
  return s;
}

/**
 * Chromium for filming. The app runs on this machine, but every address on screen must read as the
 * tenant's own (smartls.praxisls.com), never localhost: Chromium sends that host to the local server.
 */
async function browserFor(origin, port) {
  const host = new URL(origin);
  return launch({
    args: [
      `--host-resolver-rules=MAP ${host.hostname}:${host.port || 80} 127.0.0.1:${port}`,
      `--unsafely-treat-insecure-origin-as-secure=${host.origin}`,
    ],
  });
}

/** Answer what opens by itself over a first screen, as a person would before a demonstration. */
async function clearOffers(page) {
  for (let i = 0; i < 4; i++) {
    let any = false;
    for (const name of ["Not Now", "Dismiss", "Maybe later", "Not now"]) {
      const b = page.getByRole("button", { name, exact: true }).first();
      if (await b.isVisible().catch(() => false)) { await b.click({ timeout: 2000 }).catch(() => null); any = true; await sleep(0.4); }
    }
    if (!any) break;
  }
}

/** Sign in through the real sign-in window, off camera. */
async function signIn(page, origin, email, password) {
  await page.goto(origin + "/login");
  await settle(page, 700);
  const enter = page.getByRole("button", { name: /enter workspace/i });
  if (await enter.isVisible().catch(() => false)) await enter.click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /^sign in/i }).last().click();
  await page.getByRole("button", { name: /^Account:/ }).waitFor({ state: "visible", timeout: 30000 });
  await settle(page, 700);
  await clearOffers(page);
}

/**
 * Film one shot. `shot` is { kind: "desktop"|"phone", as, start, env, setup, lines }, each line
 * { id, duration, before, do, after, hold }. A shot with no `as` is filmed signed out (a sign-in
 * shown on camera). `env: "sandbox"` starts it in TEST. `still` asks for reduced motion.
 */
async function filmShot(browser, shot, dir, { origin, password, emailOf }) {
  const phone = shot.kind === "phone";
  const context = await browser.newContext({
    ...(phone ? { viewport: PHONE.viewport, deviceScaleFactor: PHONE.deviceScaleFactor, isMobile: true, hasTouch: true }
      : { viewport: DESKTOP.viewport, deviceScaleFactor: DESKTOP.deviceScaleFactor }),
    // A person's own browser, as the sessions list names it ("Chrome on Windows"): the headless
    // browser's own name is no browser a person uses.
    userAgent: phone ? UA.phone : UA.desktop,
    locale: "en-GB",
    timezoneId: "Africa/Douala",
    acceptDownloads: true,
    // No service worker: its "Ready to work offline" toast is not what a person sees on a day-to-day visit.
    serviceWorkers: "block",
    // The browser's location is allowed and fixed on Douala, as a person's is after answering the clock's offer once:
    // left unanswered, the first screen carries a "Location is blocked for this site" warning over the Control Tower.
    permissions: ["geolocation", ...(phone ? [] : ["clipboard-read", "clipboard-write"])],
    geolocation: { latitude: 4.0511, longitude: 9.7679 },
    ...(shot.still ? { reducedMotion: "reduce" } : {}),
  });
  if (!phone) await context.addInitScript(CURSOR);
  // No red underline under words the dictionary lacks as a person types.
  await context.addInitScript(() => document.addEventListener("DOMContentLoaded", () => document.documentElement.setAttribute("spellcheck", "false")));
  if (shot.env === "sandbox") await context.addInitScript(() => { try { window.localStorage.setItem("praxis.env", "sandbox"); } catch { /* storage unavailable */ } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  if (shot.as) await signIn(page, origin, emailOf(shot.as), password);
  if (shot.start) { await page.goto(origin + shot.start); await settle(page, 700); }
  if (shot.as) await clearOffers(page);

  const s = hands(page, { phone, origin });
  s.password = password;
  s.clearOffers = () => clearOffers(page);
  if (shot.setup) await shot.setup(s);
  await sleep(0.6);

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const take = { start: 0, end: 0, frames: [], lines: [] };
  // Full-resolution captures, one after another (about 20 a second): Chromium's screencast sends
  // frames at CSS size and ignores the device scale, which would leave the text soft.
  let cdp = await context.newCDPSession(page);
  const vp = phone ? PHONE.viewport : DESKTOP.viewport;
  const scale = phone ? PHONE.deviceScaleFactor : DESKTOP.deviceScaleFactor;
  let n = 0;
  let rolling = true;
  const camera = (async () => {
    while (rolling) {
      const t0 = now();
      // A page reload (switching to TEST) can leave the capture session talking to the old page, and a
      // call to it never returns: each call is timed, and a failed one opens a new session.
      const img = await within((async () => {
        const view = await cdp.send("Page.getLayoutMetrics").then((m) => m.cssVisualViewport, () => ({ pageX: 0, pageY: 0 }));
        return cdp.send("Page.captureScreenshot", {
          format: "jpeg", quality: 92, optimizeForSpeed: true,
          clip: { x: view.pageX, y: view.pageY, width: vp.width, height: vp.height, scale },
        });
      })(), 6, "the camera").catch(async () => {
        cdp = await context.newCDPSession(page).catch(() => cdp);
        return null;
      });
      if (!img) { await sleep(0.03); continue; }
      const file = String(++n).padStart(5, "0") + ".jpg";
      fs.writeFileSync(path.join(dir, file), Buffer.from(img.data, "base64"));
      take.frames.push({ file, t: (t0 + now()) / 2 });
    }
  })();
  take.start = now();
  try {
    await sleep(LEAD);
    for (const [i, line] of shot.lines.entries()) {
      if (line.before) await line.before(s);
      const at = now();
      take.lines.push({ id: line.id, at });
      await Promise.all([sleep(line.duration), line.do ? line.do(s) : null]);
      if (line.after) await line.after(s);
      const spoken = now() - at;
      await sleep((line.hold || 0) + (i < shot.lines.length - 1 ? GAP : TAIL) - Math.max(0, spoken - line.duration));
    }
  } finally {
    take.end = now();
    rolling = false;
    await camera;
  }
  fs.writeFileSync(path.join(dir, "take.json"), JSON.stringify(take, null, 1));
  await context.close();
  return take;
}

/** Film every shot of `plan` that is not a card, or only those in `only` (a Set of shot ids). */
async function film(plan, out, opts) {
  const browser = await browserFor(opts.origin, opts.port);
  try {
    for (const shot of plan.shots) {
      if (shot.kind === "card" || (opts.only && !opts.only.has(shot.id))) continue;
      process.stdout.write(`filming ${shot.id} (${shot.kind}, ${shot.lines.length} lines) ... `);
      // A shot takes about as long as its narration; far longer means it is stuck, and the run stops there.
      const limit = shot.lines.reduce((n, l) => n + l.duration + 2, 0) * 1.6 + 120;
      const take = await within(filmShot(browser, shot, path.join(out, "shots", shot.id), opts), limit, `shot ${shot.id}`);
      console.warn(`${(take.end - take.start).toFixed(1)}s, ${take.frames.length} frames`);
    }
  } finally {
    await browser.close();
  }
}

module.exports = { film, settle, clearOffers, named, GAP, LEAD, TAIL };
