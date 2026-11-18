/** Quotation repository (MOD-27). Header + lines. All SQL lives here. */
"use strict";
const { clientHeadingJoin, CLIENT_HEADING_COLUMNS } = require("../../master/financial_dictionary/client-heading.sql");
const { insertOne, getById, page, updateOne, TOTAL_COL, splitTotal } = require("../../../shared/db/query-helpers");

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
  if (q.lead_id) { params.push(q.lead_id); wh.push("q.lead_id = $" + params.length); }
  // An old proposal link (§5.6): the quotation 14542 made of it.
  if (q.source_proposal_id) { params.push(q.source_proposal_id); wh.push("q.source_proposal_id = $" + params.length); }
  // The Quotations list's search (§3.4): the number, the company, the request's reference or title.
  if (q.q && String(q.q).trim()) {
    params.push(`%${String(q.q).trim().slice(0, 120)}%`);
    const n = "$" + params.length;
    wh.push(`(q.doc_number ILIKE ${n} OR q.title ILIKE ${n} OR qr.public_ref ILIKE ${n} OR qr.title ILIKE ${n}
             OR cm.name ILIKE ${n} OR cm.legal_name ILIKE ${n} OR l.company_name ILIKE ${n})`);
  }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  // The request's reference and the client's (or the prospect's) name ride along so the list and
  // the Client 360 can say what each offer answers without a second read.
  const { rows } = await client.query(
    `SELECT q.*, qr.public_ref AS quote_request_ref, qr.title AS quote_request_title,
            COALESCE(cm.name, cm.legal_name, l.company_name) AS client_name, l.company_name AS lead_name, ${TOTAL_COL}
       FROM quotation q
       LEFT JOIN quote_request qr ON qr.quote_request_id = q.quote_request_id
       LEFT JOIN client_master cm ON cm.client_id = q.client_id
       LEFT JOIN lead l ON l.lead_id = q.lead_id
       ${where} ORDER BY q.created_at DESC LIMIT $1 OFFSET $2`,
    params,
  );
  return splitTotal(rows);
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
    "SELECT quote_request_id, public_ref, stage, title, lead_id, client_id, service_type_id, created_at FROM quote_request WHERE quote_request_id = $1",
    [id],
  );
  return rows[0] || null;
}

/**
 * The client's requests a quotation could answer — every one still open,
 * newest first, each with whether a quotation already answers it. The pricer
 * picks; `suggested` in the service is the one whose service matches the
 * file's and which nothing answers yet.
 */
