"use strict";
/**
 * The faces the PUBLIC WEBSITE can actually render.
 *
 * ── WHY THIS IS A SHORTER LIST THAN THE ERP'S ──────────────────────────────
 *
 * `client/src/lib/fonts.ts` offers seventeen families and loads each one
 * lazily, per family, on demand. `public-web` does not: it declares four
 * `@font-face` blocks in `src/fonts.css`, subset to latin + latin-ext, and
 * ships nothing else.
 *
 * That difference is deliberate — the public site has a first-paint budget the
 * ERP does not — and it creates a trap this file exists to close. A tenant who
 * picks Montserrat in Settings › Appearance gets Montserrat in the ERP and, on
 * their public site, a stack naming a family no `@font-face` declares. The
 * browser falls silently through to the generic. Nothing errors, nothing is
 * logged, and it looks fine to everyone who has Montserrat installed.
 *
 * So the WEBSITE picker offers these four, and the API refuses the rest with a
 * message that says why.
 *
 * ── IT IS CHECKED, NOT ASSERTED ────────────────────────────────────────────
 *
 * `tests/unit/site-fonts-match-stylesheet.test.js` parses
 * `public-web/src/fonts.css` and fails if these ids and that file disagree in
 * either direction. Adding a face to the stylesheet without adding it here
 * hides it from tenants; adding it here without the stylesheet is the silent
 * fallback above. Neither can now happen quietly.
 */

/** Font ids — the same ids `client/src/lib/fonts.ts` uses, so a tenant's ERP
 *  choice and their website choice are the same vocabulary. */
const SITE_FONT_IDS = ["archivo", "ibm-plex-sans", "inter", "jetbrains-mono"];

/** Which of them may fill each role on the website. */
const SITE_FONT_ROLES = {
  display: ["archivo", "ibm-plex-sans", "inter"],
  body: ["inter", "ibm-plex-sans"],
  mono: ["jetbrains-mono"],
};

const SITE_FONT_DEFAULTS = {
  display: "archivo",
  body: "inter",
  mono: "jetbrains-mono",
};

/** Is `id` allowed in `role`? Falls back to the role default rather than
 *  throwing, for the reason the palette engine does: this resolves a stored
 *  value at request time, and a row naming a face a later version removed must
 *  render the site, not fail the page. */
function resolveSiteFont(role, id) {
  const allowed = SITE_FONT_ROLES[role] || [];
  return allowed.includes(id) ? id : SITE_FONT_DEFAULTS[role];
}

exports.SITE_FONT_IDS = SITE_FONT_IDS;
exports.SITE_FONT_ROLES = SITE_FONT_ROLES;
exports.SITE_FONT_DEFAULTS = SITE_FONT_DEFAULTS;
exports.resolveSiteFont = resolveSiteFont;
