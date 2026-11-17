/** Lead repository (MOD-20) — the company row. All SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

/** Columns a write may set. Everything else is the service's or a migration's. */
const WRITABLE = [
  "entity_id", "company_name", "contact_name", "email", "phone", "country", "address",
  "niu", "rccm", "source", "intake_channel", "service_interest", "client_type_hint",
  "payment_terms_days", "owner_user_id", "status", "client_id", "details_json",
  "archived_reason", "archived_at", "next_step_task_id",
];

/** The stages a request is still being worked in (14511). */
const OPEN_STAGES = ["NEW", "CONTACTED", "MEETING", "QUOTED"];

const insert = (client, data) => insertOne(client, "lead", data, "*", WRITABLE);
const get = (client, id) => getById(client, "lead", "lead_id", id);

/** The row, locked for the rest of the transaction: two writers of one next step queue. */
async function getForUpdate(client, id) {
  const { rows } = await client.query("SELECT * FROM lead WHERE lead_id = $1 FOR UPDATE", [id]);
  return rows[0] || null;
}

async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, "lead", "lead_id", id, fields, "*", WRITABLE, { touch: "updated_at" });
}

/* ─── the duplicate keys (14510) ──────────────────────────────────────────── */

/**
 * The three keys, computed in SQL so they are byte-for-byte the expressions
 * 14510 indexed: folded email; the last nine digits of a phone with at least
 * seven; the folded company name with everything but letters and digits gone.
 */
const KEYS_CTE = `k AS (
  SELECT NULLIF(search_fold($1::text), '') AS ekey,
         CASE WHEN length(regexp_replace(COALESCE($2::text, ''), '[^0-9]', '', 'g')) >= 7
              THEN right(regexp_replace($2::text, '[^0-9]', '', 'g'), 9) END AS pkey,
         NULLIF(regexp_replace(search_fold($3::text), '[^a-z0-9]+', '', 'g'), '') AS ckey,
         NULLIF(btrim(search_fold($3::text)), '') AS cfold
)`;

const EMAIL_MATCH = (col) => `(k.ekey IS NOT NULL AND ${col} IS NOT NULL AND search_fold(${col}::text) = k.ekey)`;
const PHONE_MATCH = (col) =>
  `(k.pkey IS NOT NULL AND ${col} IS NOT NULL AND length(regexp_replace(${col}, '[^0-9]', '', 'g')) >= 7
    AND right(regexp_replace(${col}, '[^0-9]', '', 'g'), 9) = k.pkey)`;
const COMPANY_MATCH = (col) => `(k.ckey IS NOT NULL AND regexp_replace(search_fold(${col}), '[^a-z0-9]+', '', 'g') = k.ckey)`;
// "As you type": the name starts the same way, or reads close enough. Three
// characters before it says anything, so "SA" does not match half the register.
const COMPANY_SIMILAR = (col) =>
  `(k.cfold IS NOT NULL AND length(k.cfold) >= 3
    AND (left(search_fold(${col}), length(k.cfold)) = k.cfold OR similarity(search_fold(${col}), k.cfold) > 0.45))`;

/**
 * Who is already on file for these keys: company rows first, then clients the
 * master knows that have no row yet (a client created in Master Data, never
 * through Sales). `exact` says a key matched outright; a name that only reads
 * alike is a suggestion.
 */
