import { describe, it, expect } from "vitest";
import {
  periodFor, lastClosedDay, windowDays, windowError, MAX_WINDOW_DAYS,
} from "./attendance-period";

/** A Thursday, mid-month, mid-quarter — nothing special about any boundary. */
const NOW = new Date("2026-08-20T09:15:00Z");

describe("lastClosedDay", () => {
  it("is yesterday — today is never reconciled", () => {
    expect(lastClosedDay(NOW).toISOString().slice(0, 10)).toBe("2026-08-19");
  });

  it("steps back across a month boundary", () => {
    expect(lastClosedDay(new Date("2026-09-01T00:30:00Z")).toISOString().slice(0, 10)).toBe("2026-08-31");
  });
});

describe("periodFor", () => {
  it("7d is seven days inclusive of the end", () => {
    const p = periodFor("7d", NOW);
    expect(p).toEqual({ from: "2026-08-13", to: "2026-08-19" });
    expect(windowDays(p)).toBe(7);
  });

  it("month runs from the 1st to the last closed day", () => {
    expect(periodFor("month", NOW)).toEqual({ from: "2026-08-01", to: "2026-08-19" });
  });

  it("quarter starts at the quarter's first month", () => {
    // August sits in Jul–Sep.
    expect(periodFor("quarter", NOW)).toEqual({ from: "2026-07-01", to: "2026-08-19" });
    expect(periodFor("quarter", new Date("2026-02-10T00:00:00Z")).from).toBe("2026-01-01");
    expect(periodFor("quarter", new Date("2026-11-10T00:00:00Z")).from).toBe("2026-10-01");
  });

  it("year starts on 1 January", () => {
    expect(periodFor("year", NOW)).toEqual({ from: "2026-01-01", to: "2026-08-19" });
  });

  it("never asks for more than the server's cap, even on 31 December", () => {
    for (const at of ["2026-12-31T23:00:00Z", "2028-12-31T23:00:00Z", "2029-01-01T00:30:00Z"]) {
      const p = periodFor("year", new Date(at));
      expect(windowDays(p)).toBeLessThanOrEqual(MAX_WINDOW_DAYS);
      expect(windowError(p)).toBeNull();
    }
  });

  it("shows a full previous month on the 1st, not an empty new one", () => {
    // 1 Aug: the last closed day is 31 Jul, so "Month" means the whole of July.
    // Deriving the period from `to` rather than from today is what avoids an
    // empty August-to-date on the one morning a month somebody would see it.
    const p = periodFor("month", new Date("2026-08-01T08:00:00Z"));
    expect(p).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(windowError(p)).toBeNull();
  });

  it("does the same across a year boundary", () => {
    expect(periodFor("year", new Date("2027-01-01T08:00:00Z"))).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });

  it("does not depend on the browser's local calendar", () => {
    // Same instant, two zones' worth of local date — the window must not move.
    const a = periodFor("month", new Date("2026-08-20T00:30:00Z"));
    const b = periodFor("month", new Date("2026-08-20T23:30:00Z"));
    expect(a).toEqual(b);
  });
});

describe("windowError", () => {
  it("accepts a normal window", () => {
    expect(windowError({ from: "2026-08-01", to: "2026-08-31" })).toBeNull();
  });

  it("rejects a reversed window", () => {
    expect(windowError({ from: "2026-08-31", to: "2026-08-01" })).toMatch(/must not precede/i);
  });

  it("rejects more than a year, matching the server", () => {
    expect(windowError({ from: "2026-01-01", to: "2027-01-03" })).toMatch(/at most a year/i);
    expect(windowError({ from: "2028-01-01", to: "2028-12-31" })).toBeNull();
  });

  it("rejects a missing or malformed bound before it reaches the server", () => {
    expect(windowError({ from: "", to: "2026-08-31" })).toMatch(/both ends/i);
    expect(windowError({ from: "01/08/2026", to: "2026-08-31" })).toMatch(/YYYY-MM-DD/);
  });
});
