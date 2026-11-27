import { describe, expect, it } from "vitest";
import { wideGridClass } from "@/components/site/section";

/**
 * From 1536px a card grid goes to four columns, and a grid of fewer cards
 * than that left empty columns on the right: a service family of three drew
 * three cards and a blank fourth slot at 1920px. The column count at that
 * width now follows the number of cards.
 */
const columns = (count: number) =>
  Number(/^2xl:grid-cols-(\d)$/.exec(wideGridClass(count))?.[1]);

describe("the wide card grid", () => {
  it("gives two or three cards that many columns, so they share the width", () => {
    expect(wideGridClass(2)).toBe("2xl:grid-cols-2");
    expect(wideGridClass(3)).toBe("2xl:grid-cols-3");
  });

  it("keeps four columns from four cards up", () => {
    for (const count of [4, 5, 7, 8, 12]) {
      expect(wideGridClass(count)).toBe("2xl:grid-cols-4");
    }
  });

  it("keeps a single card the size of one card, not stretched across the frame", () => {
    expect(wideGridClass(1)).toBe("2xl:grid-cols-4");
  });

  it("never leaves an empty column for two cards or more", () => {
    for (let count = 2; count <= 12; count += 1) {
      expect(columns(count)).toBeLessThanOrEqual(count);
    }
  });

  it("changes only the 2xl step, so every narrower screen renders as before", () => {
    // The grids keep their own `sm:` and `lg:` classes; this helper must never
    // hand back anything that applies below 1536px.
    for (let count = 0; count <= 12; count += 1) {
      expect(wideGridClass(count)).toMatch(/^2xl:grid-cols-[234]$/);
    }
  });
});