async function duplicates(client, { company = null, email = null, phone = null, excludeId = null, limit = 6 }) {
  const { rows } = await client.query(
    `WITH ${KEYS_CTE},
     leads AS (
       SELECT l.lead_id, l.client_id, l.company_name, l.contact_name, l.email::text AS email, l.phone,
              l.status, l.created_at, cm.name AS client_name,
              ${EMAIL_MATCH("l.email")} AS email_match,
              ${PHONE_MATCH("l.phone")} AS phone_match,
              ${COMPANY_MATCH("l.company_name")} AS company_match,
              ${COMPANY_SIMILAR("l.company_name")} AS company_similar
         FROM lead l CROSS JOIN k
         LEFT JOIN client_master cm ON cm.client_id = l.client_id
        WHERE l.merged_into_lead_id IS NULL
          AND ($4::uuid IS NULL OR l.lead_id <> $4::uuid)
     ),
     clients AS (
       SELECT NULL::uuid AS lead_id, cm.client_id, cm.name AS company_name, NULL::text AS contact_name,
              cm.email::text AS email, cm.phone, 'OPEN'::text AS status, cm.created_at, cm.name AS client_name,
              ${EMAIL_MATCH("cm.email")} AS email_match,
              ${PHONE_MATCH("cm.phone")} AS phone_match,
              (${COMPANY_MATCH("cm.name")} OR ${COMPANY_MATCH("cm.legal_name")}) AS company_match,
              ${COMPANY_SIMILAR("cm.name")} AS company_similar
         FROM client_master cm CROSS JOIN k
        WHERE cm.is_active IS NOT false AND cm.merged_into_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM lead l WHERE l.client_id = cm.client_id)
     )
     SELECT * FROM (SELECT * FROM leads UNION ALL SELECT * FROM clients) x
      WHERE x.email_match OR x.phone_match OR x.company_match OR x.company_similar
      ORDER BY (x.email_match OR x.phone_match OR x.company_match) DESC,
               (x.client_id IS NOT NULL) DESC, (x.status = 'OPEN') DESC, x.created_at
      LIMIT $5`,
    [email, phone, company, excludeId, limit],
  );
  return rows;
}

/**
 * The company row of a client, if it has one. One per client (ux_lead_client),
 * so this is a lookup, not a choice.
 */
async function forClient(client, clientId) {
  const { rows } = await client.query(
    "SELECT * FROM lead WHERE client_id = $1 AND merged_into_lead_id IS NULL LIMIT 1",
    [clientId],
  );
  return rows[0] || null;
}

/** What a client row is made from: the client master's own facts. */
async function clientFacts(client, clientId) {
  const { rows } = await client.query(
    `SELECT cm.client_id, cm.name, cm.email::text AS email, cm.phone, cm.country_code, cm.address,
            cm.niu, cm.rccm, cm.entity_id, cm.payment_terms_days,
            CASE WHEN u.status = 'ACTIVE' THEN cm.relationship_manager_user_id END AS account_manager_user_id
       FROM client_master cm
       LEFT JOIN app_user u ON u.user_id = cm.relationship_manager_user_id
      WHERE cm.client_id = $1`,
    [clientId],
  );
  return rows[0] || null;
}

/* ─── the requests on a row ───────────────────────────────────────────────── */

/** How many of the row's requests are still being worked. */
async function openRequestCount(client, leadId) {
  const { rows } = await client.query(
    "SELECT count(*)::int AS n FROM quote_request WHERE lead_id = $1 AND stage = ANY($2::text[])",
    [leadId, OPEN_STAGES],
  );
  return rows[0] ? rows[0].n : 0;
}

/** The row's open requests, for Archive to close them. */
async function openRequests(client, leadId) {
  const { rows } = await client.query(
    "SELECT * FROM quote_request WHERE lead_id = $1 AND stage = ANY($2::text[]) ORDER BY created_at",
    [leadId, OPEN_STAGES],
  );
  return rows;
}

/* ─── activities (14513) ──────────────────────────────────────────────────── */

async function insertActivity(client, data) {
  return insertOne(client, "lead_activity", data, "*",
    ["lead_id", "quote_request_id", "kind", "body", "occurred_at", "author_user_id"]);
}

/** Does this request sit on this row? An activity may only name one of its own. */
async function requestOnLead(client, { leadId, quoteRequestId }) {
  const { rows } = await client.query(
    "SELECT 1 FROM quote_request WHERE quote_request_id = $1 AND lead_id = $2",
    [quoteRequestId, leadId],
  );
  return rows.length > 0;
}

/* ─── the list (§3.2) ─────────────────────────────────────────────────────── */

/**
 * A chip's WHERE. No view is every row that is not a merged-away duplicate,
 * which is what the register before the revamp read.
 */
