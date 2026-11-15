"use strict";
/**
 * The look of a Praxis LS training video (doc/TRAINING_VIDEOS.md §2), kept in one file so every
 * video, in every chat, matches the one before it.
 *
 * A frame is 1920 × 1080: the picture (1920 × 960) above the caption bar (1920 × 120). The picture
 * is the app, or a card; the bar carries the English subtitle (the narration is French) and, on the
 * left, which chapter of the video this is, in both languages. Each builder returns a
 * self-contained HTML page that `cards.js` photographs with Chromium: fonts, logo and photograph
 * are inlined, so no page depends on a file path or a network.
 *
 * The cards wear the TENANT's brand, read from `brand/<tenant>/` (its palette, its logo, its login
 * photograph), because this is white-label software: a video for Smart LS is Smart LS's video. The
 * faces are the tenant's own (Plus Jakarta Sans for headings, Public Sans for text), the ones the
 * product is set in.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const SLUG = process.env.VIDEO_TENANT || "smartls";
const BRAND_DIR = path.join(__dirname, "brand", SLUG);
const FONTS = path.join(ROOT, "client", "node_modules", "@fontsource-variable");

const SIZE = Object.freeze({ width: 1920, height: 1080, picture: 960, bar: 120 });

/** Desktop is filmed at 1536 × 768 with a device scale of 1.25, which fills the picture exactly. */
const DESKTOP = Object.freeze({ viewport: { width: 1536, height: 768 }, deviceScaleFactor: 1.25 });

/** A phone is filmed at 390 × 860 (scale 2) and shown at 394 × 869 inside the frame below. */
const PHONE = Object.freeze({
  viewport: { width: 390, height: 860 },
  deviceScaleFactor: 2,
  screen: { x: 1068, y: 40, width: 394, height: 869, radius: 46 },
  body: { x: 1050, y: 22, width: 430, height: 905, radius: 64 },
});

const look = JSON.parse(fs.readFileSync(path.join(BRAND_DIR, "branding.json"), "utf8")).appearance;

const COLOUR = Object.freeze({
  deep: "#0a1626",
  bar: "#0b1a2e",
  primary: look.primary,
  ink: "#ffffff",
  soft: "#d9e0ea",
  muted: "#9fb0c6",
  blue: "#1c9bd7",
  bezel: "#111312",
});

const cache = new Map();
function dataUri(file, mime) {
  if (!cache.has(file)) cache.set(file, `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`);
  return cache.get(file);
}
const font = (family, pkg, file) =>
  `@font-face{font-family:"${family}";src:url("${dataUri(path.join(FONTS, pkg, "files", file), "font/woff2")}") format("woff2");font-weight:200 800}`;

/** The page chrome: built when a page is made, so requiring this file needs no font or photograph on disk. */
const baseCss = () => `
${font("Plus Jakarta Sans", "plus-jakarta-sans", "plus-jakarta-sans-latin-wght-normal.woff2")}
${font("Public Sans", "public-sans", "public-sans-latin-wght-normal.woff2")}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${SIZE.width}px;overflow:hidden;background:transparent}
body{font-family:"Public Sans";color:${COLOUR.ink};position:relative;-webkit-font-smoothing:antialiased}
.ground{position:absolute;inset:0;background:
  linear-gradient(100deg,rgba(10,22,38,.97) 0%,rgba(10,22,38,.9) 42%,rgba(10,22,38,.55) 100%),
  url("${dataUri(path.join(BRAND_DIR, "login-background.webp"), "image/webp")}") center 30%/cover,
  ${COLOUR.deep}}
.plain{position:absolute;inset:0;background:
  radial-gradient(900px 700px at 1650px 170px,rgba(245,130,31,.16) 0%,rgba(245,130,31,0) 70%),
  radial-gradient(800px 600px at 150px 960px,rgba(28,155,215,.16) 0%,rgba(28,155,215,0) 70%),
  ${COLOUR.deep}}
`;

const logo = () => `<img src="${dataUri(path.join(BRAND_DIR, "logo.webp"), "image/webp")}" alt="">`;

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function page(height, css, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss()}html,body{height:${height}px}${css}</style></head><body>${body}</body></html>`;
}

/**
 * The opening card, and the closing one with `closing`: the picture only, 1920 × 960. `title` and
 * `subtitle` are French; `english` repeats them in English under the rule, so a viewer who does not
 * read French knows what they are about to watch.
 */
/**
 * The title is one line at 128 px, as wide as the picture allows (1520 px between the margins): a longer one
 * shrinks to fit, its foot staying where a full-size title's would be. Plus Jakarta Sans ExtraBold sets about
 * 0.5 em a letter and the estimate leaves room for the wider ones (W, M): "Premiers pas" keeps 128 px and "Se connecter en toute sécurité" sets at 92.
 */
const titleSize = (title) => Math.min(128, Math.floor(1520 / (String(title).length * 0.55)));

function card({ eyebrow, title, subtitle, english, left, right = "JBS Praxis", rightLabel = "Conçu par", closing = false }) {
  const size = titleSize(title);
  const css = `
