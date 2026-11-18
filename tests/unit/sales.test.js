"use strict";
const lead = require("../../src/modules/sales/lead/lead.rules");
const qr = require("../../src/modules/sales/quote_request/quote_request.rules");
const qrEvents = require("../../src/modules/sales/quote_request/quote_request.events");

describe("Sales funnel rules (MOD-20–26)", () => {
  test("a lead is OPEN or ARCHIVED, and every open one owes a next step but a client with nothing open", () => {
    // Lean revamp PR 2: the funnel moved onto each request's stage.
    expect(lead.STATUSES).toEqual(["OPEN", "ARCHIVED"]);
    expect(lead.owesNextStep({ status: "OPEN", client_id: null }, 0)).toBe(true);
    expect(lead.owesNextStep({ status: "OPEN", client_id: "c1" }, 1)).toBe(true);
    expect(lead.owesNextStep({ status: "OPEN", client_id: "c1" }, 0)).toBe(false);
    expect(lead.owesNextStep({ status: "ARCHIVED", client_id: null }, 3)).toBe(false);
  });

  test("a website request is due an answer within four WORKING hours", () => {
    // A UTC wall clock, so the arithmetic is the only thing under test.
    const parts = (at) => {
      const d = new Date(at);
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: d.getUTCDay() || 7 };
    };
    const instant = (x) => new Date(Date.UTC(x.year, x.month - 1, x.day, x.hour, x.minute));
    const at = (iso) => lead.addWorkingHours(new Date(iso), 4, { parts, instant }).toISOString();
    // Tuesday 10:00 → 14:00 the same day.
    expect(at("2026-11-17T10:00:00Z")).toBe("2026-11-17T14:00:00.000Z");
    // Tuesday 15:30 → 1.5 h today, 2.5 h tomorrow → Wednesday 10:30.
    expect(at("2026-11-17T15:30:00Z")).toBe("2026-11-18T10:30:00.000Z");
    // Friday 15:30 → Monday 10:30, never the weekend.
    expect(at("2026-11-20T15:30:00Z")).toBe("2026-11-23T10:30:00.000Z");
    // Saturday → the clock starts Monday at 08:00.
    expect(at("2026-11-21T11:00:00Z")).toBe("2026-11-23T12:00:00.000Z");
    // Before opening → the clock starts at 08:00.
    expect(at("2026-11-17T06:00:00Z")).toBe("2026-11-17T12:00:00.000Z");
  });
  test("the deal's events are the request's: a stage move, a win, a loss", () => {
    // The opportunity and its events were retired (lean revamp PR 7): the deal
    // is the request, and these are the only keys a deal raises.
    expect(qrEvents.STAGE_MOVED).toBe("quote_request.stage_moved");
    expect(qrEvents.WON).toBe("quote_request.won");
    expect(qrEvents.LOST).toBe("quote_request.lost");
    expect(qrEvents.transition).toBeUndefined();
  });
});

/**
 * The request's lifecycle is its stage (lean revamp D3, guide §3.2). The six
 * intake statuses of F6 (RECEIVED to CLOSED_NO_ACTION) and their transition
 * guard were dropped with the `status` column in PR 7 (14593); the stage bar
 * below is what replaced them.
 */
