/** Expense-rate repository (MOD-10). All SQL lives here. */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "expense_rate", data);
const get = (client, id) => getById(client, "expense_rate", "expense_rate_id", id);

async function forItem(client, dictionaryItemId) {
  const { rows } = await client.query("SELECT * FROM expense_rate WHERE dictionary_item_id = $1 ORDER BY effective_from DESC", [dictionaryItemId]);
  return rows;
}
async function update(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return get(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query("UPDATE expense_rate SET " + set + " WHERE expense_rate_id = $1 RETURNING *", [id, ...keys.map((k) => fields[k])]);
  return rows[0] || null;
}
async function remove(client, id) { await client.query("DELETE FROM expense_rate WHERE expense_rate_id = $1", [id]); }
async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.dictionary_item_id) { params.push(q.dictionary_item_id); wh.push("dictionary_item_id = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query("SELECT * FROM expense_rate " + where + " ORDER BY effective_from DESC LIMIT $1 OFFSET $2", params);
  return rows;
}
module.exports = { insert, get, forItem, update, remove, list };