.logo{position:absolute;left:200px;top:96px;height:132px;padding:16px 30px;border-radius:26px;background:#fff;display:flex;align-items:center;box-shadow:0 12px 40px rgba(0,0,0,.35)}
.logo img{height:100px;width:auto;display:block}
.eyebrow{position:absolute;left:200px;top:292px;font:700 29px "Plus Jakarta Sans";letter-spacing:.16em;color:${COLOUR.primary};text-transform:uppercase}
h1{position:absolute;left:200px;top:${352 + Math.round((128 - size) * 1.05)}px;font:800 ${size}px/1.05 "Plus Jakarta Sans";letter-spacing:-.01em;white-space:nowrap}
.sub{position:absolute;left:200px;top:528px;font:500 42px "Public Sans";color:${COLOUR.soft}}
.en{position:absolute;left:200px;top:596px;font:400 33px "Public Sans";color:${COLOUR.muted}}
.rule{position:absolute;left:200px;top:672px;width:175px;height:10px;border-radius:5px;background:${COLOUR.primary}}
.foot{position:absolute;left:200px;right:200px;top:822px;display:flex;justify-content:space-between;font:400 30px "Public Sans";color:${COLOUR.muted}}
.foot b{color:${COLOUR.primary};font-weight:700}`;
  return page(SIZE.picture, css, `<div class="ground"></div>
<div class="logo">${logo()}</div>
<div class="eyebrow">${esc(eyebrow)}</div>
<h1 data-closing="${closing}">${esc(title)}</h1>
<div class="sub">${esc(subtitle)}</div>
<div class="en">${esc(english)}</div>
<div class="rule"></div>
<div class="foot"><span>${esc(left)}</span><span>${esc(rightLabel)} <b>${esc(right)}</b></span></div>`);
}

/** The ground a phone sits on, with its label on the left and the phone's body; the screen is cut out. */
function phoneGround({ eyebrow, title, subtitle }) {
  const s = PHONE.screen;
  const b = PHONE.body;
  const css = `
.label{position:absolute;left:150px;top:330px;width:820px}
.label .eyebrow{font:700 25px "Plus Jakarta Sans";letter-spacing:.14em;color:${COLOUR.primary};text-transform:uppercase}
.label h2{margin-top:17px;font:800 60px/1.1 "Plus Jakarta Sans";letter-spacing:-.005em}
.label p{margin-top:19px;font:400 28px "Public Sans";color:${COLOUR.soft}}
.body{position:absolute;left:${b.x}px;top:${b.y}px;width:${b.width}px;height:${b.height}px;border-radius:${b.radius}px;
  background:${COLOUR.bezel};box-shadow:0 0 0 2px #2c302e,0 30px 80px rgba(0,0,0,.45)}
.hole{position:absolute;left:${s.x}px;top:${s.y}px;width:${s.width}px;height:${s.height}px;border-radius:${s.radius}px;
  box-shadow:0 0 0 30px ${COLOUR.bezel};background:#fff}`;
  return page(SIZE.picture, css, `<div class="plain"></div>
<div class="label"><div class="eyebrow">${esc(eyebrow)}</div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div>
<div class="body"></div><div class="hole"></div>`);
}

/** The phone's rim, drawn over the filmed screen so its corners are rounded: transparent elsewhere. */
function phoneRim() {
  const s = PHONE.screen;
  const css = `.hole{position:absolute;left:${s.x}px;top:${s.y}px;width:${s.width}px;height:${s.height}px;border-radius:${s.radius}px;
  box-shadow:0 0 0 30px ${COLOUR.bezel}}`;
  return page(SIZE.picture, css, `<div class="hole"></div>`);
}

/**
 * The caption bar. The English subtitle is centred; on the left, "CHAPITRE 2 SUR 9" over the chapter's
 * French name and, smaller, its English one. 1920 × 120.
 */
function bar({ number, total, chapter, chapterEn, caption }) {
  const css = `
.bar{position:absolute;inset:0;background:${COLOUR.bar};border-top:3px solid ${COLOUR.primary}}
.chapter{position:absolute;left:40px;top:18px;width:300px}
.chapter .n{font:700 15px "Plus Jakarta Sans";letter-spacing:.14em;color:${COLOUR.primary};text-transform:uppercase}
.chapter .t{margin-top:7px;font:700 19px "Plus Jakarta Sans";color:${COLOUR.ink};white-space:nowrap}
.chapter .e{margin-top:3px;font:400 15px "Public Sans";color:${COLOUR.muted};white-space:nowrap}
.caption{position:absolute;left:340px;right:340px;top:0;bottom:0;display:flex;align-items:center;justify-content:center;text-align:center;font:400 27px/1.3 "Public Sans";color:#f2f4f7}`;
  return page(SIZE.bar, css, `<div class="bar"></div>
<div class="chapter"><div class="n">Chapitre ${number} sur ${total}</div><div class="t">${esc(chapter)}</div><div class="e">${esc(chapterEn)}</div></div>
<div class="caption">${esc(caption)}</div>`);
}

module.exports = { ROOT, SIZE, DESKTOP, PHONE, COLOUR, card, titleSize, phoneGround, phoneRim, bar, esc };