function viewWhere(view, params, userId) {
  switch (view) {
    case "mine":
      params.push(userId);
      return [`l.status = 'OPEN'`, `l.owner_user_id = $${params.length}`];
    case "open": return [`l.status = 'OPEN'`];
    case "prospects": return [`l.status = 'OPEN'`, "l.client_id IS NULL"];
    case "clients": return [`l.status = 'OPEN'`, "l.client_id IS NOT NULL"];
    case "archived": return [`l.status = 'ARCHIVED'`];
    default: return [];
  }
}

/**
 * The live next step of a row, as a join. A pointer at a task that is done,
 * cancelled or deleted is no next step at all.
 */
const NEXT_STEP_JOIN = `LEFT JOIN task t ON t.task_id = l.next_step_task_id
  AND t.is_deleted = false AND t.status NOT IN ('DONE', 'CANCELLED')`;

/** Open value per row: the open requests' estimates, and their one currency (NULL when mixed). */
const OPEN_VALUE_JOIN = `LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(q.estimated_value), 0) AS open_value,
         CASE WHEN count(DISTINCT q.currency) <= 1 THEN max(q.currency) END AS open_currency,
         count(*)::int AS open_requests
    FROM quote_request q
   WHERE q.lead_id = l.lead_id AND q.stage IN ('NEW', 'CONTACTED', 'MEETING', 'QUOTED')
) ov ON true`;

/**
 * The WHERE for a list call, built ONCE and shared by the rows, the total and
 * the tiles — a list and its own summary built from two WHERE clauses is how
 * they come to disagree.
 *
 * `includeDue` is the only difference: the tiles drop the due filter (Due Today
 * must still say how many are overdue while Due Today is the filter on).
 */
function buildWhere(q = {}, { userId = null, todayEnd = null, includeDue = true } = {}) {
  const params = [];
  const wh = ["l.merged_into_lead_id IS NULL", ...viewWhere(q.view, params, userId)];
  if (q.owner_user_id) { params.push(q.owner_user_id); wh.push(`l.owner_user_id = $${params.length}`); }
  if (includeDue && q.due === "overdue") wh.push("t.due_at < now()");
  if (includeDue && q.due === "today") {
    params.push(todayEnd);
    wh.push(`t.due_at >= now() AND t.due_at < $${params.length}::timestamptz`);
  }
  if (q.has_value === "true") wh.push("ov.open_value > 0");
  if (q.q) {
    params.push(q.q);
    const i = params.length;
    // Folded, and `strpos` rather than LIKE so a typed % or _ is a character,
    // not a wildcard. A request's reference finds its company (§3.2).
    wh.push(`(strpos(search_fold(l.company_name), search_fold($${i})) > 0
      OR strpos(search_fold(l.contact_name), search_fold($${i})) > 0
      OR strpos(search_fold(l.email::text), search_fold($${i})) > 0
      OR (length(regexp_replace($${i}, '[^0-9]', '', 'g')) >= 4
          AND strpos(regexp_replace(COALESCE(l.phone, ''), '[^0-9]', '', 'g'), regexp_replace($${i}, '[^0-9]', '', 'g')) > 0)
      OR EXISTS (SELECT 1 FROM quote_request rq
                  WHERE rq.lead_id = l.lead_id AND strpos(search_fold(rq.public_ref), search_fold($${i})) > 0))`);
  }
  return { where: "WHERE " + wh.join(" AND "), params };
}

/** Soonest next step first while working; newest archive first in Archived. */
function orderOf(q = {}) {
  if (q.view === "archived") return "ORDER BY l.archived_at DESC NULLS LAST, l.updated_at DESC";
  if (q.view === "mine" || q.view === "open" || q.view === "prospects" || q.view === "clients" || q.due) {
    return "ORDER BY t.due_at ASC NULLS LAST, l.created_at DESC";
  }
  return "ORDER BY l.created_at DESC";
}

const LIST_FROM = `lead l
  LEFT JOIN client_master cm ON cm.client_id = l.client_id
  LEFT JOIN app_user u ON u.user_id = l.owner_user_id
  ${NEXT_STEP_JOIN}
  ${OPEN_VALUE_JOIN}`;

