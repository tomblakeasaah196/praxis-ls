import { describe, expect, it } from "vitest";
import { dayLabel, startsNewDay } from "./thread-days";

const at = (y: number, m: number, d: number, h = 12) =>
  new Date(y, m, d, h).toISOString();
const now = new Date(2026, 10, 27, 15);

describe("day labels", () => {
  it("says Today and Yesterday by the reader's own calendar", () => {
    expect(dayLabel(at(2026, 10, 27, 0), now)).toBe("Today");
    expect(dayLabel(at(2026, 10, 26, 23), now)).toBe("Yesterday");
  });

  it("names an older day day-first, never month-first", () => {
    expect(dayLabel(at(2026, 10, 3), now)).toMatch(/^03 Nov 2026$/);
  });
});

describe("where a day turns over", () => {
  it("opens the first message and each new day, and nothing else", () => {
    expect(startsNewDay(at(2026, 10, 26), undefined)).toBe(true);
    expect(startsNewDay(at(2026, 10, 26, 18), at(2026, 10, 26, 9))).toBe(false);
    expect(startsNewDay(at(2026, 10, 27, 1), at(2026, 10, 26, 23))).toBe(true);
  });

  it("ignores a message with no time rather than inventing a day for it", () => {
    expect(startsNewDay(null, at(2026, 10, 26))).toBe(false);
  });
});
