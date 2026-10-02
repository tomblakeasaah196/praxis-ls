/** Tax-jurisdiction / tax-code repository (MOD-07). All SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const insertJur = (client, data) => insertOne(client, "tax_jurisdiction", data);
const getJur = (client, id) => getById(client, "tax_jurisdiction", "jurisdiction_id", id);
const insertCode = (client, data) => insertOne(client, "tax_code", data);
const getCode = (client, id) => getById(client, "tax_code", "tax_code_id", id);

async function updateJur(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and writable allow-list in query-helpers.
  if (!Object.keys(fields).length) return getJur(client, id);
  return updateOne(client, "tax_jurisdiction", "jurisdiction_id", id, fields, "*", null);
}
async function updateCode(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and writable allow-list in query-helpers.
  if (!Object.keys(fields).length) return getCode(client, id);
  return updateOne(client, "tax_code", "tax_code_id", id, fields, "*", null);
}
async function codeCount(client, jurisdictionId) {
  const { rows } = await client.query("SELECT COUNT(*)::int AS n FROM tax_code WHERE jurisdiction_id = $1", [jurisdictionId]);
  return rows[0].n;
}
async function codesByKey(client, jurisdictionId, code) {
  const { rows } = await client.query("SELECT * FROM tax_code WHERE jurisdiction_id = $1 AND code = $2 ORDER BY effective_from DESC", [jurisdictionId, code]);
  return rows;
}
async function listCodes(client, jurisdictionId) {
  const { rows } = await client.query("SELECT * FROM tax_code WHERE jurisdiction_id = $1 ORDER BY code, effective_from DESC", [jurisdictionId]);
  return rows;
}
/** The postable leaf codes — what a tax code is allowed to post to. */
async function postableAccountCodes(client) {
  const { rows } = await client.query("SELECT code FROM chart_of_accounts WHERE is_postable AND is_active");
  return new Set(rows.map((r) => r.code));
}

/**
 * Tax codes whose posting is not usable — the banner on the tax screen and the
 * go-live readiness check read this.
 *
 * `reason` names what is wrong so the screen does not have to re-derive it:
 * MISSING when a side is NULL, NOT_POSTABLE when a side names a heading rather
 * than a leaf. Only the version in force TODAY per code: a historical row that
 * was mapped differently is history, not a thing to fix.
 */
async function unmappedCodes(client, jurisdictionId = null) {
  const params = [];
  let where = "";
  if (jurisdictionId) { params.push(jurisdictionId); where = "WHERE jurisdiction_id = $1"; }
  const { rows } = await client.query(
    `WITH current AS (
       SELECT DISTINCT ON (jurisdiction_id, code) *
         FROM tax_code
        ${where}
        ORDER BY jurisdiction_id, code,
                 (effective_from <= CURRENT_DATE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)) DESC,
                 effective_from DESC
     )
     SELECT c.tax_code_id, c.jurisdiction_id, c.code, c.kind, c.rate_percent,
            c.effective_from, c.posts_debit_account, c.posts_credit_account,
            CASE WHEN c.posts_debit_account IS NULL OR c.posts_credit_account IS NULL
                 THEN 'MISSING' ELSE 'NOT_POSTABLE' END AS reason
       FROM current c
       LEFT JOIN chart_of_accounts da ON da.code = c.posts_debit_account  AND da.is_postable AND da.is_active
       LEFT JOIN chart_of_accounts ca ON ca.code = c.posts_credit_account AND ca.is_postable AND ca.is_active
      WHERE c.posts_debit_account IS NULL OR c.posts_credit_account IS NULL
         OR da.code IS NULL OR ca.code IS NULL
      ORDER BY c.code`,
    params,
  );
  return rows;
}

async function listJur(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.country_code) { params.push(q.country_code); wh.push("country_code = $" + params.length); }
  if (q.is_active !== undefined) { params.push(q.is_active === "true" || q.is_active === true); wh.push("is_active = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query("SELECT * FROM tax_jurisdiction " + where + " ORDER BY country_code, name LIMIT $1 OFFSET $2", params);
  return rows;
}
module.exports = { insertJur, getJur, insertCode, getCode, updateJur, updateCode, codeCount, codesByKey, listCodes, listJur, postableAccountCodes, unmappedCodes };
