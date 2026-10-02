/** Quote request (MOD-20-intake) — repository. All SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const TABLE = "quote_request";
const ATTACHMENT_TABLE = "quote_request_attachment";

/**
 * Coerce empty string to null for nullable text columns. The legacy PHP sent
 * `""` for blank form fields and they landed as `""`, so `WHERE
 * service_category = $n` matched nothing and the filter looked broken.
 */
const blankToNull = (v) => (v === "" || v === undefined ? null : v);

/** Columns a caller may write. Everything else is set by the service or a trigger. */
const WRITABLE = [
  "entity_id", "public_ref", "lead_id", "intake_channel",
  "requester_name", "requester_company", "requester_email", "requester_phone",
  "service_category", "service_type", "origin_location", "destination_location",
  "warehouse_location", "warehouse_duration", "estimated_weight",
  "project_cargo_flag", "cargo_description", "incoterm", "owner_user_id",
  // 12756 — what a website request can carry that a phone call cannot.
  "additional_notes", "origin_place_id", "destination_place_id", "attachment_doc_id",
  // 14220 — the two doors either side of the main leg (portal quote sheet).
  "collection_location", "delivery_location", "collection_place_id", "delivery_place_id",
  // 14310 — the service type the request asks for, which way a hinterland
  // transit runs, and the client the request is FOR (meeting 6, PR 2).
  "service_type_id", "hinterland_direction", "client_id",
];

/**
 * INSERT.
 *
 * `public_ref` is written HERE, in the same statement as the row — not by a
 * follow-up UPDATE. The previous shape inserted the row, allocated the number,
 * then updated; `public_ref` was also absent from this field map, so a
 * caller-supplied reference was silently discarded and the column relied
 * entirely on the second write landing. One statement, one row, one number.
 */
function insert(client, data) {
  const row = {
    entity_id: blankToNull(data.entity_id),
    public_ref: blankToNull(data.public_ref),
    lead_id: blankToNull(data.lead_id),
    // A signed-in client quoting from the portal files the request against
    // their own record (migration 10705); sales sees it in the same intake
    // queue, linked back to the client.
    client_id: blankToNull(data.client_id),
    intake_channel: data.intake_channel || "MANUAL",
    requester_name: blankToNull(data.requester_name),
    requester_company: blankToNull(data.requester_company),
    requester_email: blankToNull(data.requester_email),
    requester_phone: blankToNull(data.requester_phone),
    service_category: blankToNull(data.service_category),
    service_type: blankToNull(data.service_type),
    // 14310 — the structured service, and the direction of a hinterland
    // transit. Resolved by the service before it gets here; never a raw id
    // from a body (see quote_request.service resolveService).
    service_type_id: blankToNull(data.service_type_id),
    hinterland_direction: blankToNull(data.hinterland_direction),
    origin_location: blankToNull(data.origin_location),
    destination_location: blankToNull(data.destination_location),
    warehouse_location: blankToNull(data.warehouse_location),
    warehouse_duration: blankToNull(data.warehouse_duration),
    estimated_weight: data.estimated_weight ?? null,
    project_cargo_flag: data.project_cargo_flag || false,
    cargo_description: blankToNull(data.cargo_description),
    additional_notes: blankToNull(data.additional_notes),
    // Geocoded server-side or not at all — see public_intake.service. The text
    // columns above stay authoritative for reading; these are the enrichment
    // beside them, and NULL is the ordinary case rather than a broken one.
    origin_place_id: blankToNull(data.origin_place_id),
    destination_place_id: blankToNull(data.destination_place_id),
    // 14220 — where we collect before the main leg and deliver after it. Same
    // text + verified-place pairing as the two ends above, and just as
    // optional: a port-to-port request has neither.
    collection_location: blankToNull(data.collection_location),
    collection_place_id: blankToNull(data.collection_place_id),
    delivery_location: blankToNull(data.delivery_location),
    delivery_place_id: blankToNull(data.delivery_place_id),
    attachment_doc_id: blankToNull(data.attachment_doc_id),
    incoterm: data.incoterm,
    status: "RECEIVED",
    owner_user_id: blankToNull(data.owner_user_id),
    created_by_user_id: blankToNull(data.created_by_user_id),
  };
  return insertOne(client, TABLE, row);
}

