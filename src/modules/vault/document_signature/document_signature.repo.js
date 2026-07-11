"use strict";
const { insertOne } = require("../../../shared/db/query-helpers");
function insert(client, data) { return insertOne(client, "document_signature", data); }
async function listByRef(client, entityRef) {
  const { rows } = await client.query(
    "SELECT * FROM document_signature WHERE entity_ref = $1 ORDER BY created_at DESC",
    [entityRef],
  );
  return rows;
}
module.exports = { insert, listByRef };
