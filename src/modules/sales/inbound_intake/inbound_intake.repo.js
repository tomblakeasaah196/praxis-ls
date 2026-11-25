/** Inbound intake (MOD-25) — repository for the contact enquiry desk (F9).
 *  All SQL lives here. */
"use strict";
const { insertOne, updateOne, getById, page } = require("../../../shared/db/query-helpers");

const TABLE = "contact_enquiry";
const RESPONSE_TABLE = "contact_enquiry_response";

/**
 * Coerce empty string to null for nullable text columns. A public contact form
 * posts `""` for every field the visitor left blank, and `""` lands as `""`, so
 * `WHERE company_name = $n` matches nothing and the filter looks broken while
 * the row is plainly on screen.
 */
const blankToNull = (v) => (v === "" || v === undefined ? null : v);

/**
 * Columns a caller may write.
 *
 * `status`, `lead_id`, `responded_at` and
 * `responded_by_user_id` are NOT here on purpose: each is set by exactly one
 * service operation (transition, triage, respond), and every one of them is the
 * answer to a question the register asks. A generic PATCH that could set
 * `status` directly is how a lifecycle guard gets bypassed, and a PATCH that
 * could set `lead_id` is how "was this triaged" starts having two answers.
 */
const WRITABLE = [
  "name", "email", "phone", "subject", "message", "source",
  "enquiry_type", "company_name", "internal_notes",
];

/* ─── enquiries ───────────────────────────────────────────────────────────── */

function insertEnquiry(client, data) {
  return insertOne(client, TABLE, {
    name: blankToNull(data.name),
    email: blankToNull(data.email),
    phone: blankToNull(data.phone),
    company_name: blankToNull(data.company_name),
    subject: blankToNull(data.subject),
    message: blankToNull(data.message),
    source: data.source || "WEBSITE",
    enquiry_type: data.enquiry_type || "GENERAL_ENQUIRY",
    internal_notes: blankToNull(data.internal_notes),
    // 14620: the visitor-facing reference (inbound_intake.reference) and the
    // page the message was written on. Both null for a message keyed in by
    // staff, which has no visitor to quote it.
    public_ref: data.public_ref || null,
    origin_page: blankToNull(data.origin_page),
    status: "NEW",
  });
}

const getEnquiry = (client, id) => getById(client, TABLE, "contact_enquiry_id", id);

/**
 * PERF S19/S20: was a hand-rolled SET builder, which bypassed the identifier
 * validation and writable allow-list in query-helpers.
 *
 * `touch: updated_at` — the column did not exist before 0689, so "when did this
 * last change" was unanswerable and every write looked as old as the message.
 */
async function updEnquiry(client, id, fields) {
  return updateOne(client, TABLE, "contact_enquiry_id", id, fields, "*", null, { touch: "updated_at" });
}

/**
 * ONE WHERE builder, used by the list, the total, the KPI and the export.
 *
 * `includeStatus` is the only difference between them. Four hand-copied WHERE
 * clauses is how a register and its own summary drift apart — which is the
 * defect class F9 is correcting, so they are built from one function and the
 * divergence is a single boolean.
 */
