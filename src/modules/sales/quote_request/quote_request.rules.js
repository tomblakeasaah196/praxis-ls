/** Quote request (MOD-20-intake) — pure lifecycle and KPI arithmetic.
 *
 * TWO RULES, AND THEY ARE THE FEATURE.
 *
 * 1. `quote_request.stage` is the request's lifecycle, and since the Sales
 *    lean revamp (PR 2) the deal's: NEW, CONTACTED, MEETING, QUOTED, then WON
 *    or LOST. The intake `status` from before the revamp was dropped in 14593
 *    (PR 7); the stage is the only lifecycle there is.
 *
 * 2. THE TILES PARTITION THE SET. Every stage belongs to exactly one tile, and
 *    the tiles sum to TOTAL — under every filter combination, with no row left
 *    over. That is not a display detail: a register whose counters do not add
 *    up is the exact failure F6 exists to correct, and it is very easy to
 *    reintroduce by adding a value and forgetting a tile.
 *
 *    So the tiles are DERIVED from STAGES here rather than hand-listed, and
 *    `assertPartitions()` proves it. A seventh stage added tomorrow either
 *    lands in a tile or fails the test; it cannot silently vanish from the
 *    summary the way CLARIFICATION_REQUIRED and CLOSED_NO_ACTION once did.
 */
"use strict";
const { quoteRequest } = require("@praxis/shared");
const { AppError } = require("../../../utils/errors");

/* ── the deal's stage (14511, doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.2, §4.2) ─
 *
 * The stages are `@praxis/shared`'s, so the stage bar offers exactly the moves
 * this module accepts: NEW, CONTACTED, MEETING, QUOTED, then WON or LOST.
 */
const STAGES = [...quoteRequest.STAGES];
const OPEN_STAGES = [...quoteRequest.OPEN_STAGES];
const SETTLED_STAGES = ["WON", "LOST"];
const isSettled = (stage) => SETTLED_STAGES.includes(stage);

/** How far along a stage is, so an automatic move never goes backwards. */
const STAGE_RANK = { NEW: 0, CONTACTED: 1, MEETING: 2, QUOTED: 3, WON: 4, LOST: 4 };

/**
 * May a person move a request from `from` to `to` on the stage bar? Any open
 * stage to any other (a click is a correction as often as a step forward);
 * nothing out of WON or LOST; never INTO Won, which is a win's (it opens the
 * operations file).
 */
function assertMovable(from, to) {
  if (isSettled(from)) {
    throw new AppError("REQUEST_SETTLED", `This request is already ${from === "WON" ? "won" : "lost"}`, 409);
  }
  if (to === "WON") {
    throw new AppError("BAD_STATE", "A request is won by an accepted quotation or Mark Won", 422);
  }
  if (!STAGES.includes(to)) throw new AppError("BAD_STATE", `Unknown stage ${to}`, 422);
  return true;
}

/**
 * One tile per stage, in the deal's order, plus TOTAL. Derived — see rule 2.
 * `key` is the stage value (TOTAL is the sum); `label` is the English caption
 * a screen renders.
 */
const TILE_LABELS = {
  TOTAL: "Total",
  NEW: "New",
  CONTACTED: "Contacted",
  MEETING: "Meeting",
  QUOTED: "Quoted",
  WON: "Won",
  LOST: "Lost",
};

const KPI_TILES = ["TOTAL", ...STAGES];

/** A zeroed tile set — so a tile with no rows renders 0 rather than disappearing. */
const emptyKpi = () => KPI_TILES.reduce((acc, k) => { acc[k] = 0; return acc; }, {});

/**
 * Fold `[{ stage, c }]` (the GROUP BY the repo runs) into the tile set.
 *
 * An UNRECOGNISED stage is counted into TOTAL and into `OTHER`, never dropped.
 * The service holds the vocabulary (no CHECK on an existing table, 13791 rule),
 * so a value written by a hand-run UPDATE must show up as a discrepancy on the
 * screen rather than quietly unbalancing the tiles — the whole defect being
 * fixed here is counters that silently fail to add up.
 */
function kpiFrom(groupedRows = []) {
  const kpi = emptyKpi();
  for (const r of groupedRows) {
    const c = Number(r.c) || 0;
    kpi.TOTAL += c;
    if (Object.prototype.hasOwnProperty.call(kpi, r.stage) && r.stage !== "TOTAL") kpi[r.stage] += c;
    else { kpi.OTHER = (kpi.OTHER || 0) + c; }
  }
  return kpi;
}

/**
 * The invariant, as a function so a test can assert it rather than a comment
 * asking a reader to believe it. Returns true or throws.
 */
function assertPartitions(kpi) {
  const sum = STAGES.reduce((n, s) => n + (kpi[s] || 0), 0) + (kpi.OTHER || 0);
  if (sum !== kpi.TOTAL) {
    throw new AppError(
      "KPI_NOT_PARTITIONED",
      `KPI tiles sum to ${sum} but TOTAL is ${kpi.TOTAL}: a stage belongs to no tile`,
      500,
    );
  }
  return true;
}

module.exports = {
  STAGES, OPEN_STAGES, SETTLED_STAGES, STAGE_RANK, isSettled, assertMovable,
  KPI_TILES, TILE_LABELS, emptyKpi, kpiFrom, assertPartitions,
};
