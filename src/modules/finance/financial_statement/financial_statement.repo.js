"use strict";
/**
 * Trial balance from the validated general ledger: per-account Σdebit/Σcredit.
 * Optional filters: entityId, periodId, from/to dates. Validated entries only —
 * drafts never appear in statements.
 */
async function trialBalance(client, { entityId = null, periodId = null, from = null, to = null } = {}) {
  const params = [];
  const wh = ["je.status = 'validated'"];
  if (entityId) { params.push(entityId); wh.push("je.entity_id = $" + params.length); }
  if (periodId) { params.push(periodId); wh.push("je.period_id = $" + params.length); }
  if (from) { params.push(from); wh.push("je.entry_date >= $" + params.length); }
  if (to) { params.push(to); wh.push("je.entry_date <= $" + params.length); }
  const { rows } = await client.query(
    "SELECT jl.account_code, SUM(jl.debit) AS debit, SUM(jl.credit) AS credit " +
      "FROM journal_line jl JOIN journal_entry je ON je.entry_id = jl.entry_id " +
      "WHERE " + wh.join(" AND ") +
      " GROUP BY jl.account_code ORDER BY jl.account_code",
    params,
  );
  return rows.map((r) => ({ account_code: r.account_code, debit: Number(r.debit), credit: Number(r.credit) }));
}

module.exports = { trialBalance };
