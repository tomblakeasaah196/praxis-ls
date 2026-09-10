import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { StagedLines, PullQuote, FigureCallout } from "@/components/ui/type";

/**
 * The accessibility hazard these components create, and the proof they defuse
 * it.
 *
 * Fragmenting a heading into one element per word is fine for a sighted reader
 * and a real problem for assistive technology, which can announce the result a
 * word at a time — "Freight. That. Moves. Your. Business." — with a pause
 * between each. That is the standard way this effect ships broken, it is
 * invisible to everyone who builds it, and it lands on exactly the visitors
 * least able to work around it.
 *
 * So the container carries the whole string and the fragments are hidden. These
 * tests pin that, and they pin the reduced-motion contract that `Reveal`
 * established: the settled state, not a faster animation.
 */

type Entry = { target: Element; isIntersecting: boolean };
let fire: (entries: Entry[]) => void = () => {};

class FakeObserver {
  constructor(cb: (e: Entry[]) => void) {
    fire = cb;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

const setReducedMotion = (matches: boolean) =>
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("reduce") ? matches : false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));

beforeEach(() => {
  setReducedMotion(false);
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});
afterEach(() => vi.unstubAllGlobals());

describe("StagedLines", () => {
  it("announces the whole sentence, not one word at a time", () => {
    render(<StagedLines as="h1" text="Freight that moves your business" />);
    // One accessible name, the full sentence.
    const heading = screen.getByRole("heading", {
      name: "Freight that moves your business",
    });
    // And every visual fragment is hidden from the accessibility tree, so the
    // name above is the ONLY thing announced.
    const words = heading.querySelectorAll(".staged-word");
    expect(words.length).toBe(5);
    for (const w of words) expect(w).toHaveAttribute("aria-hidden");
  });

  it("keeps the words separated when they are laid out inline-block", () => {
    // `display: inline-block` collapses whitespace between elements, so the
    // spaces have to survive as real text nodes or the headline renders as
    // "Freightthatmoves".
    render(<StagedLines as="h2" text="Sea freight import" />);
    const heading = screen.getByRole("heading");
    expect(heading.textContent).toBe("Sea freight import");
  });

  it("caps the total stagger so a long headline stays inside the narrative budget", () => {
    // Twelve words at the default 45ms would be 495ms of stagger PLUS each
    // word's own 420ms transition — comfortably past the 600ms ceiling that
    // check-motion.mjs enforces. The step shrinks instead of the phrase
    // overrunning.
    const text = "one two three four five six seven eight nine ten eleven twelve";
    render(<StagedLines as="h2" text={text} />);
    act(() => fire([{ target: screen.getByRole("heading"), isIntersecting: true }]));

    const words = screen.getByRole("heading").querySelectorAll<HTMLElement>(".staged-word");
    const last = words[words.length - 1];
    const delay = parseInt(last.style.transitionDelay || "0", 10);
    expect(delay).toBeLessThanOrEqual(420);
  });

  it("renders settled immediately under reduced motion", () => {
    setReducedMotion(true);
    render(<StagedLines as="h2" text="Track a shipment" />);
    const words = screen.getByRole("heading").querySelectorAll(".staged-word");
    // `is-in` is the settled class; under reduced motion it is present on the
    // first paint, with no observer and nothing to wait for.
    for (const w of words) expect(w.className).toContain("is-in");
  });
});

describe("PullQuote", () => {
  it("attributes a quote as a figure rather than as loose small text", () => {
    render(<PullQuote cite="Timothée Massomba, CEO">Logistics is a strategic driver of trade.</PullQuote>);
    const figure = screen.getByRole("figure");
    expect(figure).toContainElement(screen.getByText("Timothée Massomba, CEO"));
  });

  it("omits the caption entirely when there is no attribution", () => {
    // An empty <figcaption> is announced as a caption with no content, which is
    // worse than no caption.
    const { container } = render(<PullQuote>No attribution here.</PullQuote>);
    expect(container.querySelector("figcaption")).toBeNull();
  });
});

describe("FigureCallout", () => {
  it("renders the value, label and optional sublabel", () => {
    render(<FigureCallout value="2021" label="Operating since" sublabel="Douala" />);
    expect(screen.getByText("2021")).toBeInTheDocument();
    expect(screen.getByText("Operating since")).toBeInTheDocument();
    expect(screen.getByText("Douala")).toBeInTheDocument();
  });

  it("asserts nothing on its own", () => {
    // N12: the component supplies presentation, never a fact. If this ever
    // grows a default value, a tenant who set none would be publishing a number
    // this codebase invented.
    const { container } = render(<FigureCallout value="" label="" />);
    expect(container.textContent).toBe("");
  });
});
