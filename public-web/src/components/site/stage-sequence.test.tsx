import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StageSequence } from "./stage-sequence";

/**
 * The how-we-work sequence (§7.4).
 *
 * ── WHAT IS WORTH ASSERTING HERE ───────────────────────────────────────────
 *
 * The scrub itself is CSS driven by a custom property, so there is nothing
 * meaningful to assert about it in jsdom — and `motion.test.ts` already covers
 * the hook. What CAN go wrong, silently, is the contract between the two:
 *
 *   · a stage that cannot reach its arrival never lights, at any scroll
 *     position (the last one did exactly that until 26 Nov 2026);
 *   · a diagram that is not `aria-hidden` gets announced as an image with no
 *     description, which is worse than no diagram;
 *   · and the body copy fading with the decoration, which is the one thing that
 *     would turn a designed reveal into a contrast failure on real text.
 */

const stages = [
  { title: "You send the shipment", body: "Origin, destination, what you are moving." },
  { title: "We price and book", body: "Routing, carrier, customs, a written proposal." },
  { title: "You watch it move", body: "Milestones as they happen, on one reference." },
];

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});
afterEach(cleanup);

describe("the stage sequence", () => {
  it("gives every stage its own scrub, so the last one can light too", async () => {
    // It was one scrub over the list with `--at` 0, 0.5 and 1. A stage
    // arrives when the scrub passes its `--at` by an eighth, so the stage at 1
    // never arrived: "You Watch It Move" stayed faded at every scroll position
    // (owner's phone review, 26 Nov 2026). The test that stood here asserted
    // `--at: 1` for the last stage, i.e. the bug. Now each stage is scrubbed
    // on its own and nothing waits for a share of a list.
    const { container } = render(<StageSequence stages={stages} />);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const items = [...container.querySelectorAll(".stage-item")] as HTMLElement[];
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.style.getPropertyValue("--at")).toBe("");
      expect(item.style.getPropertyValue("--scrub")).not.toBe("");
    }
    expect(container.querySelector(".stage-seq")!.getAttribute("style")).toBeNull();
  });

  it("keeps every diagram out of the accessibility tree", () => {
    // The stage's meaning is entirely in its heading and sentence. A decorative
    // svg that is announced is a screen reader reading "image" three times.
    const { container } = render(<StageSequence stages={stages} />);
    const svgs = [...container.querySelectorAll("svg")];
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) expect(svg.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders every stage's real text, at any scroll position", () => {
    // The decoration fades; the copy never does. This is the assertion that
    // would fail if somebody moved the opacity from `.stage-figure` onto
    // `.stage-item`, which is the tempting simplification.
    render(<StageSequence stages={stages} />);
    for (const s of stages) {
      expect(screen.getByText(s.title)).toBeTruthy();
      expect(screen.getByText(s.body)).toBeTruthy();
    }
  });

  it("gives each stage a heading, so the band has an outline", () => {
    render(<StageSequence stages={stages} />);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(3);
  });

  it("cycles the diagram set rather than leaving a stage without one", () => {
    // A tenant with four steps must not get three pictures and a gap.
    const four = [...stages, { title: "It arrives", body: "Proof of delivery on the file." }];
    const { container } = render(<StageSequence stages={four} />);
    expect(container.querySelectorAll(".stage-figure svg")).toHaveLength(4);
  });
});
