"use strict";
const { insertOne, getById } = require("../../../shared/db/query-helpers");

const insertAdvance = (client, data) => insertOne(client, "regie_advance", data);
const get = (client, id) => getById(client, "regie_advance", "regie_advance_id", id);

async function list(client, q = {}) {
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(q.offset, 10) || 0, 0);
  const params = [limit, offset];
  const wh = [];
  if (q.state) { params.push(q.state); wh.push("state = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query("SELECT * FROM regie_advance " + where + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params);
  return rows;
}

async function listAgeable(client) {
  const { rows } = await client.query(
    "SELECT * FROM regie_advance WHERE state IN ('ISSUED','PARTIALLY_JUSTIFIED')",
  );
  return rows;
}

async function setState(client, id, patch) {
  const keys = Object.keys(patch);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query(
    "UPDATE regie_advance SET " + set + " WHERE regie_advance_id = $1 RETURNING *",
    [id, ...keys.map((k) => patch[k])],
  );
  return rows[0] || null;
}

module.exports = { insertAdvance, get, list, listAgeable, setState };
