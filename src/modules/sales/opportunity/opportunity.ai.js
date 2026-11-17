"use strict";
const service = require("./opportunity.service");
module.exports = {
  entity: "opportunity", module_key: "MOD-24", screens: [],
  reads: [
    { key: "list_opportunities", service: (c, p) => service.list(c, p), permission: { module: "MOD-24", action: "view" }, describe: "List sales opportunities (filter stage/status/owner/source/date/search)." },
    { key: "pipeline_board", service: (c, p) => service.board(c, p), permission: { module: "MOD-24", action: "view" }, describe: "Kanban board: open opportunities + value/weighted value per stage." },
    { key: "pipeline_metrics", service: (c, p) => service.metrics(c, p), permission: { module: "MOD-24", action: "view" }, describe: "Pipeline KPIs: open pipeline value, weighted forecast, won value, and BOTH win rates — win_rate_settled (won / won+lost, the headline) and win_rate_all_deals (won / every deal, the legacy denominator). Null means no deals in the denominator, which is not the same as 0%." },
    { key: "get_opportunity", service: (c, p) => service.get(c, p.id || p), permission: { module: "MOD-24", action: "view" }, describe: "Get an opportunity by id." },
  ],
  // Read only since the Sales lean revamp (PR 2): a deal is its request, and
  // moving or winning one is quote_request's (move_quote_request_stage,
  // mark_quote_request_won). These reads answer for the history until PR 7.
  writes: [],
};
