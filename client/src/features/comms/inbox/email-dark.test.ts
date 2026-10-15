/**
 * Outlook-style dark recolouring (owner decision, 15 Oct 2026).
 *
 * The rules that matter are the ones a reader would notice going wrong: white
 * pages turn into the tenant's card, black text into the tenant's ink, and a
 * colour that is already right for a dark page (a brand's dark header, its gold
 * type) comes through exactly as the sender chose it.
 */
import { describe, expect, it } from "vitest";
import {
  hasOwnDarkMode,
  mapColour,
  mapValue,
  parseColour,
  recolourDeclarations,
  recolourFragment,
  recolourStylesheet,
  toOklab,
  type DarkTheme,
  type Rgb,
} from "./email-dark";

const THEME: DarkTheme = { bg: [24, 27, 31], fg: [230, 230, 233] };
const L = (rgb: Rgb) => toOklab(rgb)[0];
const near = (a: Rgb, b: Rgb) => a.every((x, i) => Math.abs(x - b[i]) <= 2);

describe("mapColour", () => {
  it("a white background lands on the tenant's card colour", () => {
    expect(near(mapColour([255, 255, 255], "bg", THEME), THEME.bg)).toBe(true);
  });

  it("black text lands on the tenant's foreground", () => {
    expect(near(mapColour([0, 0, 0], "fg", THEME), THEME.fg)).toBe(true);
  });

  it("the Beautiful Fabrics header survives untouched: dark green ground, gold type", () => {
    const emerald: Rgb = [11, 61, 46];
    const gold: Rgb = [201, 162, 39];
    expect(mapColour(emerald, "bg", THEME)).toEqual(emerald);
    expect(mapColour(gold, "fg", THEME)).toEqual(gold);
  });

  it("lighter originals become darker backgrounds, never the other way round", () => {
    const greys = [255, 240, 220, 200, 180, 160, 140].map((v) => mapColour([v, v, v], "bg", THEME));
    for (let i = 1; i < greys.length; i += 1) expect(L(greys[i])).toBeGreaterThanOrEqual(L(greys[i - 1]) - 1e-6);
  });

  it("darker text becomes lighter text, and stays readable on the card", () => {
    const navy = mapColour([0, 0, 128], "fg", THEME);
    expect(L(navy)).toBeGreaterThan(0.6);
    // Hue kept: navy becomes a light BLUE, not a white.
    expect(navy[2]).toBeGreaterThan(navy[0]);
  });

  it("an accent border keeps the sender's colour; a neutral divider darkens with the page", () => {
    const gold: Rgb = [189, 157, 87];
    expect(mapColour(gold, "border", THEME)).toEqual(gold);
    expect(L(mapColour([232, 223, 200], "border", THEME))).toBeLessThan(0.5);
  });

  it("a border goes whichever way its own lightness says", () => {
    expect(L(mapColour([229, 231, 235], "border", THEME))).toBeLessThan(0.5);
    expect(L(mapColour([17, 17, 17], "border", THEME))).toBeGreaterThan(0.5);
  });
});

describe("parseColour", () => {
  it.each([
    ["#fff", [255, 255, 255], 1],
    ["#0b3d2e", [11, 61, 46], 1],
    ["#00000080", [0, 0, 0], 128 / 255],
    ["rgb(1, 2, 3)", [1, 2, 3], 1],
    ["rgba(1,2,3,.5)", [1, 2, 3], 0.5],
    ["rgb(0 0 0 / 50%)", [0, 0, 0], 0.5],
    ["hsl(0, 100%, 50%)", [255, 0, 0], 1],
    ["White", [255, 255, 255], 1],
  ])("%s", (token, rgb, alpha) => {
    const p = parseColour(token);
    expect(p?.rgb).toEqual(rgb);
    expect(p?.alpha).toBeCloseTo(alpha as number, 3);
  });

  it("is null for anything that is not a colour", () => {
    for (const t of ["solid", "transparent", "inherit", "currentColor", "#ggg", "url(x)"]) {
      expect(parseColour(t)).toBeNull();
    }
  });
});

describe("mapValue", () => {
  it("maps each colour inside a shorthand and leaves the rest", () => {
    expect(mapValue(" 1px solid #000 ", "border", THEME)).toMatch(/^ 1px solid #[0-9a-f]{6} $/);
  });

  it("does not read a file name inside url() as a colour", () => {
    expect(mapValue("url(red.png) no-repeat white", "bg", THEME)).toMatch(/^url\(red\.png\) no-repeat #/);
  });

  it("keeps alpha", () => {
    expect(mapValue("rgba(255,255,255,0.5)", "bg", THEME)).toMatch(/^rgba\(\d+, \d+, \d+, 0\.5\)$/);
  });
});

describe("recolourDeclarations", () => {
  it("rewrites colour properties only, and returns everything else byte for byte", () => {
    const css = "font-weight: bold; letter-spacing:4px;color:#111;background-color:#fff !important";
    const out = recolourDeclarations(css, THEME);
    expect(out.startsWith("font-weight: bold; letter-spacing:4px;")).toBe(true);
    expect(out).toMatch(/color:#[0-9a-f]{6};background-color:#[0-9a-f]{6} !important$/);
    expect(out).not.toContain("#111");
  });

  it("respects quotes and parentheses when splitting", () => {
    const css = `content:"a;b";background:url("x;y.png") #fff`;
    const out = recolourDeclarations(css, THEME);
    expect(out).toContain(`content:"a;b"`);
    expect(out).toContain(`url("x;y.png")`);
    expect(out).not.toContain("#fff");
  });
});

describe("recolourStylesheet", () => {
  it("recolours rule bodies and leaves selectors with colons alone", () => {
    const out = recolourStylesheet("a:hover{color:#000}@media (max-width:600px){.x{background:#fff}}", THEME);
    expect(out.startsWith("a:hover{color:#")).toBe(true);
    expect(out).toContain("@media (max-width:600px){.x{background:#");
    expect(out).not.toMatch(/#000\b|#fff\b/);
  });
});

describe("the fragment", () => {
  const parse = (html: string) => {
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    return tpl.content;
  };

  it("recolours inline styles, bgcolor, <font color> and <style>, and never touches an image", () => {
    const root = parse(
      `<style>.p{color:#000}</style><table bgcolor="#ffffff"><tr><td style="color:#222">x</td></tr></table>`
      + `<font color="black">y</font><img src="cid:logo" style="width:10px">`,
    );
    recolourFragment(root, THEME);
    const html = (root.firstChild?.parentNode as DocumentFragment).childNodes;
    const box = document.createElement("div");
    box.append(...Array.from(html).map((n) => n.cloneNode(true)));
    const out = box.innerHTML;
    expect(out).not.toMatch(/#000\b|#ffffff|#222|"black"/);
    expect(out).toContain('src="cid:logo" style="width:10px"');
  });

  it("knows a message that brings its own dark design", () => {
    expect(hasOwnDarkMode(parse("<style>@media (prefers-color-scheme: dark){p{color:#fff}}</style>"))).toBe(true);
    expect(hasOwnDarkMode(parse("<style>p{color:#000}</style>"))).toBe(false);
  });
});
