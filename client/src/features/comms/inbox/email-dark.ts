/**
 * An email, recoloured for dark mode the way new Outlook does it.
 *
 * ── THE DECISION (owner, 15 Oct 2026) ───────────────────────────────────────
 *
 * Follow the reader's mode. In light mode a message is drawn exactly as its
 * sender made it. In dark mode it is recoloured, as new Outlook and Outlook on
 * the web do, and there is no per-message switch back: the app already has a
 * light mode, and that is the way to see the original.
 *
 * ── WHAT "RECOLOURED" MEANS, PRECISELY ──────────────────────────────────────
 *
 * Outlook's partial inversion, which only moves the colours that would be
 * wrong on a dark page and leaves everything else alone:
 *
 *   · a LIGHT background (white page, pale panel) becomes dark;
 *   · DARK text (black, charcoal, navy) becomes light;
 *   · a border goes whichever way its own lightness says;
 *   · a colour that is already dark as a background, or already light as text,
 *     is NOT touched. That is what keeps a brand intact: a dark-green header
 *     with gold type is already a dark-mode design, and both of its colours
 *     come through exactly as sent;
 *   · images are never touched. A logo is the sender's artwork.
 *
 * Hue is kept and lightness is mirrored in OKLab, which is perceptual, so a
 * pale yellow note becomes a dark ochre rather than a muddy grey, and navy
 * text becomes a light blue rather than a white.
 *
 * ── ANCHORED TO THE TENANT'S OWN TOKENS ─────────────────────────────────────
 *
 * White does not become a fixed charcoal. It becomes the tenant's card colour
 * (read from the live CSS by the caller), and black becomes the tenant's
 * foreground, so a recoloured email sits on the same surface as everything
 * around it in a white-labelled shell. The curve is continuous at the
 * midpoint, so no two neighbouring shades swap places.
 *
 * ── A SENDER WHO ALREADY DESIGNED FOR DARK IS LEFT ALONE ────────────────────
 *
 * A stylesheet carrying `prefers-color-scheme` brings its own dark design.
 * Recolouring over it would invert colours the designer already inverted, so
 * such a message is returned unchanged and the frame lets its media query run.
 *
 * ── WHY THIS DOES NOT USE REGEXES OVER CSS ──────────────────────────────────
 *
 * Declarations are found by a character scanner that respects quotes and
 * parentheses, for the reason `message-body.ts` gives about HTML: a pattern
 * that "mostly" finds a declaration fails silently, and a quadratic one is a
 * hang the sender can trigger. The only patterns here match a single colour
 * token, with no nested quantifier.
 */

export type Rgb = [number, number, number];

/** The two anchors: the surface a light background lands on, and the ink dark text becomes. */
export type DarkTheme = { bg: Rgb; fg: Rgb };

/* ── colour maths ─────────────────────────────────────────────────────────── */

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (c: number) => {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
};

