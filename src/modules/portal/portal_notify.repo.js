/**
 * Client portal notifications (14180) — SQL.
 *
 * Every read that decides WHO is told is scoped to one client in SQL, and goes
 * through the same grant rule as signing in: a person's effective CLIENT grant
 * is their newest active one (portal.repo.activeFor), so somebody moved to
 * another company's account is not still told about this one.
 */
"use strict";

/* ── settings ──────────────────────────────────────────────────────────── */

async function setting(client, { clientId, email }) {
  const { rows } = await client.query(
    "SELECT language, email_off, push_off FROM portal_notify_setting WHERE client_id = $1 AND subject_email = $2",
    [clientId, email],
  );
  return rows[0] || null;
}

async function saveSetting(client, { clientId, email, language, emailOff, pushOff }) {
  const { rows } = await client.query(
    `INSERT INTO portal_notify_setting (client_id, subject_email, language, email_off, push_off)
     VALUES ($1, $2, $3, $4::text[], $5::text[])
     ON CONFLICT (client_id, subject_email) DO UPDATE
       SET language = COALESCE(EXCLUDED.language, portal_notify_setting.language),
           email_off = EXCLUDED.email_off, push_off = EXCLUDED.push_off, updated_at = now()
     RETURNING language, email_off, push_off`,
    [clientId, email, language || null, emailOff, pushOff],
  );
  return rows[0];
}

/**
 * Remember the language a person reads the portal in, without touching their
 * choices — the first device they allow notifications on is where it is learnt.
 */
async function rememberLanguage(client, { clientId, email, language, emailOff, pushOff }) {
  await client.query(
    `INSERT INTO portal_notify_setting (client_id, subject_email, language, email_off, push_off)
     VALUES ($1, $2, $3, $4::text[], $5::text[])
     ON CONFLICT (client_id, subject_email) DO UPDATE SET language = EXCLUDED.language, updated_at = now()`,
    [clientId, email, language, emailOff, pushOff],
  );
}

/* ── devices (always the LIVE schema: a device is identity) ────────────── */

async function saveDevice(client, { portalUserId, endpoint, p256dh, auth, userAgent, vapidKeyHash }) {
  await client.query(
    `INSERT INTO portal_push_subscription (endpoint, portal_user_id, p256dh, auth, user_agent, vapid_key_hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (endpoint) DO UPDATE
       SET portal_user_id = EXCLUDED.portal_user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
           user_agent = EXCLUDED.user_agent,
           vapid_key_hash = COALESCE(EXCLUDED.vapid_key_hash, portal_push_subscription.vapid_key_hash),
           last_error = NULL, last_failed_at = NULL`,
    [endpoint, portalUserId, p256dh, auth, userAgent || null, vapidKeyHash || null],
  );
}

/** Only this person's own device: an endpoint alone never removes someone else's. */
async function deleteDevice(client, { portalUserId, endpoint }) {
  const { rowCount } = await client.query(
    "DELETE FROM portal_push_subscription WHERE endpoint = $1 AND portal_user_id = $2",
    [endpoint, portalUserId],
  );
  return rowCount;
}

async function countDevices(client, portalUserId) {
  const { rows } = await client.query(
    "SELECT count(*)::int AS n FROM portal_push_subscription WHERE portal_user_id = $1",
    [portalUserId],
  );
  return rows[0] ? rows[0].n : 0;
}

/* ── who is told ───────────────────────────────────────────────────────── */

/**
 * The people at this client who can be told anything: an effective CLIENT
 * grant here, not expired, and a portal login that is active and has been
 * used — an invitation nobody has accepted yet is not a subscription to news.
 */
