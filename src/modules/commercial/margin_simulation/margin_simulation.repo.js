/**
 * Margin-simulation repository (MOD-27). All SQL for the simulator lives here.
 */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insertSim = (client, data) => insertOne(client, "margin_simulation", data);
const getSim = (client, id) => getById(client, "margin_simulation", "margin_simulation_id", id);
const insertLine = (client, data) => insertOne(client, "margin_simulation_line", data);

async function listLines(client, id) {
  const { rows } = await client.query(
    "SELECT * FROM margin_simulation_line WHERE margin_simulation_id = $1 ORDER BY margin_simulation_line_id",
    [id],
  );
  return rows;
}

async function listSims(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = ["1=1"];
  if (q.dossier_id) { params.push(q.dossier_id); wh.push("dossier_id = $" + params.length); }
  const { rows } = await client.query(
    "SELECT * FROM margin_simulation WHERE " + wh.join(" AND ") + " ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    params,
  );
  return rows;
}

module.exports = { insertSim, getSim, insertLine, listLines, listSims };
