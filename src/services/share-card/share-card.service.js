"use strict";

/**
 * The picture a chat app shows when somebody shares a page of a tenant's site.
 *
 * ── WHY THE SERVER DRAWS IT ────────────────────────────────────────────────
 *
 * WhatsApp, LinkedIn, Slack and Facebook build a link's card from `og:image`.
 * Until this file existed that tag pointed at the page's photograph, or, on
 * every page without one, at the tenant's LOGO. A logo is the wrong shape for
 * a card (WhatsApp cropped "SMART LOGISTICS" to "MA" on 25 Nov 2026 and the
 * owner would not send the link to his CEO), and a bare photograph says nothing
 * about whose it is. So every page now gets a designed card, 1200 x 630, in
 * one composition: the page's own photograph, darkened from the left, the
 * tenant's logo in white, the page's headline in the site's display face, an
 * accent rule in the tenant's colour, and the address.
 *
 * Nothing here is one tenant's: the photograph, logo, headline, colour and
 * face all arrive as arguments, from the tenant's own records.
 *
 * ── THE SIZE IS A CONTRACT ─────────────────────────────────────────────────
 *
 * 1200 x 630 is the 1.91:1 frame every major unfurler draws large. JPEG, not
 * WebP: LinkedIn and several mail clients still refuse a WebP card, and a
 * refused card falls back to no picture at all. Kept well under 300 kB,
 * above which WhatsApp drops to its small thumbnail.
 *
 * ── FONTS ──────────────────────────────────────────────────────────────────
 *
 * Static WOFF2 cuts, vendored in `./fonts` (OFL, licences beside them). The
 * canvas library renders a VARIABLE font at its default instance only, so the
 * site's own @fontsource-variable files would set every headline at one
 * weight; a static cut is the weight the site's headings are actually set in.
 * Latin and latin-ext are both registered so a French accent or a place name
 * never falls through to a system face.
 */

const path = require("path");
const sharp = require("sharp");

/** Required on first draw, not at load: the page heads read this module for
 *  the card's dimensions on every request, and the native canvas binding has
 *  no business loading for that. */
let canvasLib = null;
const canvas = () => (canvasLib = canvasLib || require("@napi-rs/canvas"));

const WIDTH = 1200;
const HEIGHT = 630;
const PAD = 72;
const INK = "8,20,30";

/** The display faces the website offers (`packages/shared/design/site-fonts`),
 *  each with the cut its headings use. Body text on the card is Inter. */
const FACES = {
  archivo: { family: "Card Archivo", files: ["archivo-latin-600-normal", "archivo-latin-ext-600-normal"] },
  "ibm-plex-sans": { family: "Card Plex", files: ["ibm-plex-sans-latin-600-normal", "ibm-plex-sans-latin-ext-600-normal"] },
  inter: { family: "Card Inter Semibold", files: ["inter-latin-600-normal", "inter-latin-ext-600-normal"] },
};
const BODY = { family: "Card Inter", files: ["inter-latin-500-normal", "inter-latin-ext-500-normal"] };

let registered = false;
function registerFonts() {
  if (registered) return;
  for (const face of [...Object.values(FACES), BODY]) {
    for (const file of face.files) {
      canvas().GlobalFonts.registerFromPath(path.join(__dirname, "fonts", file + ".woff2"), face.family);
    }
  }
  registered = true;
}

/** Greedy word wrap at the context's current font. */
function wrap(ctx, words, maxWidth) {
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? line + " " + w : w;
    if (ctx.measureText(next).width <= maxWidth || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The type sizes a headline is tried at, largest first, and how many lines
 *  each may take. A short page name sets large on one or two lines; an
 *  article headline steps down to four smaller lines rather than being cut. */
const STEPS = [
  { size: 76, maxLines: 3 },
  { size: 68, maxLines: 3 },
  { size: 60, maxLines: 3 },
  { size: 54, maxLines: 4 },
  { size: 48, maxLines: 4 },
  { size: 44, maxLines: 4 },
];

/**
 * Break a headline into lines that fit, shrinking the type until it does.
 *
 * A headline that will not fit four lines at the smallest size is cut on a
 * word with an ellipsis: a card is a glance, and a fifth line would run into
 * the logo.
 */
function fitHeadline(ctx, text, family, maxWidth) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return { size: 0, lines: [] };
  for (const { size, maxLines } of STEPS) {
    ctx.font = `600 ${size}px "${family}"`;
    const lines = wrap(ctx, words, maxWidth);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxWidth)) return { size, lines };
  }
  const { size, maxLines } = STEPS[STEPS.length - 1];
  ctx.font = `600 ${size}px "${family}"`;
  const lines = wrap(ctx, words, maxWidth).slice(0, maxLines);
  let last = lines[lines.length - 1];
  while (last && ctx.measureText(last + "…").width > maxWidth) last = last.replace(/\s*\S+$/, "");
  lines[lines.length - 1] = (last || "").replace(/[\s,:;.]+$/, "") + "…";
  return { size, lines };
}