async function audience(client, { clientId }) {
  const { rows } = await client.query(
    `WITH here AS (
       SELECT DISTINCT subject_email FROM portal_access
        WHERE portal = 'CLIENT' AND client_id = $1 AND is_active
     ), effective AS (
       SELECT DISTINCT ON (a.subject_email) a.*
         FROM portal_access a
         JOIN here h ON h.subject_email = a.subject_email
        WHERE a.portal = 'CLIENT' AND a.is_active
        ORDER BY a.subject_email, a.created_at DESC
     )
     SELECT e.subject_email AS email, e.access_scope AS scope, e.created_at AS granted_at,
            u.portal_user_id, u.full_name,
            s.language, s.email_off, s.push_off,
            (SELECT count(*) FROM portal_push_subscription ps
              WHERE ps.portal_user_id = u.portal_user_id)::int AS devices
       FROM effective e
       JOIN portal_user u ON u.email = e.subject_email
       LEFT JOIN portal_notify_setting s ON s.client_id = e.client_id AND s.subject_email = e.subject_email
      WHERE e.client_id = $1
        AND (e.expires_at IS NULL OR e.expires_at > now())
        AND u.status = 'ACTIVE' AND u.last_login_at IS NOT NULL`,
    [clientId],
  );
  return rows;
}

/** The client's name and language, for the words of an email. */
async function clientProfile(client, clientId) {
  const { rows } = await client.query(
    "SELECT COALESCE(name, legal_name) AS name, preferred_language FROM client_master WHERE client_id = $1",
    [clientId],
  );
  return rows[0] || null;
}

/* ── the outbox ────────────────────────────────────────────────────────── */

const DONE_COLUMN = { push: "push_done_at", email: "email_done_at" };

/** What is waiting on one channel for this client, topic and conversation. */
async function waiting(client, { clientId, topic, thread, channel, limit = 50 }) {
  const col = DONE_COLUMN[channel];
  const { rows } = await client.query(
    `SELECT outbox_id, event_key, item_ref, created_at
       FROM portal_notify_outbox
      WHERE client_id = $1 AND topic = $2 AND thread_key IS NOT DISTINCT FROM $3 AND ${col} IS NULL
      ORDER BY outbox_id
      LIMIT $4`,
    [clientId, topic, thread || null, limit],
  );
  return rows;
}

async function markDone(client, { ids, channel }) {
  if (!ids.length) return;
  const col = DONE_COLUMN[channel];
  await client.query(`UPDATE portal_notify_outbox SET ${col} = now() WHERE outbox_id = ANY($1::bigint[])`, [ids]);
}

/**
 * Groups with rows left waiting past their job — a queue that was down when
 * the event happened, or a job lost to a restart. The next job in the tenant
 * re-queues them, so a notification is late rather than never.
 */
async function staleGroups(client, { olderThanMinutes = 30, limit = 20 } = {}) {
  const { rows } = await client.query(
    `SELECT client_id, topic, thread_key
       FROM portal_notify_outbox
      WHERE (push_done_at IS NULL OR email_done_at IS NULL)
        AND created_at < now() - make_interval(mins => $1)
      GROUP BY client_id, topic, thread_key
      LIMIT $2`,
    [olderThanMinutes, limit],
  );
  return rows.map((r) => ({ clientId: r.client_id, topic: r.topic, thread: r.thread_key }));
}

/* ── what was sent ─────────────────────────────────────────────────────── */

/** The claim, taken before a send: false when this person was already told. */
async function claim(client, { clientId, email, channel, topic, key }) {
  const { rows } = await client.query(
    `INSERT INTO portal_notify_sent (client_id, subject_email, channel, topic, dedupe_key)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (subject_email, channel, dedupe_key) DO NOTHING
     RETURNING sent_id`,
    [clientId, email, channel, topic, key],
  );
  return rows[0] ? rows[0].sent_id : null;
}

/** Give a claim back when the send failed, so the retry can make it. */
async function release(client, sentId) {
  await client.query("DELETE FROM portal_notify_sent WHERE sent_id = $1", [sentId]);
}

/** Was this person emailed about this conversation recently? */
async function recentlyTold(client, { email, channel, topic, keyPrefix, minutes }) {
  const { rows } = await client.query(
    `SELECT 1 FROM portal_notify_sent
      WHERE subject_email = $1 AND channel = $2 AND topic = $3
        AND dedupe_key LIKE $4 || '%' AND sent_at > now() - make_interval(mins => $5)
      LIMIT 1`,
    [email, channel, topic, keyPrefix, minutes],
  );
  return rows.length > 0;
}