function buildWhere(q = {}, { includeStatus = true } = {}) {
  const wh = [];
  const params = [];
  if (includeStatus && q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  if (q.enquiry_type) { params.push(q.enquiry_type); wh.push("enquiry_type = $" + params.length); }
  if (q.source) { params.push(q.source); wh.push("source = $" + params.length); }
  // "Show me the ones that produced something" / "the ones that did not" — the
  // triage question, asked of the FK rather than of a status value.
  if (q.triaged === "true") wh.push("lead_id IS NOT NULL");
  if (q.triaged === "false") wh.push("lead_id IS NULL");
  if (q.month) { params.push(Number(q.month)); wh.push("EXTRACT(MONTH FROM created_at) = $" + params.length); }
  if (q.year) { params.push(Number(q.year)); wh.push("EXTRACT(YEAR FROM created_at) = $" + params.length); }
  if (q.q) {
    params.push("%" + q.q + "%");
    const i = params.length;
    wh.push(
      `(name ILIKE $${i} OR email::text ILIKE $${i} OR company_name ILIKE $${i}` +
      ` OR subject ILIKE $${i} OR message ILIKE $${i} OR phone ILIKE $${i})`,
    );
  }
  return { where: wh.length ? "WHERE " + wh.join(" AND ") : "", params };
}

const SORTABLE = ["created_at", "status", "enquiry_type", "name"];
const orderBy = (q = {}) =>
  `ORDER BY ${SORTABLE.includes(q.sort) ? q.sort : "created_at"} ${q.dir === "asc" ? "ASC" : "DESC"}`;

/**
 * List + total + the KPI GROUP BY.
 *
 * The KPI drops the STATUS filter and keeps every other one, so a user looking
 * at status=RESPONDED still sees the whole summary rather than one tile equal
 * to the total and the rest at zero (a tautology, not data).
 *
 * It also runs over the WHOLE filtered set, not over the page. The legacy
 * computes its tiles in PHP by looping the rows it just fetched under
 * `LIMIT 200` — so a desk with 300 messages reports "Total: 200", and the
 * number is wrong in the direction that looks plausible.
 */
async function listEnquiries(client, q = {}) {
  const { limit, offset } = page(q);
  const { where, params } = buildWhere(q);

  const { rows } = await client.query(
    `SELECT * FROM ${TABLE} ${where} ${orderBy(q)} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    params.concat([limit, offset]),
  );
  const { rows: totalRows } = await client.query(
    `SELECT COUNT(*)::int AS c FROM ${TABLE} ${where}`, params,
  );

  const kpiQ = buildWhere(q, { includeStatus: false });
  const { rows: kpiRows } = await client.query(
    `SELECT status, COUNT(*)::int AS c FROM ${TABLE} ${kpiQ.where} GROUP BY status`,
    kpiQ.params,
  );

  return { rows, total: totalRows[0] ? totalRows[0].c : 0, kpiRows, limit, offset };
}

/**
 * Every matching row, unpaginated — for the CSV export ONLY.
 *
 * Separate from listEnquiries on purpose: `page()` clamps to 200 and reads only
 * `limit`/`offset`, so an export that calls the list with a large `pageSize`
 * silently writes the first 50 rows. A truncated export that reports no error
 * is worse than one that refuses — the operator opens it in Excel and believes
 * it. `cap` bounds the statement, and the caller is TOLD when it bites.
 */
async function listEnquiriesForExport(client, q = {}, cap = 10000) {
  const { where, params } = buildWhere(q);
  const { rows } = await client.query(
    `SELECT * FROM ${TABLE} ${where} ${orderBy(q)} LIMIT $${params.length + 1}`,
    params.concat([cap + 1]),
  );
  return { rows: rows.slice(0, cap), truncated: rows.length > cap };
}

/* ─── replies ─────────────────────────────────────────────────────────────── */

/** A reply attempt, written PENDING before the mail engine is called. */
function insertResponse(client, { contact_enquiry_id, to_address, subject, body, created_by_user_id = null }) {
  return insertOne(client, RESPONSE_TABLE, {
    contact_enquiry_id,
    to_address,
    subject: blankToNull(subject),
    body,
    send_status: "PENDING",
    created_by_user_id,
  });
}

/**
 * Reply files waiting to be sent (14623): vault rows staged against this
 * enquiry. Only these ids, only under this enquiry's staging reference, so a
 * reply can never attach somebody else's document by naming its id.
 */
async function stagedReplyFiles(client, contactEnquiryId, docIds) {
  if (!docIds.length) return [];
  const { rows } = await client.query(
    `SELECT doc_id, original_name, storage_path
       FROM document_vault
      WHERE doc_id = ANY($1::uuid[]) AND entity_ref = $2`,
    [docIds, `contact_enquiry:${contactEnquiryId}:reply-staged`],
  );
  return rows;
}

/** Settle a PENDING attempt to SENT or FAILED once the transport has answered. */
function settleResponse(client, id, fields) {
  return updateOne(client, RESPONSE_TABLE, "contact_enquiry_response_id", id, fields);
}

async function listResponses(client, contact_enquiry_id) {
  const { rows } = await client.query(
    `SELECT * FROM ${RESPONSE_TABLE} WHERE contact_enquiry_id = $1 ORDER BY created_at DESC`,
    [contact_enquiry_id],
  );
  return rows;
}

/* ─── attachments (14620) ─────────────────────────────────────────────────── */

const ATTACHMENT_TABLE = "contact_enquiry_attachment";

async function insertAttachments(client, contactEnquiryId, docs) {
  for (const d of docs) {
    await client.query(
      `INSERT INTO ${ATTACHMENT_TABLE}
         (contact_enquiry_id, doc_id, original_name, content_type, byte_size, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (contact_enquiry_id, doc_id) DO NOTHING`,
      [contactEnquiryId, d.doc_id, d.original_name || null, d.content_type, d.byte_size, d.sort_order || 0],
    );
  }
}

/** The vault rows move from the staging reference to the message's own. */
async function refileVault(client, { docIds, from, to }) {
  if (!docIds.length) return 0;
  const { rowCount } = await client.query(
    "UPDATE document_vault SET entity_ref = $1 WHERE doc_id = ANY($2::uuid[]) AND entity_ref = $3",
    [to, docIds, from],
  );
  return rowCount;
}

async function listAttachments(client, contactEnquiryId) {
  const { rows } = await client.query(
    `SELECT a.contact_enquiry_attachment_id, a.doc_id, a.original_name, a.content_type, a.byte_size, a.sort_order, a.created_at
       FROM ${ATTACHMENT_TABLE} a
      WHERE a.contact_enquiry_id = $1
      ORDER BY a.sort_order, a.created_at`,
    [contactEnquiryId],
  );
  return rows;
}

/** One attachment, only if it belongs to this message. */
async function attachmentOf(client, contactEnquiryId, docId) {
  const { rows } = await client.query(
    `SELECT a.doc_id, a.original_name, a.content_type, a.byte_size
       FROM ${ATTACHMENT_TABLE} a
      WHERE a.contact_enquiry_id = $1 AND a.doc_id = $2`,
    [contactEnquiryId, docId],
  );
  return rows[0] || null;
}

/** Delivery bookkeeping: when each email left, or why it did not. */
async function markDelivery(client, id, { inbox = false, ack = false, error } = {}) {
  const sets = [];
  const params = [id];
  if (inbox) sets.push("inbox_notified_at = COALESCE(inbox_notified_at, now())");
  if (ack) sets.push("visitor_acked_at = COALESCE(visitor_acked_at, now())");
  if (error !== undefined) {
    params.push(error === null ? null : String(error).slice(0, 2000));
    sets.push("mail_error = $" + params.length);
  }
  if (!sets.length) return;
  await client.query(`UPDATE ${TABLE} SET ${sets.join(", ")} WHERE contact_enquiry_id = $1`, params);
}

module.exports = {
  insertAttachments, refileVault, listAttachments, attachmentOf, markDelivery, stagedReplyFiles,
  insertEnquiry, getEnquiry, updEnquiry, listEnquiries, listEnquiriesForExport,
  insertResponse, settleResponse, listResponses,
  buildWhere, WRITABLE,
};