/**
 * The logo as the card prints it: white, from the logo's own transparency.
 *
 * A logo in brand colours disappears against a dark photograph (the blue of
 * this product's first tenant on a dusk quay), and a white plate behind it
 * reads as a sticker. Knocking the mark out to white from its alpha channel is
 * what an agency would hand over. A logo with no transparency cannot be
 * knocked out (it would print as a white rectangle), so it is placed as it is
 * on a white plate instead.
 */
async function preparedLogo(buffer, maxWidth, maxHeight) {
  if (!buffer) return null;
  const meta = await sharp(buffer).metadata();
  if (!meta.width || !meta.height) return null;
  const scale = Math.min(maxWidth / meta.width, maxHeight / meta.height);
  const w = Math.max(1, Math.round(meta.width * scale));
  const h = Math.max(1, Math.round(meta.height * scale));
  if (meta.hasAlpha) {
    const alpha = await sharp(buffer).resize(w, h).ensureAlpha().extractChannel("alpha").toBuffer();
    const white = await sharp({ create: { width: w, height: h, channels: 3, background: "#ffffff" } })
      .joinChannel(alpha)
      .png()
      .toBuffer();
    return { image: await canvas().loadImage(white), w, h, plate: false };
  }
  const flat = await sharp(buffer).resize(w, h).png().toBuffer();
  return { image: await canvas().loadImage(flat), w, h, plate: true };
}

/** A colour the canvas can draw, or the fallback. Only `#rgb`/`#rrggbb`. */
function safeColour(hex, fallback) {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(hex || "")) ? hex : fallback;
}

/**
 * Draw one card.
 *
 * @param {object} input
 * @param {Buffer|null} input.photo    the page's photograph, any size or format
 * @param {Buffer|null} input.logo     the tenant's logo
 * @param {string} input.headline      the page's headline, as the page prints it
 * @param {string} input.address       the host, printed under the rule
 * @param {string} [input.accent]      the tenant's primary colour, `#rrggbb`
 * @param {string} [input.font]        a website display-font id
 * @returns {Promise<Buffer>} a 1200 x 630 JPEG
 */
async function renderCard({ photo = null, logo = null, headline = "", address = "", accent = null, font = null }) {
  registerFonts();
  const face = FACES[font] || FACES.archivo;
  const board = canvas().createCanvas(WIDTH, HEIGHT);
  const ctx = board.getContext("2d");

  // The ground: the photograph when there is one, the ink otherwise.
  ctx.fillStyle = `rgb(${INK})`;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  if (photo) {
    try {
      // `attention` keeps the subject (a ship, a crane, people) in frame when
      // a wide photograph is cut to the card; the text side is darkened anyway.
      const fitted = await sharp(photo).rotate().resize(WIDTH, HEIGHT, { fit: "cover", position: sharp.strategy.attention }).png().toBuffer();
      ctx.drawImage(await canvas().loadImage(fitted), 0, 0);
    } catch {
      /* @silent:parse: an unreadable photograph leaves the ink ground, and the card still draws */
    }
  }

  // Legibility: a wash from the left, where the words sit, and a little at the
  // foot for the address.
  const across = ctx.createLinearGradient(0, 0, WIDTH * 0.78, 0);
  across.addColorStop(0, `rgba(${INK},0.84)`);
  across.addColorStop(0.55, `rgba(${INK},0.48)`);
  across.addColorStop(1, `rgba(${INK},0)`);
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const foot = ctx.createLinearGradient(0, HEIGHT * 0.55, 0, HEIGHT);
  foot.addColorStop(0, `rgba(${INK},0)`);
  foot.addColorStop(1, `rgba(${INK},0.55)`);
  ctx.fillStyle = foot;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // The logo, top left.
  const mark = await preparedLogo(logo, 300, 116).catch(() => null);
  if (mark) {
    if (mark.plate) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(PAD - 16, PAD - 14, mark.w + 32, mark.h + 28);
    }
    ctx.drawImage(mark.image, PAD, PAD, mark.w, mark.h);
  }

  // The headline, set from the baseline up so the rule and address keep their
  // places whatever the number of lines.
  const { size, lines } = fitHeadline(ctx, headline, face.family, 680);
  const ruleY = 492;
  if (lines.length) {
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "alphabetic";
    ctx.font = `600 ${size}px "${face.family}"`;
    const leading = Math.round(size * 1.1);
    let y = ruleY - 40 - leading * (lines.length - 1);
    for (const line of lines) {
      ctx.fillText(line, PAD, y);
      y += leading;
    }
  }
  ctx.fillStyle = safeColour(accent, "#ffffff");
  ctx.fillRect(PAD, ruleY, 64, 5);

  if (address) {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = `500 26px "${BODY.family}"`;
    ctx.fillText(String(address), PAD, 556);
  }

  const png = await board.encode("png");
  return sharp(png).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
}

module.exports = { renderCard, fitHeadline, WIDTH, HEIGHT };