/** The sender keeps its own tables small: a month of claims, a day of finished rows. */
async function sweep(client) {
  // A deliberate "Send by email" (14261) is the record shown on its message: kept.
  await client.query("DELETE FROM portal_notify_sent WHERE sent_at < now() - interval '30 days' AND message_id IS NULL");
  await client.query(
    `DELETE FROM portal_notify_outbox
      WHERE push_done_at IS NOT NULL AND email_done_at IS NOT NULL AND created_at < now() - interval '1 day'`,
  );
}

/* ── the things a notification is about ────────────────────────────────── */

/**
 * Team replies in one conversation that this person has not read, oldest
 * first — the chat's own unread rule (portal_chat.repo UNREAD), limited to the
 * team's side: a colleague's message is theirs to read in the portal, not a
 * reason to be emailed.
 */
async function unreadReplies(client, { clientId, thread, portalUserId, since, ids }) {
  const { rows } = await client.query(
    `SELECT m.message_id, m.body, m.created_at, u.full_name AS author,
            (m.location_lat IS NOT NULL) AS has_location,
            (SELECT a.kind FROM client_message_attachment a
              WHERE a.message_id = m.message_id ORDER BY a.position LIMIT 1) AS attachment_kind,
            d.ref AS dossier_ref
       FROM client_message m
       LEFT JOIN app_user u ON u.user_id = m.author_user_id
       LEFT JOIN dossier_visible d ON d.dossier_id = m.dossier_id
       LEFT JOIN client_message_cursor cur
              ON cur.client_id = m.client_id AND cur.portal_user_id = $3 AND cur.thread_key = $2
      WHERE m.client_id = $1 AND COALESCE(m.dossier_id::text, 'general') = $2
        AND m.direction = 'STAFF'
        AND m.message_id = ANY($5::uuid[])
        AND m.created_at > COALESCE(cur.last_read_at, $4::timestamptz)
      ORDER BY m.created_at`,
    [clientId, thread, portalUserId, since || "epoch", ids],
  );
  return rows;
}

/** The ones among `ids` that were already sent to this person by hand ("Send by email"). */
async function manuallySent(client, { email, ids }) {
  if (!ids.length) return new Set();
  const { rows } = await client.query(
    `SELECT DISTINCT message_id FROM portal_notify_sent
      WHERE subject_email = $1 AND channel = 'EMAIL' AND message_id = ANY($2::uuid[])`,
    [email, ids],
  );
  return new Set(rows.map((r) => r.message_id));
}

async function requests(client, { clientId, ids }) {
  const { rows } = await client.query(
    `SELECT r.client_request_id, r.kind, r.title, r.status, r.due_on, r.review_note, r.dossier_id,
            d.ref AS dossier_ref,
            COALESCE(dt.name_en, pt.name) AS doc_type_en, COALESCE(dt.name_fr, pt.name) AS doc_type_fr
       FROM client_request r
       LEFT JOIN dossier_visible d ON d.dossier_id = r.dossier_id
       LEFT JOIN dictionary_ref dt ON dt.kind = 'DOCUMENT_TYPE' AND dt.code::text = r.doc_type_code
       -- A request keyed to a client document type with no dictionary twin
       -- (14260) is named by the type itself.
       LEFT JOIN party_document_type pt ON pt.document_type_id = r.party_document_type_id
      WHERE r.client_id = $1 AND r.client_request_id = ANY($2::uuid[])
        AND r.status IN ('OPEN','REJECTED')`,
    [clientId, ids],
  );
  return rows;
}

/** Final invoices the client can see (billingInvoices' rule), with a document count. */
async function invoices(client, { clientId, ids }) {
  const { rows } = await client.query(
    `SELECT i.invoice_id, i.doc_number, i.currency, i.total_ttc, i.payment_due_on,
            (SELECT count(*)::int FROM invoice_client_bundle b
               JOIN invoice_client_bundle_item it ON it.bundle_id = b.bundle_id
              WHERE b.invoice_id = i.invoice_id) AS documents
       FROM invoice i
      WHERE i.client_id = $1 AND i.invoice_id = ANY($2::uuid[]) AND i.type = 'FINAL'
        AND i.status NOT IN ('DRAFT','SUBMITTED_FOR_VALIDATION','SUBMITTED_FOR_APPROVAL','CANCELLED','REVERSED')`,
    [clientId, ids],
  );
  return rows;
}