function get(client, id) {
  return getById(client, TABLE, "quote_request_id", id);
}

async function update(client, id, fields) {
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, TABLE, "quote_request_id", id, fields, "*", null, { touch: "updated_at" });
}

/**
 * The tenant's default corporate entity, for numbering.
 *
 * Returns the single active entity, or null when there are none or more than
 * one. Null is deliberate and is NOT "pick the oldest": a tenant trading
 * through two entities has no default, and guessing would file an enquiry — and
 * its reference number — under the wrong company. The service turns null into a
 * 422 naming the field, so the operator chooses.
 */
async function defaultEntityId(client) {
  const { rows } = await client.query(
    "SELECT entity_id FROM corporate_entity WHERE is_active IS NOT false LIMIT 2",
  );
  return rows.length === 1 ? rows[0].entity_id : null;
}

/* ─── filtering ───────────────────────────────────────────────────────────── */

/**
 * ONE WHERE builder, used by the list, the total, the KPI and the export.
 *
 * `includeStatus` is the only difference between them. Four hand-copied WHERE
 * clauses is how the list and its own summary drift apart, which is the defect
 * class this feature is correcting — so they are built from one function and
 * the divergence is a single boolean.
 */
function buildWhere(q = {}, { includeStatus = true } = {}) {
  const wh = [];
  const params = [];
  // Qualified with `q.` because the list joins service_type and client_master,
  // both of which have a created_at — an unqualified one is "ambiguous".
  if (includeStatus && q.status) { params.push(q.status); wh.push("q.status = $" + params.length); }
  if (q.intake_channel) { params.push(q.intake_channel); wh.push("q.intake_channel = $" + params.length); }
  if (q.service_category) { params.push(q.service_category); wh.push("q.service_category = $" + params.length); }
  if (q.service_type_id) { params.push(q.service_type_id); wh.push("q.service_type_id = $" + params.length); }
  if (q.entity_id) { params.push(q.entity_id); wh.push("q.entity_id = $" + params.length); }
  // A client's own requests (Client 360, the chat's "File on a quote request").
  if (q.client_id) { params.push(q.client_id); wh.push("q.client_id = $" + params.length); }
  // Still being worked: neither converted nor closed. The chat files onto
  // these, and only these — a closed request is history.
  if (q.open === true || q.open === "1" || q.open === "true") {
    wh.push("q.status NOT IN ('CONVERTED_TO_OPPORTUNITY', 'CLOSED_NO_ACTION')");
  }
  if (q.month) { params.push(Number(q.month)); wh.push("EXTRACT(MONTH FROM q.created_at) = $" + params.length); }
  if (q.year) { params.push(Number(q.year)); wh.push("EXTRACT(YEAR FROM q.created_at) = $" + params.length); }
  if (q.q) {
    params.push("%" + q.q + "%");
    const i = params.length;
    wh.push(
      `(q.public_ref ILIKE $${i} OR q.requester_name ILIKE $${i} OR q.requester_email ILIKE $${i}` +
      ` OR q.requester_company ILIKE $${i} OR q.origin_location ILIKE $${i}` +
      ` OR q.destination_location ILIKE $${i} OR q.cargo_description ILIKE $${i})`,
    );
  }
  return { where: wh.length ? "WHERE " + wh.join(" AND ") : "", params };
}

const SORTABLE = ["created_at", "public_ref", "status", "requester_name"];
const orderBy = (q = {}) =>
  `ORDER BY q.${SORTABLE.includes(q.sort) ? q.sort : "created_at"} ${q.dir === "asc" ? "ASC" : "DESC"}`;

/**
 * The row as every list reads it: the request, plus the words a person needs
 * beside it — the service's names and card (so the desk shows "Sea Freight
 * Import", never SEA_FREIGHT_IMPORT) and the client it is for.
 */
