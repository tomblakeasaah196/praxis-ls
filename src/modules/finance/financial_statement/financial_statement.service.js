/**
 * Statements (MOD-59, KB §12). Reads the validated GL into a trial balance, then
 * derives the Compte de résultat and a first-cut Bilan. Read-only.
 */
"use strict";
const repo = require("./financial_statement.repo");
const { trialBalanceTotals, incomeStatement, balanceSheet } = require("./financial_statement.rules");

async function trialBalance(client, filters) {
  const rows = await repo.trialBalance(client, filters);
  return { rows, totals: trialBalanceTotals(rows) };
}

async function compteDeResultat(client, filters) {
  const rows = await repo.trialBalance(client, filters);
  return incomeStatement(rows);
}

async function bilan(client, filters) {
  const rows = await repo.trialBalance(client, filters);
  const cr = incomeStatement(rows);
  return { ...balanceSheet(rows, cr.result), result: cr.result };
}

module.exports = { trialBalance, compteDeResultat, bilan };