async function proofs(client, { clientId, ids }) {
  const { rows } = await client.query(
    `SELECT payment_proof_id, status, amount, currency, review_note
       FROM payment_proof
      WHERE client_id = $1 AND payment_proof_id = ANY($2::uuid[]) AND status IN ('CONFIRMED','REJECTED')`,
    [clientId, ids],
  );
  return rows;
}

/** Quotations still waiting on the client (meeting 6, PR 4) — as for proposals. */
async function quotations(client, { clientId, ids }) {
  if (!ids || !ids.length) return [];
  const { rows } = await client.query(
    `SELECT quotation_id, doc_number
       FROM quotation
      WHERE client_id = $1 AND quotation_id = ANY($2::uuid[]) AND status = 'SENT'`,
    [clientId, ids],
  );
  return rows;
}

/** Proposals still waiting on the client — an answered one is no longer news. */
async function proposals(client, { clientId, ids }) {
  const { rows } = await client.query(
    `SELECT proposal_id, doc_number, title
       FROM proposal
      WHERE client_id = $1 AND proposal_id = ANY($2::uuid[]) AND status = 'SENT'`,
    [clientId, ids],
  );
  return rows;
}

/** Completed stages the client can see, on their own shipments. */
async function stages(client, { clientId, ids }) {
  const { rows } = await client.query(
    `SELECT mi.milestone_instance_id, mi.label, mi.label_en, mi.completed_at,
            d.dossier_id, d.ref AS dossier_ref
       FROM milestone_instance mi
       JOIN dossier_visible d ON d.dossier_id = mi.dossier_id
      WHERE d.client_id = $1 AND mi.milestone_instance_id = ANY($2::uuid[])
        AND mi.is_client_visible AND mi.status = 'DONE'
      ORDER BY mi.completed_at`,
    [clientId, ids],
  );
  return rows;
}

/**
 * The client's quote requests made in the portal, with the event each outbox
 * row was about — an acknowledgement and a status move are different lines.
 * PORTAL only: the outbox writer already refuses anything else, and this read
 * says so again.
 */
async function quoteRequests(client, { clientId, ids }) {
  const { rows } = await client.query(
    `SELECT quote_request_id, public_ref, status, created_at
       FROM quote_request
      WHERE client_id = $1 AND quote_request_id = ANY($2::uuid[]) AND intake_channel = 'PORTAL'`,
    [clientId, ids],
  );
  return rows;
}

/* ── what a client was sent (tenant review 29 Sep 2026, B4/B5) ─────────── */

/**
 * Everybody with an effective CLIENT grant here — whether or not they have
 * signed in — with what their login and switches say. The automatic sender
 * reaches only `audience()`; this wider list is what explains, per person, why
 * an email went or did not ("never signed in", "switched off").
 */
async function reachList(client, { clientId }) {
  const { rows } = await client.query(
    `WITH here AS (
       SELECT DISTINCT subject_email FROM portal_access
        WHERE portal = 'CLIENT' AND client_id = $1 AND is_active
     ), effective AS (
       SELECT DISTINCT ON (a.subject_email) a.*
         FROM portal_access a
         JOIN here h ON h.subject_email = a.subject_email
        WHERE a.portal = 'CLIENT' AND a.is_active
        ORDER BY a.subject_email, a.created_at DESC
     )
     SELECT e.subject_email::text AS email, e.access_scope AS scope, e.created_at AS granted_at, e.expires_at,
            u.portal_user_id, u.full_name, u.status, u.last_login_at,
            s.language, s.email_off, s.push_off
       FROM effective e
       LEFT JOIN portal_user u ON u.email = e.subject_email
       LEFT JOIN portal_notify_setting s ON s.client_id = e.client_id AND s.subject_email = e.subject_email
      WHERE e.client_id = $1
      ORDER BY u.full_name NULLS LAST, e.subject_email`,
    [clientId],
  );
  return rows;
}

/** The outbox rows that carried these messages, and whether their email pass ran. */
async function messageOutbox(client, { clientId, messageIds }) {
  const { rows } = await client.query(
    `SELECT outbox_id, item_ref, thread_key, created_at, email_done_at
       FROM portal_notify_outbox
      WHERE client_id = $1 AND topic = 'MESSAGES'
        AND item_ref = ANY(SELECT 'client_message:' || x FROM unnest($2::text[]) AS x)`,
    [clientId, messageIds],
  );
  return rows;
}

