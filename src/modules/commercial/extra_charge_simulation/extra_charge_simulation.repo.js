/** Extra-charge simulation repository (MOD-28). All SQL lives here. */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insertSim = (client, data) => insertOne(client, "extra_charge_simulation", data);
const getSim = (client, id) => getById(client, "extra_charge_simulation", "extra_charge_simulation_id", id);

async function listSims(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = ["1=1"];
  if (q.dossier_id) { params.push(q.dossier_id); wh.push("dossier_id = $" + params.length); }
  const { rows } = await client.query(
    "SELECT * FROM extra_charge_simulation WHERE " + wh.join(" AND ") + " ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    params,
  );
  return rows;
}

module.exports = { insertSim, getSim, listSims };