describe("Quote request stage (the deal, MOD-20)", () => {
  test("the six fixed stages, four of them open", () => {
    expect(qr.STAGES).toEqual(["NEW", "CONTACTED", "MEETING", "QUOTED", "WON", "LOST"]);
    expect(qr.OPEN_STAGES).toEqual(["NEW", "CONTACTED", "MEETING", "QUOTED"]);
    expect(qr.isSettled("WON")).toBe(true);
    expect(qr.isSettled("LOST")).toBe(true);
    expect(qr.isSettled("QUOTED")).toBe(false);
  });
  test("any open stage moves to any other, forwards or back (a click is often a correction)", () => {
    expect(qr.assertMovable("NEW", "QUOTED")).toBe(true);
    expect(qr.assertMovable("QUOTED", "CONTACTED")).toBe(true);
    expect(qr.assertMovable("MEETING", "LOST")).toBe(true);
  });
  test("nothing leaves Won or Lost", () => {
    expect(() => qr.assertMovable("WON", "QUOTED")).toThrow(/already won/);
    expect(() => qr.assertMovable("LOST", "NEW")).toThrow(/already lost/);
  });
  test("Won is never a click: it is a win, which opens the operations file", () => {
    expect(() => qr.assertMovable("QUOTED", "WON")).toThrow(/accepted quotation or Mark Won/);
  });
  test("an unknown stage, such as an old intake status, is refused", () => {
    expect(() => qr.assertMovable("NEW", "CLOSED_NO_ACTION")).toThrow(/Unknown stage/);
    expect(qr.assertTransition).toBeUndefined();
    expect(qr.statusForStage).toBeUndefined();
  });
  /**
   * THE TILES PARTITION THE SET — one tile per status, plus TOTAL, and they add
   * up.
   *
   * This test previously asserted a hand-listed FIVE tiles and explained the
   * two missing ones as "intentional extras... whose counts are surfaced in the
   * dynamic kpi object but not in the 5-tile summary. The legacy had the same
   * split." That is a description of the bug, not of a design: every
   * CLARIFICATION_REQUIRED and CLOSED_NO_ACTION row counted into TOTAL and was
   * displayed in no tile, so the register disagreed with itself — which is the
   * legacy's "5 of 26 rows" defect reproduced one column over, and the thing F6
   * exists to correct.
   *
   * `quote_request.rules` now DERIVES the tiles from the status list so a
   * seventh status cannot silently vanish from the summary. Asserting a
   * hard-coded list here would defeat that: the point is that nobody maintains
   * the list. So what is asserted is the invariant instead — every status gets
   * a tile, every tile gets a label, and the counts add up to TOTAL.
   */
  test("the KPI tiles are derived from the stage enum, and partition it", () => {
    // Since the Sales lean revamp (PR 6) the tiles read the request's stage,
    // the only lifecycle a request has (PR 7 dropped `status`).
    expect(qr.STAGES).toEqual(["NEW", "CONTACTED", "MEETING", "QUOTED", "WON", "LOST"]);
    // TOTAL plus one tile per stage — derived, not listed.
    expect(qr.KPI_TILES).toEqual(["TOTAL", ...qr.STAGES]);
    // A tile with no caption renders as a blank card, so the labels are part of
    // the contract rather than a display detail.
    for (const key of qr.KPI_TILES) expect(typeof qr.TILE_LABELS[key]).toBe("string");
  });

  test("every row lands in exactly one tile, and the tiles sum to TOTAL", () => {
    const kpi = qr.kpiFrom([
      { stage: "NEW", c: 2 },
      { stage: "CONTACTED", c: 1 },
      { stage: "MEETING", c: 1 },
      { stage: "QUOTED", c: 1 },
      { stage: "WON", c: 1 },
      { stage: "LOST", c: 1 },
    ]);
    expect(kpi.TOTAL).toBe(7);
    expect(kpi.MEETING).toBe(1);
    expect(kpi.LOST).toBe(1);
    expect(qr.assertPartitions(kpi)).toBe(true);
    expect(qr.STAGES.reduce((n, s) => n + kpi[s], 0)).toBe(kpi.TOTAL);
  });

  test("a stage the enum does not know shows up as a discrepancy, never as a silent loss", () => {
    // The service holds the vocabulary, but a value written by a hand-run
    // UPDATE has to appear on the screen rather than quietly unbalancing the
    // tiles — counters that fail to add up is the whole defect.
    const kpi = qr.kpiFrom([{ stage: "NEW", c: 2 }, { stage: "LEGACY_SP_NEW", c: 3 }]);
    expect(kpi.TOTAL).toBe(5);
    expect(kpi.OTHER).toBe(3);
    expect(qr.assertPartitions(kpi)).toBe(true);
  });
});
