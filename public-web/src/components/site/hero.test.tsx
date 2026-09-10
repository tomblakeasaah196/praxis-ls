import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Hero, HERO_SCRIMS, SCRIM_FLOOR } from "./hero";
import { RouteCanvas } from "./route-canvas";

/**
 * The hero — the LCP element, and the one band whose contrast was MEASURED
 * rather than eyeballed.
 *
 * ── WHY THE SCRIM TESTS EXIST ──────────────────────────────────────────────
 *
 * Guide §7.1 says any new treatment of this band must "re-derive [the scrim's
 * opacities] or keep them". Before this file those numbers lived in a comment,
 * which is a rule with nothing enforcing it: the next person to make a tenant's
 * photograph more visible nudges a percentage in a gradient string, every test
 * still passes, and an eyebrow at 3.1:1 ships. The floor is a constant now and
 * these assert against it.
 */

/** jsdom has no matchMedia. Each test says which world it is in, because the
 *  whole reduced-motion contract is "a different render", not "a faster one". */
function setMotion(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? reduced : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

describe("the scrim floors", () => {
  it("holds every stop that sits under copy at or above the binding floor", () => {
    // The eyebrow binds at 0.87 — small text, #ff5a00, 4.5:1 against a
    // near-white upload. A stop below this is a contrast failure on the one
    // band a visitor sees before anything else.
    for (const scrim of [HERO_SCRIMS.stacked, HERO_SCRIMS.split]) {
      for (const stop of scrim.stops) {
        if (stop.over) expect(stop.alpha).toBeGreaterThanOrEqual(SCRIM_FLOOR);
      }
    }
  });

  it("still lets the photograph through where copy is not", () => {
    // The other half of the requirement, and the reason this is two layers.
    // A scrim that met the floor everywhere would be the flat wash this band
    // was rescued from: safe, and a black rectangle.
    const openStops = [...HERO_SCRIMS.stacked.stops, ...HERO_SCRIMS.split.stops]
      .filter((s) => !s.over);
    expect(openStops.length).toBeGreaterThan(0);
    for (const stop of openStops) expect(stop.alpha).toBeLessThan(0.7);
  });

  it("paints from the band's own ground token, never a literal", () => {
    // A colour typed in here is a colour a tenant re-brand cannot move.
    const css = HERO_SCRIMS.css(HERO_SCRIMS.split);
    expect(css).toContain("var(--hero)");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\brgba?\(/);
  });
});

describe("the hero", () => {
  beforeEach(() => setMotion(false));
  afterEach(cleanup);

  const renderHero = () =>
    render(
      <MemoryRouter>
        <Hero />
      </MemoryRouter>,
    );

  it("announces its headline as ONE heading, not a word at a time", () => {
    // `StagedLines` fragments the line into spans so each can carry its own
    // delay. Every fragment is aria-hidden and the whole string is on the
    // container as aria-label, so assistive technology reads a sentence.
    renderHero();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toBeTruthy();
    expect(h1.textContent?.trim().length).toBeGreaterThan(0);
    const staged = h1.querySelector(".staged");
    // Named by real text in a visually-hidden span, NOT by `aria-label` — ARIA
    // prohibits that attribute on a generic element, and with every fragment
    // aria-hidden the heading would announce as empty.
    expect(staged?.hasAttribute("aria-label")).toBe(false);
    expect(staged?.querySelector(".sr-only")?.textContent?.trim()).toBeTruthy();
    // Every animated fragment is hidden from the accessibility tree.
    for (const word of h1.querySelectorAll(".staged-word")) {
      expect(word.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("keeps exactly one h1", () => {
    // N10, and the reason every band below the hero is an h2.
    renderHero();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});

describe("the route canvas", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("schedules no frame loop under reduced motion", () => {
    // The settled state, drawn once. §1.2 rule 1 is not "a shorter animation",
    // and a rAF loop running for somebody who asked their system to stop moving
    // things is the exact thing it forbids.
    setMotion(true);
    const raf = vi.spyOn(window, "requestAnimationFrame");
    render(<RouteCanvas />);
    expect(raf).not.toHaveBeenCalled();
  });

  it("draws a frame anyway under reduced motion, rather than nothing", () => {
    // "Settled" means the finished composition — cargo distributed along the
    // lanes. A blank rectangle would be a fallback, not a designed state.
    setMotion(true);
    const calls: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === "setTransform" || key === "clearRect") return () => calls.push(key);
          return typeof key === "string" ? () => calls.push(key) : undefined;
        },
        set: () => true,
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    );
    render(<RouteCanvas />);
    expect(calls).toContain("arc");
    expect(calls).toContain("stroke");
  });

  it("is hidden from assistive technology and takes no pointer events", () => {
    // Decoration behind a headline. It asserts nothing a screen reader needs,
    // and a decoration that ate clicks on the hero's own buttons would be the
    // worst possible trade.
    setMotion(false);
    const { container } = render(<RouteCanvas />);
    const host = container.firstElementChild as HTMLElement;
    expect(host.getAttribute("aria-hidden")).toBe("true");
    expect(host.className).toContain("pointer-events-none");
  });
});
