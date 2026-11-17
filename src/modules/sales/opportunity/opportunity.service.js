/**
 * Opportunity / Sales pipeline (MOD-24) — READ ONLY since the Sales lean
 * revamp, PR 2 (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §4.2, owner decision D3).
 *
 * The deal is its request now: quote_request.stage, estimated_value, the Lost
 * reason, and the operations file a win opens (quote_request.win.js). Migration
 * 14512 made every opportunity a request (`converted_opportunity_id` is the way
 * back). What is left here answers the Opportunities screen's reads until PR 3
 * replaces it, and PR 7 deletes the module; the writes (create, edit, move,
 * win, lose) are gone, so the two records cannot drift apart meanwhile.
 *
 * F7's KPI arithmetic (opportunity.rules.winRate) still serves `metrics`.
 */
"use strict";
const repo = require("./opportunity.repo");
const rules = require("./opportunity.rules");

/**
 * The KPI row. Pipeline value (open deals), weighted forecast, and BOTH win
 * rates — see opportunity.rules.winRate for why both are returned rather than
 * one being chosen for the reader.
 */
async function metrics(client, q = {}) {
  const m = await repo.metrics(client, q);
  const rate = rules.winRate({ won: m.won_count, lost: m.lost_count, open: m.open_count });
  return {
    pipeline_value: m.pipeline_value,
    weighted_value: m.weighted_value,
    won_value: m.won_value,
    open_count: m.open_count,
    won_count: m.won_count,
    lost_count: m.lost_count,
    settled_count: rate.settled_count,
    total_count: m.open_count + m.won_count + m.lost_count,
    // Headline: decided deals only. Secondary: the legacy's denominator.
    win_rate_settled: rate.settled,
    win_rate_all_deals: rate.all_deals,
  };
}

const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);
const listForExport = (client, q) => repo.listForExport(client, q);
const stages = (client) => repo.listStages(client);
const board = (client, q) => repo.board(client, q);

module.exports = { get, list, listForExport, stages, board, metrics };