/**
 * Every email about one conversation since a moment: the automatic ones
 * (keyed `email:MESSAGES:<thread>:<last outbox id>`) and the deliberate ones
 * (`message_id` set by "Send by email"), with who pressed it.
 */
async function threadEmails(client, { clientId, thread, since }) {
  const { rows } = await client.query(
    `SELECT s.sent_id, s.subject_email::text AS email, s.dedupe_key, s.sent_at, s.message_id, s.sent_by,
            COALESCE(e.full_name, u.full_name) AS sent_by_name
       FROM portal_notify_sent s
       LEFT JOIN app_user u ON u.user_id = s.sent_by
       LEFT JOIN employee e ON e.employee_id = u.employee_id
      WHERE s.client_id = $1 AND s.channel = 'EMAIL' AND s.topic = 'MESSAGES'
        AND s.sent_at >= $3::timestamptz
        AND (s.message_id IS NOT NULL OR s.dedupe_key LIKE 'email:MESSAGES:' || $2 || ':%')`,
    [clientId, thread, since],
  );
  return rows;
}

/** Each portal user's read cursor on one conversation. */
async function threadCursors(client, { clientId, thread }) {
  const { rows } = await client.query(
    "SELECT portal_user_id, last_read_at FROM client_message_cursor WHERE client_id = $1 AND thread_key = $2",
    [clientId, thread],
  );
  return rows;
}

/** One TEAM message, what it is about, and its attachments — what "Send by email" sends. */
async function teamMessage(client, { messageId }) {
  const { rows } = await client.query(
    `SELECT m.message_id, m.client_id, m.dossier_id, m.direction, m.body, m.created_at, m.author_user_id,
            COALESCE(cm.name, cm.legal_name) AS client_name, cm.preferred_language,
            d.ref AS dossier_ref, d.pol, d.pod,
            u.email AS author_email, COALESCE(e.full_name, u.full_name) AS author_name,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'attachment_id', a.attachment_id, 'kind', a.kind, 'file_name', a.file_name,
                       'mime_type', a.mime_type, 'byte_size', a.byte_size,
                       'storage_path', v.storage_path, 'original_name', v.original_name) ORDER BY a.position)
                FROM client_message_attachment a
                JOIN document_vault v ON v.doc_id = a.doc_id
               WHERE a.message_id = m.message_id
            ), '[]'::json) AS attachments
       FROM client_message m
       JOIN client_master cm ON cm.client_id = m.client_id
       LEFT JOIN dossier_visible d ON d.dossier_id = m.dossier_id
       LEFT JOIN app_user u ON u.user_id = m.author_user_id
       LEFT JOIN employee e ON e.employee_id = u.employee_id
      WHERE m.message_id = $1`,
    [messageId],
  );
  return rows[0] || null;
}

/**
 * The claim for a deliberate send — the same table and the same unique key as
 * every automatic send, so a double click or a retried request with the same
 * key finds the claim taken and sends nothing twice.
 */
async function claimManual(client, { clientId, email, messageId, requestKey, sentBy }) {
  const { rows } = await client.query(
    `INSERT INTO portal_notify_sent (client_id, subject_email, channel, topic, dedupe_key, message_id, sent_by)
     VALUES ($1, $2, 'EMAIL', 'MESSAGES', $3, $4, $5)
     ON CONFLICT (subject_email, channel, dedupe_key) DO NOTHING
     RETURNING sent_id`,
    [clientId, email, `manual:${messageId}:${requestKey}`, messageId, sentBy || null],
  );
  return rows[0] ? rows[0].sent_id : null;
}

module.exports = {
  quoteRequests, manuallySent, reachList, messageOutbox, threadEmails, threadCursors, teamMessage, claimManual,
  setting, saveSetting, rememberLanguage,
  saveDevice, deleteDevice, countDevices,
  audience, clientProfile,
  waiting, markDone, staleGroups,
  claim, release, recentlyTold, sweep,
  unreadReplies, requests, invoices, proofs, proposals, quotations, stages,
};