const LIST_FROM = `quote_request q
  LEFT JOIN service_type st ON st.service_type_id = q.service_type_id
  LEFT JOIN client_master cm ON cm.client_id = q.client_id`;
const LIST_COLUMNS = `q.*, st.name_en AS service_name_en, st.name_fr AS service_name_fr,
  st.transport_mode AS service_mode, st.territory AS service_territory, cm.name AS client_name`;

/**
 * List + total + the KPI GROUP BY.
 *
 * The KPI drops the STATUS filter and keeps every other one, so a user looking
 * at status=QUOTED still sees the whole summary rather than one tile equal to
 * the total and the rest at zero (which is a tautology, not data). It groups by
 * status with no hand-written list of which statuses count — the fold in
 * `rules.kpiFrom` owns that, and it is proven to partition.
 */
async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const { where, params } = buildWhere(q);

  const { rows } = await client.query(
    `SELECT ${LIST_COLUMNS} FROM ${LIST_FROM} ${where} ${orderBy(q)} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    params.concat([limit, offset]),
  );

  const { rows: totalRows } = await client.query(`SELECT COUNT(*)::int AS c FROM ${TABLE} q ${where}`, params);

  const kpiQ = buildWhere(q, { includeStatus: false });
  const { rows: kpiRows } = await client.query(
    `SELECT q.status, COUNT(*)::int AS c FROM ${TABLE} q ${kpiQ.where} GROUP BY q.status`,
    kpiQ.params,
  );

  return { rows, total: totalRows[0] ? totalRows[0].c : 0, kpiRows, limit, offset };
}

/**
 * Every matching row, unpaginated — for the CSV export ONLY.
 *
 * Separate from list() on purpose. The export used to call list() with
 * `pageSize: 100000`, and `page()` reads `limit`/`offset` and clamps to 200, so
 * `pageSize` was ignored entirely and the export silently wrote the first 50
 * rows. A truncated export that reports no error is worse than one that
 * refuses: the operator opens it in Excel and believes it.
 *
 * `cap` bounds the statement so an export cannot become an unbounded scan; the
 * caller is told when it bites (see the service) rather than being handed a
 * prefix.
 */
async function listForExport(client, q = {}, cap = 10000) {
  const { where, params } = buildWhere(q);
  const { rows } = await client.query(
    `SELECT ${LIST_COLUMNS} FROM ${LIST_FROM} ${where} ${orderBy(q)} LIMIT $${params.length + 1}`,
    params.concat([cap + 1]),
  );
  return { rows: rows.slice(0, cap), truncated: rows.length > cap };
}

/* ─── attachments ─────────────────────────────────────────────────────────── */

function addAttachment(client, { quote_request_id, vault_id, kind = "ADDITIONAL", uploaded_by_user_id = null, document_kind = null }) {
  return insertOne(client, ATTACHMENT_TABLE, { quote_request_id, vault_id, kind, uploaded_by_user_id, document_kind });
}

async function listAttachments(client, quote_request_id) {
  const { rows } = await client.query(
    `SELECT a.quote_request_attachment_id AS id, a.kind, a.document_kind, a.created_at, a.vault_id,
            v.storage_path, v.original_name, v.content_hash
       FROM ${ATTACHMENT_TABLE} a
       LEFT JOIN document_vault v ON v.doc_id = a.vault_id
      WHERE a.quote_request_id = $1
      ORDER BY (CASE WHEN a.kind = 'PRIMARY' THEN 0 ELSE 1 END), a.created_at`,
    [quote_request_id],
  );
  return rows;
}

async function getAttachment(client, { quote_request_id, attachment_id }) {
  const { rows } = await client.query(
    `SELECT * FROM ${ATTACHMENT_TABLE} WHERE quote_request_attachment_id = $1 AND quote_request_id = $2`,
    [attachment_id, quote_request_id],
  );
  return rows[0] || null;
}

async function removeAttachment(client, { quote_request_id, attachment_id }) {
  const { rowCount } = await client.query(
    `DELETE FROM ${ATTACHMENT_TABLE} WHERE quote_request_attachment_id = $1 AND quote_request_id = $2`,
    [attachment_id, quote_request_id],
  );
  return rowCount > 0;
}

/** Demote whatever is currently PRIMARY, so at most one ever is. */
async function demotePrimary(client, quote_request_id) {
  await client.query(
    `UPDATE ${ATTACHMENT_TABLE} SET kind = 'ADDITIONAL' WHERE quote_request_id = $1 AND kind = 'PRIMARY'`,
    [quote_request_id],
  );
}


/** True when this document is already linked to this request — filing it twice is a no-op. */
async function attachmentByVault(client, { quote_request_id, vault_id }) {
  const { rows } = await client.query(
    `SELECT * FROM ${ATTACHMENT_TABLE} WHERE quote_request_id = $1 AND vault_id = $2 LIMIT 1`,
    [quote_request_id, vault_id],
  );
  return rows[0] || null;
}

async function hasPrimary(client, quote_request_id) {
  const { rows } = await client.query(
    `SELECT 1 FROM ${ATTACHMENT_TABLE} WHERE quote_request_id = $1 AND kind = 'PRIMARY' LIMIT 1`,
    [quote_request_id],
  );
  return rows.length > 0;
}

/**
 * Re-file vault rows under the request they now belong to. Only rows still
 * filed under `from` move, so a document that is already somebody else's is
 * never taken.
 */
async function refileVault(client, { docIds, from, to }) {
  if (!docIds.length) return 0;
  const { rowCount } = await client.query(
    "UPDATE document_vault SET entity_ref = $1 WHERE doc_id = ANY($2::uuid[]) AND entity_ref = $3",
    [to, docIds, from],
  );
  return rowCount;
}

/* ─── the service a request names (14300 / 14310) ──────────────────────────── */

/**
 * One service type as a request needs it: its names, its card and flow, the
 * Incoterms it offers, the questions its enquiry asks, and whether it is on the
 * public website. Archived ones come back too — the caller decides whether an
 * inactive service is acceptable (a request keeps the service it was filed
 * under after that service is archived).
 */
async function serviceTypeById(client, id) {
  const { rows } = await client.query(
    `SELECT st.service_type_id, st.key, st.name_en, st.name_fr, st.territory,
            st.transport_mode, st.incoterms, st.enquiry_shape, st.is_active,
            EXISTS (SELECT 1 FROM service_type_web_profile p
                     WHERE p.service_type_id = st.service_type_id AND p.is_published = true) AS is_published
       FROM service_type st
      WHERE st.service_type_id = $1`,
    [id],
  );
  return rows[0] || null;
}

/**
 * Every active service type, as a quote wizard offers them — the portal's list
 * (all active) or the website's (active AND published). Ordered by name so the
 * order a card's services appear in is stable.
 */
async function quoteServices(client, { publishedOnly = false } = {}) {
  const { rows } = await client.query(
    `SELECT st.service_type_id, st.key, st.name_en, st.name_fr, st.territory,
            st.transport_mode, st.incoterms, st.enquiry_shape
       FROM service_type st
      WHERE st.is_active = true
        ${publishedOnly ? `AND EXISTS (SELECT 1 FROM service_type_web_profile p
                                        WHERE p.service_type_id = st.service_type_id AND p.is_published = true)` : ""}
      ORDER BY COALESCE(st.name_en, st.name_fr) ASC`,
  );
  return rows;
}

/* ─── the client a request is for (14310, owner decision Q5) ───────────────── */

/** The client, its name, and its account manager when that login is active. */
async function clientForLink(client, clientId) {
  const { rows } = await client.query(
    `SELECT cm.client_id, cm.name, cm.is_active,
            CASE WHEN u.status = 'ACTIVE' THEN cm.relationship_manager_user_id END AS account_manager_user_id
       FROM client_master cm
       LEFT JOIN app_user u ON u.user_id = cm.relationship_manager_user_id
      WHERE cm.client_id = $1`,
    [clientId],
  );
  return rows[0] || null;
}

/**
 * Which client an address belongs to — exact first, then by company domain.
 *
 * Exact: a client contact, or the client record itself, with that address.
 * Domain: any contact or client address on that domain, or the client's
 * website host. Active clients only, and each candidate says how it matched,
 * so the form can tell "this is Ada at GOUM" from "someone at goum-intl.cm".
 * The caller never passes a public webmail domain (emailDomain).
 */
async function clientCandidates(client, { email, domain }) {
  const { rows } = await client.query(
    `WITH hits AS (
       SELECT cc.client_id, 'CONTACT_EMAIL'::text AS matched_on, 1 AS rank
         FROM client_contact cc
        WHERE cc.is_active AND lower(cc.email::text) = lower($1)
       UNION ALL
       SELECT cm.client_id, 'CLIENT_EMAIL', 1
         FROM client_master cm
        WHERE lower(cm.email::text) = lower($1)
       UNION ALL
       SELECT cc.client_id, 'DOMAIN', 2
         FROM client_contact cc
        WHERE $2::text IS NOT NULL AND cc.is_active
          AND lower(split_part(cc.email::text, '@', 2)) = $2
       UNION ALL
       SELECT cm.client_id, 'DOMAIN', 2
         FROM client_master cm
        WHERE $2::text IS NOT NULL
          AND (lower(split_part(cm.email::text, '@', 2)) = $2
               OR lower(regexp_replace(regexp_replace(COALESCE(cm.website, ''), '^[a-z]+://', '', 'i'), '^www\\.|/.*$', '', 'gi')) = $2)
     )
     SELECT h.client_id, cm.name, min(h.rank) AS rank,
            (array_agg(h.matched_on ORDER BY h.rank))[1] AS matched_on,
            count(*)::int AS hits
       FROM hits h
       JOIN client_master cm ON cm.client_id = h.client_id AND cm.is_active
      GROUP BY h.client_id, cm.name
      ORDER BY min(h.rank), count(*) DESC, cm.name
      LIMIT 5`,
    [email, domain],
  );
  return rows;
}

/* ─── documents a client sends with a request (14310, owner decision Q4) ───── */

/** Where a portal document waits between its upload and the request it is sent with. */
const STAGED_REF = "quote_request:staged";

/**
 * The staged documents among `docIds` that belong to this client and are still
 * waiting — not archived, not yet linked to any request. The caller compares
 * the count with what it asked for: anything missing is not this client's to send.
 */
async function stagedDocuments(client, { clientId, docIds }) {
  const { rows } = await client.query(
    `SELECT v.doc_id, v.original_name
       FROM document_vault v
      WHERE v.doc_id = ANY($1::uuid[])
        AND v.client_id = $2
        AND v.entity_ref = $3
        AND v.status <> 'ARCHIVED'
        AND NOT EXISTS (SELECT 1 FROM ${ATTACHMENT_TABLE} a WHERE a.vault_id = v.doc_id)`,
    [docIds, clientId, STAGED_REF],
  );
  return rows;
}

/** Staged documents nobody sent, older than `cutoff` — the sweep's work list. */
async function abandonedStaged(client, cutoff, limit = 200) {
  const { rows } = await client.query(
    `SELECT v.doc_id, v.storage_path
       FROM document_vault v
      WHERE v.entity_ref = $1
        AND v.status <> 'ARCHIVED'
        AND v.created_at < $2
        AND NOT EXISTS (SELECT 1 FROM ${ATTACHMENT_TABLE} a WHERE a.vault_id = v.doc_id)
      ORDER BY v.created_at
      LIMIT $3`,
    [STAGED_REF, cutoff, limit],
  );
  return rows;
}

/**
 * Archive one abandoned staged document — guarded in the UPDATE itself, so a
 * request that links it while the sweep runs wins the race and nothing is
 * archived from under it.
 */
async function archiveAbandonedStaged(client, docId) {
  const { rowCount } = await client.query(
    `UPDATE document_vault v SET status = 'ARCHIVED'
      WHERE v.doc_id = $1 AND v.entity_ref = $2 AND v.status <> 'ARCHIVED'
        AND NOT EXISTS (SELECT 1 FROM ${ATTACHMENT_TABLE} a WHERE a.vault_id = v.doc_id)`,
    [docId, STAGED_REF],
  );
  return rowCount > 0;
}

/**
 * A file a client sent in their portal chat, with the client whose thread it
 * is in — what "File on a quote request" links (14170's attachment table).
 */
async function chatAttachment(client, attachmentId) {
  const { rows } = await client.query(
    `SELECT a.attachment_id, a.doc_id, a.kind, a.file_name, m.client_id, m.direction
       FROM client_message_attachment a
       JOIN client_message m ON m.message_id = a.message_id
      WHERE a.attachment_id = $1`,
    [attachmentId],
  );
  return rows[0] || null;
}

/* ─── the client's view (the portal) ──────────────────────────────────────── */

/**
 * The lifecycle as the request's own audit trail records it — created, each
 * transition, converted. Oldest first: it is drawn as a timeline. Only the
 * action and the time leave; who did it and what changed stay with the team.
 */
async function lifecycle(client, quoteRequestId) {
  const { rows } = await client.query(
    `SELECT action, created_at AS at
       FROM immutable_ledger
      WHERE entity_ref = $1
        AND (action = 'quote_request.created' OR action = 'quote_request.converted'
             OR action = ANY($2::text[]))
      ORDER BY created_at ASC, ledger_id ASC
      LIMIT 50`,
    ["quote_request:" + quoteRequestId, LIFECYCLE_ACTIONS],
  );
  return rows;
}
/**
 * The proposal that answered a request, as its client may see it: reached
 * through the opportunity the request became (a request has no proposal link of
 * its own), the client's own, and only once it has been sent. Newest first.
 */
async function answeringProposal(client, { opportunityId, clientId }) {
  const { rows } = await client.query(
    `SELECT p.proposal_id, p.doc_number, p.title, p.status, p.currency, p.created_at
       FROM proposal p
      WHERE p.opportunity_id = $1 AND p.client_id = $2
        AND p.status IN ('SENT', 'ACCEPTED', 'REJECTED')
      ORDER BY p.created_at DESC
      LIMIT 1`,
    [opportunityId, clientId],
  );
  return rows[0] || null;
}

/**
 * The commercial quotation that answered a request (meeting 6, PR 4): linked
 * by `quotation.quote_request_id`, the client's own, never a DRAFT. Newest
 * first; an EXPIRED-by-date SENT one is reported as such by the portal.
 */
async function answeringQuotation(client, { quoteRequestId, clientId }) {
  const { rows } = await client.query(
    `SELECT q.quotation_id, q.doc_number, q.status, q.currency, q.total_ttc, q.valid_until, q.created_at
       FROM quotation q
      WHERE q.quote_request_id = $1 AND q.client_id = $2
        AND q.status IN ('SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED')
      ORDER BY COALESCE(q.sent_at, q.created_at) DESC
      LIMIT 1`,
    [quoteRequestId, clientId],
  );
  return rows[0] || null;
}

const LIFECYCLE_ACTIONS = [
  "quote_request.under_review",
  "quote_request.clarification_required",
  "quote_request.quoted",
  "quote_request.converted_to_opportunity",
  "quote_request.closed_no_action",
];

module.exports = {
  insert, get, update, list, listForExport, defaultEntityId,
  addAttachment, listAttachments, getAttachment, removeAttachment, demotePrimary,
  attachmentByVault, hasPrimary, refileVault,
  serviceTypeById, quoteServices, clientForLink, clientCandidates,
  stagedDocuments, abandonedStaged, archiveAbandonedStaged, chatAttachment, lifecycle, answeringProposal, answeringQuotation,
  buildWhere, WRITABLE, STAGED_REF,
};
