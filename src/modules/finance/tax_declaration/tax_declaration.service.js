/**
 * Tax Center (MOD-07, KB §15/§16) — computes returns over the validated GL.
 * Read-only; rates come from tenant settings (finance.tax) with KB defaults.
 */
"use strict";
const statementsRepo = require("../financial_statement/financial_statement.repo");
const { incomeStatement } = require("../financial_statement/financial_statement.rules");
const rules = require("./tax_declaration.rules");
const { getSetting } = require("../../../shared/config/settings");

async function vatReturn(client, filters) {
  const rows = await statementsRepo.trialBalance(client, filters);
  return { period: filters, ...rules.vatReturn(rows) };
}

async function corporateTax(client, filters) {
  const rows = await statementsRepo.trialBalance(client, filters);
  const cr = incomeStatement(rows);
  const turnover = rules.turnoverFrom(rows);
  const cfg = (await getSetting(client, "finance", "tax", null)) || {};
  const isRate = typeof cfg.is_rate === "number" ? cfg.is_rate : 0.33;
  const minRate = typeof cfg.min_rate === "number" ? cfg.min_rate : 0.022;
  return { period: filters, ...rules.corporateTax({ result: cr.result, turnover, isRate, minRate }) };
}

module.exports = { vatReturn, corporateTax };
