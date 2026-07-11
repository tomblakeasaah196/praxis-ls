/**
 * Proforma / customer-advance repository (MOD-50). All `advance` SQL lives here.
 */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insertAdvance = (client, data) => insertOne(client, "advance", data);
const getAdvance = (client, id) => getById(client, "advance", "advance_id", id);

async function listAdvances(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.client_id) { params.push(q.client_id); wh.push("client_id = $" + params.length); }
  if (q.dossier_id) { params.push(q.dossier_id); wh.push("dossier_id = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    "SELECT * FROM advance " + where + " ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    params,
  );
  return rows;
}

module.exports = { insertAdvance, getAdvance, listAdvances };
