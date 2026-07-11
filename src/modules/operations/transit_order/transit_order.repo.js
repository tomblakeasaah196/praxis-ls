/** Transit-order repository (MOD-30). All SQL lives here. */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insertTO = (client, data) => insertOne(client, "transit_order", data);
const getTO = (client, id) => getById(client, "transit_order", "transit_order_id", id);

async function update(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return getTO(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query("UPDATE transit_order SET " + set + " WHERE transit_order_id = $1 RETURNING *", [id, ...keys.map((k) => fields[k])]);
  return rows[0] || null;
}
async function listTO(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = ["1=1"];
  if (q.dossier_id) { params.push(q.dossier_id); wh.push("dossier_id = $" + params.length); }
  const { rows } = await client.query("SELECT * FROM transit_order WHERE " + wh.join(" AND ") + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params);
  return rows;
}
module.exports = { insertTO, getTO, update, listTO };
