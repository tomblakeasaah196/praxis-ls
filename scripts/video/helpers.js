"use strict";
/**
 * Moves every scene shares (doc/TRAINING_VIDEOS.md §4.3): finding a window, a field, a button or a
 * heading the way a person reads the screen, pointing softly, touring a row of buttons, and the
 * email a new colleague opens, shown as the product wrote it.
 *
 * Names are matched in any case and exactly, because the screen sets many labels in capitals while
 * the page holds them in sentence case ("Sign in" reads SIGN IN).
 */
const { named } = require("./film");

const button = (s, name, within) => (within || s.page).getByRole("button", { name: named(name) }).first();
const link = (s, name, within) => (within || s.page).getByRole("link", { name: named(name) }).first();
const tab = (s, name) => s.page.getByRole("tab", { name: named(name) }).first();
const heading = (s, name) => s.page.getByRole("heading", { name: named(name) }).first();
/** A window by its name; the last one, so a help popup opened on top never answers for the record. */
const dialog = (s, name) => s.page.getByRole("dialog", { name: named(name) }).last();
const field = (s, label) => s.page.getByLabel(label, { exact: true }).first();
/** Words on the page itself. */
const text = (s, words) => s.page.getByText(words).first();

/** Glide to `loc` when it shows within a few seconds: a line that only points never costs a whole take. */
async function soft(s, loc, wait = 4000) {
  if (await loc.waitFor({ state: "visible", timeout: wait }).then(() => true, () => false)) await s.hover(loc);
}

/** Point at each of `locs` in turn, pausing on each. */
async function tour(s, locs, pause = 0.5) {
  for (const loc of locs) {
    await soft(s, loc);
    await s.wait(pause);
  }
}

/**
 * The invitation, as a mail window around the product's own message: the subject and the address it
 * was sent to are the real ones; the body is the HTML the product wrote, untouched, so its button
 * is the real link. `mail` is { to, subject, html } from ground.invite().
 */
function mailPage(mail) {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(mail.html);
  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(mail.subject)}</title></head>
<body style="margin:0;background:#e9eef5;font-family:'Public Sans',system-ui,sans-serif">
<div style="max-width:860px;margin:44px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 10px 40px rgba(16,30,52,.14)">
  <div style="padding:20px 28px;border-bottom:1px solid #e3e8ef">
    <div style="font-size:21px;font-weight:700;color:#101e34">${esc(mail.subject)}</div>
    <div style="margin-top:6px;font-size:14px;color:#5a6b85">To: ${esc(mail.to)}</div>
  </div>
  <div style="background:#f3f6fb;padding:8px 0 24px">${body ? body[1] : mail.html}</div>
</div></body></html>`;
}

module.exports = { button, link, tab, heading, dialog, field, text, soft, tour, mailPage };