/** sRGB → OKLab (Björn Ottosson's matrices). */
export function toOklab([r, g, b]: Rgb): [number, number, number] {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab → sRGB, clamped into gamut. */
export function fromOklab([L, a, b]: [number, number, number]): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export type Role = "bg" | "fg" | "border";

/**
 * Where one colour lands in dark mode. Returns the input unchanged when it is
 * already right for a dark page in that role.
 */
/**
 * Chroma past which a BORDER is an accent (a brand's gold rule) rather than a
 * page divider (#e5e7eb). A divider must darken with the page or it glares; an
 * accent line is the sender's colour and stays it. Borders only: a coloured
 * BACKGROUND keeps being recoloured, because text drawn on it is recoloured
 * too, and keeping one without the other is how light text lands on a bright
 * panel.
 */
const ACCENT_CHROMA = 0.06;

export function mapColour(rgb: Rgb, role: Role, theme: DarkTheme): Rgb {
  const [L, a, b] = toOklab(rgb);
  if (role === "border" && Math.hypot(a, b) >= ACCENT_CHROMA) return rgb;
  const asBackground = role === "bg" || (role === "border" && L > 0.5);
  if (asBackground) {
    if (L <= 0.5) return rgb;
    // L in (0.5, 1] → (mid, card]: white lands exactly on the card colour. The
    // card's own tint is added in proportion to how close to white the colour
    // was, so a neutral page takes the tenant's surface while a coloured panel
    // keeps its hue (a pale yellow note becomes a dark ochre, not a grey).
    const [cardL, cardA, cardB] = toOklab(theme.bg);
    const k = Math.max(0, (0.5 - cardL) / 0.5);
    const t = (L - 0.5) / 0.5;
    return fromOklab([cardL + (1 - L) * k, a * 0.85 + cardA * t, b * 0.85 + cardB * t]);
  }
  if (L >= 0.5) return rgb;
  // L in [0, 0.5) → (mid, ink]: black lands exactly on the foreground, by the
  // same reasoning mirrored.
  const [inkL, inkA, inkB] = toOklab(theme.fg);
  const k = Math.max(0, (inkL - 0.5) / 0.5);
  const t = (0.5 - L) / 0.5;
  return fromOklab([inkL - L * k, a + inkA * t, b + inkB * t]);
}

/* ── colour tokens ────────────────────────────────────────────────────────── */

/** CSS named colours. The full list, because a partial one recolours some names and not others. */
const NAMED: Record<string, string> = {
  aliceblue: "f0f8ff", antiquewhite: "faebd7", aqua: "00ffff", aquamarine: "7fffd4", azure: "f0ffff",
  beige: "f5f5dc", bisque: "ffe4c4", black: "000000", blanchedalmond: "ffebcd", blue: "0000ff",
  blueviolet: "8a2be2", brown: "a52a2a", burlywood: "deb887", cadetblue: "5f9ea0", chartreuse: "7fff00",
  chocolate: "d2691e", coral: "ff7f50", cornflowerblue: "6495ed", cornsilk: "fff8dc", crimson: "dc143c",
  cyan: "00ffff", darkblue: "00008b", darkcyan: "008b8b", darkgoldenrod: "b8860b", darkgray: "a9a9a9",
  darkgreen: "006400", darkgrey: "a9a9a9", darkkhaki: "bdb76b", darkmagenta: "8b008b", darkolivegreen: "556b2f",
  darkorange: "ff8c00", darkorchid: "9932cc", darkred: "8b0000", darksalmon: "e9967a", darkseagreen: "8fbc8f",
  darkslateblue: "483d8b", darkslategray: "2f4f4f", darkslategrey: "2f4f4f", darkturquoise: "00ced1",
  darkviolet: "9400d3", deeppink: "ff1493", deepskyblue: "00bfff", dimgray: "696969", dimgrey: "696969",
  dodgerblue: "1e90ff", firebrick: "b22222", floralwhite: "fffaf0", forestgreen: "228b22", fuchsia: "ff00ff",
  gainsboro: "dcdcdc", ghostwhite: "f8f8ff", gold: "ffd700", goldenrod: "daa520", gray: "808080",
  green: "008000", greenyellow: "adff2f", grey: "808080", honeydew: "f0fff0", hotpink: "ff69b4",
  indianred: "cd5c5c", indigo: "4b0082", ivory: "fffff0", khaki: "f0e68c", lavender: "e6e6fa",
  lavenderblush: "fff0f5", lawngreen: "7cfc00", lemonchiffon: "fffacd", lightblue: "add8e6", lightcoral: "f08080",
  lightcyan: "e0ffff", lightgoldenrodyellow: "fafad2", lightgray: "d3d3d3", lightgreen: "90ee90", lightgrey: "d3d3d3",
  lightpink: "ffb6c1", lightsalmon: "ffa07a", lightseagreen: "20b2aa", lightskyblue: "87cefa",
  lightslategray: "778899", lightslategrey: "778899", lightsteelblue: "b0c4de", lightyellow: "ffffe0",
  lime: "00ff00", limegreen: "32cd32", linen: "faf0e6", magenta: "ff00ff", maroon: "800000",
  mediumaquamarine: "66cdaa", mediumblue: "0000cd", mediumorchid: "ba55d3", mediumpurple: "9370db",
  mediumseagreen: "3cb371", mediumslateblue: "7b68ee", mediumspringgreen: "00fa9a", mediumturquoise: "48d1cc",
  mediumvioletred: "c71585", midnightblue: "191970", mintcream: "f5fffa", mistyrose: "ffe4e1", moccasin: "ffe4b5",
  navajowhite: "ffdead", navy: "000080", oldlace: "fdf5e6", olive: "808000", olivedrab: "6b8e23",
  orange: "ffa500", orangered: "ff4500", orchid: "da70d6", palegoldenrod: "eee8aa", palegreen: "98fb98",
  paleturquoise: "afeeee", palevioletred: "db7093", papayawhip: "ffefd5", peachpuff: "ffdab9", peru: "cd853f",
  pink: "ffc0cb", plum: "dda0dd", powderblue: "b0e0e6", purple: "800080", rebeccapurple: "663399",
  red: "ff0000", rosybrown: "bc8f8f", royalblue: "4169e1", saddlebrown: "8b4513", salmon: "fa8072",
  sandybrown: "f4a460", seagreen: "2e8b57", seashell: "fff5ee", sienna: "a0522d", silver: "c0c0c0",
  skyblue: "87ceeb", slateblue: "6a5acd", slategray: "708090", slategrey: "708090", snow: "fffafa",
  springgreen: "00ff7f", steelblue: "4682b4", tan: "d2b48c", teal: "008080", thistle: "d8bfd8",
  tomato: "ff6347", turquoise: "40e0d0", violet: "ee82ee", wheat: "f5deb3", white: "ffffff",
  whitesmoke: "f5f5f5", yellow: "ffff00", yellowgreen: "9acd32",
};

type Parsed = { rgb: Rgb; alpha: number };

function parseHex(hex: string): Parsed | null {
  const h = hex.replace(/^#/, "");
  if (![3, 4, 6, 8].includes(h.length) || /[^0-9a-f]/i.test(h)) return null;
  const full = h.length <= 4 ? h.split("").map((c) => c + c).join("") : h;
  const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
  return { rgb: [n(0), n(2), n(4)], alpha: full.length === 8 ? n(6) / 255 : 1 };
}

/** A channel: `255`, `100%`. An alpha: `0.5`, `50%`. */
const channel = (v: string) => (v.endsWith("%") ? (parseFloat(v) / 100) * 255 : parseFloat(v));
const alphaOf = (v: string | undefined) => (v === undefined ? 1 : v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v));

function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** One colour token → rgb + alpha, or null for anything that is not a colour. */
export function parseColour(token: string): Parsed | null {
  const t = token.trim().toLowerCase();
  if (t.startsWith("#")) return parseHex(t);
  if (NAMED[t]) return parseHex(NAMED[t]);
  const fn = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(t);
  if (!fn) return null;
  const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  if (fn[1].startsWith("rgb")) {
    const rgb = parts.slice(0, 3).map(channel);
    if (rgb.some((x) => !Number.isFinite(x))) return null;
    return { rgb: rgb.map((x) => Math.round(Math.min(255, Math.max(0, x)))) as Rgb, alpha: alphaOf(parts[3]) };
  }
  const h = parseFloat(parts[0]);
  const s = parseFloat(parts[1]) / 100;
  const l = parseFloat(parts[2]) / 100;
  if (![h, s, l].every(Number.isFinite)) return null;
  return { rgb: hslToRgb(((h % 360) + 360) % 360, s, l), alpha: alphaOf(parts[3]) };
}

function formatColour({ rgb, alpha }: Parsed): string {
  if (alpha < 1) return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.round(alpha * 1000) / 1000})`;
  return `#${rgb.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Every colour inside one declaration's value, mapped.
 *
 * `url(…)` is passed over whole, so `url(red.png)` is not read as the colour
 * red, and a gradient's stops are each mapped in the same role as the
 * declaration that holds them.
 */