async function openQuoteRequests(client, clientId) {
  if (!clientId) return [];
  const { rows } = await client.query(
    `SELECT qr.quote_request_id, qr.public_ref, qr.stage, qr.title, qr.service_type_id, qr.created_at,
            COALESCE(st.name_en, st.name_fr) AS service_name_en, COALESCE(st.name_fr, st.name_en) AS service_name_fr,
            EXISTS (SELECT 1 FROM quotation q WHERE q.quote_request_id = qr.quote_request_id
                     AND q.status IN ('DRAFT','SENT','ACCEPTED','CONVERTED')) AS answered
       FROM quote_request qr
       LEFT JOIN service_type st ON st.service_type_id = qr.service_type_id
      WHERE qr.client_id = $1 AND qr.stage NOT IN ('WON', 'LOST')
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

/* ── one document (lean revamp, PR 4) ───────────────────────────────────── */

/** A quotation's sections, in the library's order (the service sorts; this reads). */
async function listSections(client, quotationId) {
  const { rows } = await client.query(
    "SELECT section_key, enabled, body_en, body_fr, story_ids FROM quotation_section WHERE quotation_id = $1",
    [quotationId],
  );
  return rows;
}

/** Write one section: insert or replace its on/off, its words and its stories. */
async function upsertSection(client, quotationId, s) {
  await client.query(
    `INSERT INTO quotation_section (quotation_id, section_key, enabled, body_en, body_fr, story_ids)
     VALUES ($1, $2, $3, $4, $5, $6::uuid[])
     ON CONFLICT (quotation_id, section_key) DO UPDATE
       SET enabled = EXCLUDED.enabled, body_en = EXCLUDED.body_en,
           body_fr = EXCLUDED.body_fr, story_ids = EXCLUDED.story_ids`,
    [quotationId, s.section_key, s.enabled !== false, s.body_en ?? null, s.body_fr ?? null, s.story_ids || []],
  );
}

/** The quotation a public token opens, by the token's hash. */
async function byShareHash(client, hash) {
  const { rows } = await client.query("SELECT * FROM quotation WHERE share_token_hash = $1", [hash]);
  return rows[0] || null;
}

async function insertView(client, { quotationId, kind = "VIEW", via = "LINK", agentLabel = null, visitorHash = null }) {
  await client.query(
    "INSERT INTO quotation_view (quotation_id, kind, via, agent_label, visitor_hash) VALUES ($1, $2, $3, $4, $5)",
    [quotationId, kind, via, agentLabel, visitorHash],
  );
}

async function listViews(client, quotationId, limit = 50) {
  const { rows } = await client.query(
    "SELECT opened_at, kind, via, agent_label FROM quotation_view WHERE quotation_id = $1 ORDER BY opened_at DESC LIMIT $2",
    [quotationId, limit],
  );
  return rows;
}

/** The first open of the link stamps viewed_at; returns true only for that first one. */
async function stampFirstView(client, quotationId) {
  const { rowCount } = await client.query(
    "UPDATE quotation SET viewed_at = now() WHERE quotation_id = $1 AND viewed_at IS NULL",
    [quotationId],
  );
  return rowCount > 0;
}

async function stampFirstDownload(client, quotationId) {
  await client.query(
    "UPDATE quotation SET downloaded_at = now() WHERE quotation_id = $1 AND downloaded_at IS NULL",
    [quotationId],
  );
}

/** A draft revision already made from this quotation, if any. */
async function openRevisionOf(client, quotationId) {
  const { rows } = await client.query(
    "SELECT quotation_id FROM quotation WHERE supersedes_id = $1 AND status = 'DRAFT' ORDER BY created_at DESC LIMIT 1",
    [quotationId],
  );
  return rows[0] ? rows[0].quotation_id : null;
}

/** The highest version number in this quotation's chain, walking back through supersedes_id. */
async function chainVersion(client, quotationId) {
  const { rows } = await client.query(
    `WITH RECURSIVE chain AS (
       SELECT quotation_id, supersedes_id, version, 1 AS depth FROM quotation WHERE quotation_id = $1
       UNION ALL
       SELECT q.quotation_id, q.supersedes_id, q.version, c.depth + 1
         FROM quotation q JOIN chain c ON q.quotation_id = c.supersedes_id
        WHERE c.depth < 50
     ) SELECT COALESCE(MAX(version), 1) AS v FROM chain`,
    [quotationId],
  );
  return Number(rows[0] ? rows[0].v : 1);
}

/** Sent offers past their date (the nightly expiry). */
async function sentPastValidity(client, limit = 500) {
  const { rows } = await client.query(
    "SELECT quotation_id FROM quotation WHERE status = 'SENT' AND valid_until IS NOT NULL AND valid_until < CURRENT_DATE ORDER BY valid_until LIMIT $1",
    [limit],
  );
  return rows.map((r) => r.quotation_id);
}

/** The company row and, through it, who to tell and how to name the company. */
async function leadHead(client, leadId) {
  if (!leadId) return null;
  const { rows } = await client.query(
    `SELECT lead_id, company_name, contact_name, email, phone, client_id, owner_user_id, entity_id, merged_into_lead_id, status
       FROM lead WHERE lead_id = $1`,
    [leadId],
  );
  return rows[0] || null;
}

/** The client's own company row (one per client since 14512), for a quotation typed for a client. */
async function leadOfClient(client, clientId) {
  if (!clientId) return null;
  const { rows } = await client.query(
    "SELECT lead_id FROM lead WHERE client_id = $1 AND merged_into_lead_id IS NULL ORDER BY created_at LIMIT 1",
    [clientId],
  );
  return rows[0] ? rows[0].lead_id : null;
}

/* ── templates ─────────────────────────────────────────────────────────────── */

async function listTemplates(client, { includeInactive = false } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM quotation_template ${includeInactive ? "" : "WHERE active"} ORDER BY is_default DESC, lower(name)`,
  );
  return rows;
}

const getTemplate = (client, id) => getById(client, "quotation_template", "template_id", id);
const insertTemplate = (client, data) => insertOne(client, "quotation_template", data);
async function updateTemplate(client, id, fields) {
  if (!Object.keys(fields).length) return getTemplate(client, id);
  return updateOne(client, "quotation_template", "template_id", id, fields, "*", null, { touch: "updated_at" });
}
async function clearDefaultTemplate(client, exceptId = null) {
  await client.query("UPDATE quotation_template SET is_default = false WHERE is_default AND template_id IS DISTINCT FROM $1", [exceptId]);
}

/**
 * The template for a request's service: one whose service types include it,
 * else the default (§3.5 "New Quotation picks the template whose service types
 * include the request's, else the default").
 */
async function templateFor(client, serviceTypeId) {
  const { rows } = await client.query(
    `SELECT * FROM quotation_template
      WHERE active AND (($1::uuid IS NOT NULL AND $1::uuid = ANY(service_type_ids)) OR is_default)
      ORDER BY CASE WHEN $1::uuid IS NOT NULL AND $1::uuid = ANY(service_type_ids) THEN 0 ELSE 1 END, created_at
      LIMIT 1`,
    [serviceTypeId || null],
  );
  return rows[0] || null;
}

module.exports = {
  insert, get, insertLine, deleteLines, listLines, update, list,
  quoteRequestForOpportunity, quoteRequestHead, openQuoteRequests, workingsFor, costingHead,
  listSections, upsertSection, byShareHash, insertView, listViews, stampFirstView, stampFirstDownload,
  openRevisionOf, chainVersion, sentPastValidity, leadHead, leadOfClient,
  listTemplates, getTemplate, insertTemplate, updateTemplate, clearDefaultTemplate, templateFor,
};