const LIST_COLUMNS = `l.*, (l.client_id IS NOT NULL) AS is_client, cm.name AS client_name, u.full_name AS owner_name,
  t.title AS next_step_action, t.due_at AS next_step_due_at, t.assigned_to AS next_step_assigned_to,
  (t.task_id IS NOT NULL AND t.due_at < now()) AS next_step_overdue,
  ov.open_value, ov.open_currency, ov.open_requests`;

/** One page, its total, and the three tiles over the same set. */
async function list(client, q = {}, { userId = null, todayEnd = null } = {}) {
  const { limit, offset } = page(q);
  const { where, params } = buildWhere(q, { userId, todayEnd });
  const { rows } = await client.query(
    `SELECT ${LIST_COLUMNS} FROM ${LIST_FROM} ${where} ${orderOf(q)}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    params.concat([limit, offset]),
  );
  const { rows: totalRows } = await client.query(`SELECT count(*)::int AS n FROM ${LIST_FROM} ${where}`, params);

  const tq = buildWhere(q, { userId, todayEnd, includeDue: false });
  tq.params.push(todayEnd);
  const te = tq.params.length;
  const { rows: tileRows } = await client.query(
    `SELECT count(*) FILTER (WHERE t.due_at >= now() AND t.due_at < $${te}::timestamptz)::int AS due_today,
            count(*) FILTER (WHERE t.due_at < now())::int AS overdue,
            COALESCE(SUM(ov.open_value), 0) AS open_value,
            CASE WHEN count(DISTINCT ov.open_currency) FILTER (WHERE ov.open_value > 0) <= 1
                 THEN max(ov.open_currency) FILTER (WHERE ov.open_value > 0) END AS open_currency
       FROM ${LIST_FROM} ${tq.where}`,
    tq.params,
  );
  return { rows, total: totalRows[0] ? totalRows[0].n : 0, tiles: tileRows[0] || {}, limit, offset };
}

/* ─── owners ──────────────────────────────────────────────────────────────── */

/** The user if their login is ACTIVE, else null. */
async function activeUser(client, userId) {
  if (!userId) return null;
  const { rows } = await client.query("SELECT user_id FROM app_user WHERE user_id = $1 AND status = 'ACTIVE'", [userId]);
  return rows[0] ? rows[0].user_id : null;
}

/** The first active CEO-role user: today's MD, the owner of last resort (§3.2). */
async function firstCeo(client) {
  const { rows } = await client.query(
    `SELECT u.user_id FROM app_user u
       JOIN user_role ur ON ur.user_id = u.user_id
       JOIN role r ON r.role_id = ur.role_id
      WHERE r.code = 'CEO' AND u.status = 'ACTIVE'
      ORDER BY u.created_at, u.user_id
      LIMIT 1`,
  );
  return rows[0] ? rows[0].user_id : null;
}

/**
 * The tenant's default corporate entity, or null when the choice is genuinely
 * ambiguous. Same rule as the intake register's: one active entity is a
 * default, two is a question. Never "the oldest": that files a client, and its
 * reference number, under the wrong company.
 */
async function defaultEntityId(client) {
  const { rows } = await client.query(
    "SELECT entity_id FROM corporate_entity WHERE is_active IS NOT false LIMIT 2",
  );
  return rows.length === 1 ? rows[0].entity_id : null;
}

/**
 * Resolve a client_type CODE ('SHIPPER', 'BOTH', …) to its id.
 *
 * `client_master` has a `client_type_id` FK and NO `client_type` column, so the
 * code Make Client collects is looked up before the master row is written.
 * Passing the code straight through reached `insertOne` with an allow-list of
 * null and Postgres answered 42703, for every lead (citext PK on `code`, so the
 * comparison is already case-insensitive).
 */
async function clientTypeIdByCode(client, code) {
  if (!code) return null;
  const { rows } = await client.query("SELECT client_type_id FROM client_type WHERE code = $1", [code]);
  return rows[0] ? rows[0].client_type_id : null;
}

module.exports = {
  insert, get, getForUpdate, update, duplicates, forClient, clientFacts,
  openRequestCount, openRequests, insertActivity, requestOnLead,
  list, buildWhere, activeUser, firstCeo, defaultEntityId, clientTypeIdByCode,
  WRITABLE, OPEN_STAGES,
};