const TOKEN = /url\([^()]*\)|#[0-9a-f]{3,8}\b|(?:rgba?|hsla?)\([^()]*\)|\b[a-z]+\b/gi;

export function mapValue(value: string, role: Role, theme: DarkTheme): string {
  return value.replace(TOKEN, (tok) => {
    if (/^url\(/i.test(tok)) return tok;
    const parsed = parseColour(tok);
    if (!parsed) return tok;
    return formatColour({ rgb: mapColour(parsed.rgb, role, theme), alpha: parsed.alpha });
  });
}

/* ── declarations ─────────────────────────────────────────────────────────── */

/** Which properties carry a colour, and as what. */
function roleOf(prop: string): Role | null {
  if (prop === "color" || prop === "-webkit-text-fill-color" || prop === "caret-color" || prop === "text-decoration-color" || prop === "column-rule-color") {
    return "fg";
  }
  if (prop === "background" || prop === "background-color" || prop === "background-image") return "bg";
  if (prop === "outline" || prop === "outline-color" || prop.startsWith("border")) {
    // `border-radius`, `border-width`, `border-spacing` hold no colour; mapping
    // them is harmless (no token matches) but there is no reason to scan them.
    return /radius|width|spacing|collapse|style|image/.test(prop) ? null : "border";
  }
  return null;
}

/**
 * Split a declaration list on `;` at depth zero, outside quotes, and hand each
 * `prop: value` to `fn`. Whitespace and separators are preserved, so an
 * unchanged declaration comes back byte for byte.
 */
export function rewriteDeclarations(text: string, fn: (prop: string, value: string) => string | null): string {
  let out = "";
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  const flush = (end: number, sep: string) => {
    const piece = text.slice(start, end);
    const colon = topLevelColon(piece);
    if (colon === -1) {
      out += piece + sep;
      return;
    }
    const prop = piece.slice(0, colon).trim().toLowerCase();
    const value = piece.slice(colon + 1);
    const next = fn(prop, value);
    out += (next === null ? piece : piece.slice(0, colon + 1) + next) + sep;
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ";" && depth === 0) {
      flush(i, ";");
      start = i + 1;
    }
  }
  flush(text.length, "");
  return out;
}

