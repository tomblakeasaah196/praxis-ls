import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Under an overlaying header (`PageShell overlayHeader`, every page with a
 * photograph since 25 Nov 2026) the bar re-points `--foreground` to the hero's
 * light ink. A control on the bar that paints the PAGE's ground (`btn-surface`,
 * `bg-card`, `bg-background`) then draws light ink on white: the phone menu
 * button did exactly that, a white square with the lines invisible, found on
 * staging the day every page gained the overlay.
 *
 * The bar's controls take an ink-following style instead (`btn-outline`, or
 * the theme toggle's `onDark` variant). The two surfaces that open FROM the
 * bar and paint the page's ground, the Services panel and the phone drawer,
 * hand the page's ink back in index.css, and `check:contrast` holds that half.
 */
const header = readFileSync(join(__dirname, "site-header.tsx"), "utf8");

describe("the header's controls follow the bar's ink", () => {
  it("draws no page-ground control on the bar", () => {
    const offenders = header
      .split("\n")
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => /className=.*\b(btn-surface|bg-card|bg-background)\b/.test(line))
      // The drawer paints the page's ground on purpose and gets the page's ink
      // back (`.site-shell[data-overlay="true"] .site-drawer` in index.css).
      .filter(([, line]) => !/\bsite-drawer\b/.test(line))
      .map(([n, line]) => `site-header.tsx:${n} ${line.trim()}`);
    expect(offenders).toEqual([]);
  });

  it("passes onDark to the theme toggle so it takes the hero's ink over the band", () => {
    expect(header).toMatch(/<ThemeToggle onDark=\{overlay\} \/>/);
  });
});
