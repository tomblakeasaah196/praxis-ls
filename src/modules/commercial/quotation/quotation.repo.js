/** Quotation repository (MOD-27). Header + lines. All SQL lives here. */
"use strict";
const { clientHeadingJoin, CLIENT_HEADING_COLUMNS } = require("../../master/financial_dictionary/client-heading.sql");
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "quotation", data);
const get = (client, id) => getById(client, "quotation", "quotation_id", id);
const insertLine = (client, data) => insertOne(client, "quotation_line", data);

async function deleteLines(client, id) { await client.query("DELETE FROM quotation_line WHERE quotation_id = $1", [id]); }
// The container type is joined so a reader has the name to print and `extra` to
// total the document's own TEU. LEFT JOIN: most lines carry no equipment, and a
// type deactivated since the quote was issued must still render its name.
const LINE_SELECT =
  "SELECT ql.*, dr.code AS container_type_code, dr.name_en AS container_type_en, " +
  "dr.name_fr AS container_type_fr, dr.extra AS container_type_extra, " +
  // 14130: the catalogue's family beside the line's own override.
  CLIENT_HEADING_COLUMNS + " " +
  "FROM quotation_line ql LEFT JOIN dictionary_ref dr ON dr.ref_id = ql.container_type_ref_id " +
  "LEFT JOIN dictionary_item di ON di.dictionary_item_id = ql.dictionary_item_id " +
  clientHeadingJoin("di") + " ";
async function listLines(client, id) {
  const { rows } = await client.query(LINE_SELECT + "WHERE ql.quotation_id = $1 ORDER BY ql.line_no NULLS LAST, ql.quotation_line_id", [id]);
  return rows;
}
async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, "quotation", "quotation_id", id, fields, "*", null, { touch: "updated_at" });
}
async function list(client, q = {}) {
  const { limit, offset } = page(q); const params = [limit, offset]; const wh = [];
  if (q.status) { params.push(q.status); wh.push("q.status = $" + params.length); }
  if (q.client_id) { params.push(q.client_id); wh.push("q.client_id = $" + params.length); }
  if (q.dossier_id) { params.push(q.dossier_id); wh.push("q.dossier_id = $" + params.length); }
  if (q.costing_id) { params.push(q.costing_id); wh.push("q.costing_id = $" + params.length); }
  if (q.quote_request_id) { params.push(q.quote_request_id); wh.push("q.quote_request_id = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  // The request's reference and the client's name ride along so the list and
  // the Client 360 can say what each offer answers without a second read.
  const { rows } = await client.query(
    `SELECT q.*, qr.public_ref AS quote_request_ref, COALESCE(cm.name, cm.legal_name) AS client_name
       FROM quotation q
       LEFT JOIN quote_request qr ON qr.quote_request_id = q.quote_request_id
       LEFT JOIN client_master cm ON cm.client_id = q.client_id
       ${where} ORDER BY q.created_at DESC LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

/* ── the request this quotation answers (meeting 6, PR 4) ──────────────────── */

/** The request a sales opportunity was converted from, newest first. */
async function quoteRequestForOpportunity(client, opportunityId) {
  if (!opportunityId) return null;
  const { rows } = await client.query(
    "SELECT quote_request_id FROM quote_request WHERE converted_opportunity_id = $1 ORDER BY created_at DESC LIMIT 1",
    [opportunityId],
  );
  return rows[0] ? rows[0].quote_request_id : null;
}

async function quoteRequestHead(client, id) {
  if (!id) return null;
  const { rows } = await client.query(
    "SELECT quote_request_id, public_ref, status, client_id, service_type_id, created_at FROM quote_request WHERE quote_request_id = $1",
    [id],
  );
  return rows[0] || null;
}

/**
 * The client's requests a quotation could answer — every one not closed,
 * newest first, each with whether a quotation already answers it. The pricer
 * picks; `suggested` in the service is the one whose service matches the
 * file's and which nothing answers yet.
 */
async function openQuoteRequests(client, clientId) {
  if (!clientId) return [];
  const { rows } = await client.query(
    `SELECT qr.quote_request_id, qr.public_ref, qr.status, qr.service_type_id, qr.created_at,
            COALESCE(st.name_en, st.name_fr) AS service_name_en, COALESCE(st.name_fr, st.name_en) AS service_name_fr,
            EXISTS (SELECT 1 FROM quotation q WHERE q.quote_request_id = qr.quote_request_id
                     AND q.status IN ('DRAFT','SENT','ACCEPTED','CONVERTED')) AS answered
       FROM quote_request qr
       LEFT JOIN service_type st ON st.service_type_id = qr.service_type_id
      WHERE qr.client_id = $1 AND qr.status <> 'CLOSED_NO_ACTION'
      ORDER BY qr.created_at DESC LIMIT 20`,
    [clientId],
  );
  return rows;
}

/** The workings behind a quotation priced from a costing (G1), if any. */
async function workingsFor(client, quotationId) {
  const { rows } = await client.query(
    "SELECT margin_simulation_id, origin, target_margin_percent FROM margin_simulation WHERE quotation_id = $1 ORDER BY created_at DESC LIMIT 1",
    [quotationId],
  );
  return rows[0] || null;
}

async function costingHead(client, costingId) {
  if (!costingId) return null;
  const { rows } = await client.query("SELECT costing_id, doc_number, status FROM costing WHERE costing_id = $1", [costingId]);
  return rows[0] || null;
}

module.exports = {
  insert, get, insertLine, deleteLines, listLines, update, list,
  quoteRequestForOpportunity, quoteRequestHead, openQuoteRequests, workingsFor, costingHead,
};