function topLevelColon(piece: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < piece.length; i += 1) {
    const ch = piece[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ":" && depth === 0) return i;
  }
  return -1;
}

/** One declaration list (an inline `style`, or the inside of one CSS block). */
export function recolourDeclarations(text: string, theme: DarkTheme): string {
  return rewriteDeclarations(text, (prop, value) => {
    const role = roleOf(prop);
    return role ? mapValue(value, role, theme) : null;
  });
}

/**
 * A whole stylesheet. Each run of text between braces is treated as a
 * declaration list; a selector or an at-rule prelude in that position has no
 * colour property in it (`a:hover` reads as property `a`), so it passes
 * through untouched.
 */
export function recolourStylesheet(css: string, theme: DarkTheme): string {
  let out = "";
  let start = 0;
  let quote: string | null = null;
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{" || ch === "}") {
      out += recolourDeclarations(css.slice(start, i), theme) + ch;
      start = i + 1;
    }
  }
  return out + recolourDeclarations(css.slice(start), theme);
}

/* ── the document ─────────────────────────────────────────────────────────── */

/** Does this message bring its own dark design? */
export function hasOwnDarkMode(root: ParentNode): boolean {
  return Array.from(root.querySelectorAll("style")).some((s) => /prefers-color-scheme/i.test(s.textContent || ""));
}

/**
 * Recolour a parsed message body in place: inline styles, `bgcolor` and
 * `color` attributes, and every `<style>` block. Images are left alone.
 *
 * Operates on a fragment the caller already parsed inertly (`message-body.ts`
 * owns parsing), so a body is parsed once per render and not once per pass.
 */
export function recolourFragment(root: ParentNode, theme: DarkTheme): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    const tag = el.tagName.toLowerCase();
    if (tag === "style") {
      el.textContent = recolourStylesheet(el.textContent || "", theme);
      continue;
    }
    const style = el.getAttribute("style");
    if (style) el.setAttribute("style", recolourDeclarations(style, theme));
    const bg = el.getAttribute("bgcolor");
    if (bg) el.setAttribute("bgcolor", mapValue(bg, "bg", theme));
    const fg = el.getAttribute("color");
    if (fg) el.setAttribute("color", mapValue(fg, tag === "hr" ? "border" : "fg", theme));
  }
}
