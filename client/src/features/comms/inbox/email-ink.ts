/**
 * The colours an email is drawn against, read from the tenant's live tokens.
 *
 * A frame does not inherit the app's stylesheet, so it cannot say
 * `text-foreground`. It is handed the RESOLVED values instead, read here from
 * probe elements carrying the same token classes the reading pane uses. That
 * keeps the frame white-labelled: a tenant whose foreground is a deep green
 * gets deep-green text in an unstyled email, and dark mode recolours a white
 * email onto that tenant's own card colour, not a charcoal of ours.
 *
 * Re-read whenever the theme flips, which `theme-mode.ts` signals by toggling
 * `.dark` on <html>.
 */
import * as React from "react";
import type { EmailInk } from "./email-doc";
import type { DarkTheme, Rgb } from "./email-dark";

/**
 * Only for a document with no stylesheet (a unit test, a print preview before
 * CSS lands). They mirror the shell's neutral tokens; a running app always
 * reads the real ones.
 */
const FALLBACK: Record<"light" | "dark", { ink: EmailInk; card: Rgb; fg: Rgb }> = {
  light: {
    ink: { fg: "rgb(24, 24, 27)", link: "rgb(29, 78, 216)", rule: "rgb(212, 212, 216)", font: "system-ui, sans-serif" },
    card: [255, 255, 255],
    fg: [24, 24, 27],
  },
  dark: {
    ink: { fg: "rgb(228, 228, 231)", link: "rgb(147, 197, 253)", rule: "rgb(63, 63, 70)", font: "system-ui, sans-serif" },
    card: [24, 24, 27],
    fg: [228, 228, 231],
  },
};

/** `rgb(…)`/`rgba(…)` as computed by the browser → channels and alpha, or null if absent. */
function rgbaOf(computed: string): { rgb: Rgb; alpha: number } | null {
  const m = /^rgba?\(([^)]*)\)$/.exec(String(computed || "").trim());
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some((x) => !Number.isFinite(x))) return null;
  const alpha = parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1;
  if (alpha === 0) return null;
  return { rgb: [parts[0], parts[1], parts[2]], alpha };
}
const rgbOf = (computed: string): Rgb | null => rgbaOf(computed)?.rgb || null;

/**
 * A translucent token flattened onto the surface it sits on. `--border` is a
 * 9-11% wash of the foreground, and drawn opaque inside the frame it would be a
 * bright line where the app shows a faint one.
 */
function over(computed: string, surface: Rgb): Rgb | null {
  const c = rgbaOf(computed);
  if (!c) return null;
  return c.rgb.map((v, i) => Math.round(v * c.alpha + surface[i] * (1 - c.alpha))) as Rgb;
}

export function useIsDark(): boolean {
  const [dark, setDark] = React.useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  React.useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export type EmailPalette = {
  scheme: "light" | "dark";
  ink: EmailInk;
  /** The recolouring anchors, in dark mode only. Light mode draws the original. */
  dark: DarkTheme | null;
};

function read(scheme: "light" | "dark"): EmailPalette {
  const fb = FALLBACK[scheme];
  if (typeof document === "undefined" || !document.body) {
    return { scheme, ink: fb.ink, dark: scheme === "dark" ? { bg: fb.card, fg: fb.fg } : null };
  }
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden";
  probe.innerHTML = '<span class="bg-card text-foreground border border-border"></span><span class="text-primary-ink"></span>';
  document.body.appendChild(probe);
  try {
    const [surface, link] = Array.from(probe.children) as HTMLElement[];
    const s = getComputedStyle(surface);
    const card = rgbOf(s.backgroundColor) || fb.card;
    const fg = rgbOf(s.color) || fb.fg;
    const linkRgb = rgbOf(getComputedStyle(link).color);
    const rule = over(s.borderTopColor, card);
    const font = getComputedStyle(document.body).fontFamily;
    const css = (c: Rgb) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    return {
      scheme,
      ink: {
        fg: css(fg),
        link: linkRgb ? css(linkRgb) : fb.ink.link,
        rule: rule ? css(rule) : fb.ink.rule,
        // The tenant's web font cannot load inside the frame, so the system
        // stack follows it and is what an unstyled email actually gets.
        font: font ? `${font}, system-ui, sans-serif` : fb.ink.font,
      },
      dark: scheme === "dark" ? { bg: card, fg } : null,
    };
  } finally {
    probe.remove();
  }
}

/** The palette for the current theme, re-read when it changes. */
export function useEmailPalette(): EmailPalette {
  const isDark = useIsDark();
  const scheme = isDark ? "dark" : "light";
  // Memoised on the scheme so a frame's srcdoc is stable across renders: a new
  // object here would rebuild every open message's document on every keystroke.
  return React.useMemo(() => read(scheme), [scheme]);
}
