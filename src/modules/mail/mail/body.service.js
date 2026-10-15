/**
 * The body of one stored message: repaired on open, and the original on request.
 *
 * ── REPAIR ON OPEN (owner decision, 15 Oct 2026) ────────────────────────────
 *
 * Mail stored before 14410 was flattened by the old sanitizer and kept no
 * original, so nothing in the database can put its formatting back. The
 * provider still has it. Three ways to get it back were on the table: leave old
 * mail flat, re-fetch every message overnight, or re-fetch each one the first
 * time somebody opens it. The last was chosen because it costs a provider call
 * only for mail somebody actually reads, which keeps a mailbox with years of
 * history inside Gmail's and Microsoft's quotas and off an IMAP server's
 * connection limit.
 *
 * The thread read stays fast and unchanged: the pane draws what is stored at
 * once, sees `body_policy` is behind, asks `GET /mail/thread/:id/body`, and
 * swaps the repaired body in when it lands.
 *
 * ── THE THREE ROADS, CHEAPEST FIRST ─────────────────────────────────────────
 *
 *   1. `body_policy` is current: the stored body is the answer.
 *   2. An original is stored (or this is a row Praxis wrote when it sent the
 *      message, whose `body_html` IS the original): re-clean it. No network.
 *   3. Neither: fetch the message from the provider once, store its HTML as
 *      the original, and link its inline images to the attachments already
 *      stored, by checksum.
 *
 * A provider that no longer has the message (deleted, moved out of reach on
 * Graph, a revoked token) is recorded in `body_repair_failed_at`, and the row
 * is not asked about again for a day. The reader keeps the flat body they had;
 * a failed repair is never an error on screen.
 *
 * ── THE ORIGINAL ON REQUEST ─────────────────────────────────────────────────
 *
 * View source and Download original read the message from the provider as RFC
 * 822 bytes. They are not stored: the provider is the authority on what it
 * holds, the bytes include every attachment again, and a copy we kept would be
 * a second thing to delete under a retention rule.
 */
"use strict";

const crypto = require("crypto");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");
const mailRepo = require("./mail.repo");
const { cleanHtml, BODY_POLICY } = require("./body-html");

/** How long a failed repair is left alone before the provider is asked again. */
const RETRY_MS = 24 * 60 * 60 * 1000;

async function loadRow(client, messageId) {
  const { rows } = await client.query(
    `SELECT email_message_id, email_connection_id, direction, provider_folder, external_message_id,
            subject, body_html, body_html_original, body_policy, body_repair_failed_at
       FROM email_message WHERE email_message_id = $1`,
    [messageId],
  );
  return rows[0] || null;
}

/** What the pane needs, and never the original. */
const answer = (row, source) => ({
  email_message_id: row.email_message_id,
  body_html: row.body_html || null,
  body_policy: row.body_policy === null || row.body_policy === undefined ? null : Number(row.body_policy),
  source,
});

/**
 * A row Praxis wrote itself, at the moment it sent the message.
 *
 * Its `body_html` was never through the old sanitizer, because `recordOutbound`
 * stored the serializer's output as it was. So it is already the original, and
 * repairing it needs no provider at all.
 */
const isLocalSend = (row) => row.direction === "OUT" && !row.provider_folder;

async function store(client, id, original, html) {
  await client.query(
    `UPDATE email_message
        SET body_html_original = $2, body_html = $3, body_policy = $4, body_repair_failed_at = NULL
      WHERE email_message_id = $1`,
    [id, original, html, BODY_POLICY],
  );
}

const markFailed = (client, id) =>
  client.query(`UPDATE email_message SET body_repair_failed_at = now() WHERE email_message_id = $1`, [id]);

/**
 * Where the provider keeps this message.
 *
 * Only IMAP uses it. A row Praxis wrote on send has no `provider_folder`, but
 * the copy the engine appended to Sent is the one the server holds, so the
 * mailbox's Sent folder is the place to look.
 */
async function folderFor(client, row) {
  if (row.provider_folder) return row.provider_folder;
  if (row.direction !== "OUT") return null;
  const { rows } = await client.query(
    `SELECT provider_path FROM email_folder WHERE email_connection_id = $1 AND canonical = 'SENT' LIMIT 1`,
    [row.email_connection_id],
  );
  return rows[0] ? rows[0].provider_path : null;
}

/**
 * The adapter for this message's mailbox, or null when it is switched off.
 * Same rule as `syncConnection`: a mailbox in ERROR is still tried, because the
 * error is usually the last sync and not the credential.
 */
async function adapterFor(client, row) {
  const conn = await mailRepo.getConnection(client, row.email_connection_id);
  if (!conn || conn.status === "ARCHIVED" || conn.status === "DISABLED") return null;
  const { resolveAdapter } = require("./mail.service");
  return resolveAdapter(client, conn);
}

/**
 * Point each stored attachment at the `cid:` that references it.
 *
 * Matched by checksum, because that is the one property the stored row and the
 * re-fetched part are guaranteed to share: filenames repeat (`image001.png` in
 * every Outlook signature) and sizes collide. One row per Content-ID, and never
 * over a row that already has one, so `ux_email_attachment_cid_message` holds.
 */
async function linkInlineParts(client, messageId, attachments) {
  let linked = 0;
  for (const a of attachments || []) {
    if (!a || !a.content_id || !a.content || !a.content.length) continue;
    const checksum = crypto.createHash("sha256").update(a.content).digest("hex");
    const { rowCount } = await client.query(
      `UPDATE email_attachment SET content_id = $3, disposition = 'inline'
        WHERE email_attachment_id = (
          SELECT email_attachment_id FROM email_attachment
           WHERE email_message_id = $1 AND checksum_sha256 = $2 AND content_id IS NULL
           ORDER BY created_at LIMIT 1)
          AND NOT EXISTS (
          SELECT 1 FROM email_attachment WHERE email_message_id = $1 AND content_id = $3)`,
      [messageId, checksum, a.content_id],
    );
    linked += rowCount || 0;
  }
  return linked;
}

/**
 * The body the reading pane should draw for one message, repaired if it can be.
 *
 * Never throws for a provider problem: the stored body is always an acceptable
 * answer, and `source` says which road was taken (`stored`, `recleaned`,
 * `provider`, `unavailable`).
 */
async function getBody(client, messageId, { now = Date.now() } = {}) {
  const row = await loadRow(client, messageId);
  if (!row) throw new AppError("NOT_FOUND", "message not found", 404);

  // Nothing to repair: current, or a message that never had HTML to lose.
  if (Number(row.body_policy) === BODY_POLICY || !row.body_html) return answer(row, "stored");

  const original = row.body_html_original || (isLocalSend(row) ? row.body_html : null);
  if (original) {
    const html = cleanHtml(original);
    await store(client, row.email_message_id, original, html);
    return answer({ ...row, body_html: html, body_policy: BODY_POLICY }, "recleaned");
  }

  const failedAt = row.body_repair_failed_at ? new Date(row.body_repair_failed_at).getTime() : 0;
  if (failedAt && now - failedAt < RETRY_MS) return answer(row, "unavailable");
  if (!row.external_message_id) {
    await markFailed(client, row.email_message_id);
    return answer(row, "unavailable");
  }

  let fetched = null;
  try {
    const adapter = await adapterFor(client, row);
    if (adapter) {
      fetched = await adapter.getMessage(row.external_message_id, { folderPath: await folderFor(client, row) });
    }
  } catch (err) {
    logger.warn({ err, message_id: row.email_message_id }, "[mail] repair on open: provider fetch failed");
  }
  if (!fetched || !fetched.bodyHtml) {
    await markFailed(client, row.email_message_id);
    return answer(row, "unavailable");
  }

  const html = cleanHtml(fetched.bodyHtml);
  await store(client, row.email_message_id, fetched.bodyHtml, html);
  await linkInlineParts(client, row.email_message_id, fetched.attachments);
  return answer({ ...row, body_html: html, body_policy: BODY_POLICY }, "provider");
}

/**
 * A filename for the downloaded original.
 *
 * Folded to printable ASCII because a quoted `filename=` header cannot carry
 * anything else safely, and the characters no file system accepts are replaced.
 * No date in it: the subject is what a person looks for in their downloads.
 */
function emlFilename(subject) {
  const base = String(subject || "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${base || "message"}.eml`;
}

/**
 * The message exactly as the provider holds it, for View source and Download
 * original. 404 with its own code when the provider no longer has it, so the
 * pane can say that rather than "could not load".
 */
async function getSource(client, messageId) {
  const row = await loadRow(client, messageId);
  if (!row) throw new AppError("NOT_FOUND", "message not found", 404);

  let raw = null;
  if (row.external_message_id) {
    try {
      const adapter = await adapterFor(client, row);
      if (adapter && typeof adapter.getRawMessage === "function") {
        raw = await adapter.getRawMessage(row.external_message_id, { folderPath: await folderFor(client, row) });
      }
    } catch (err) {
      logger.warn({ err, message_id: row.email_message_id }, "[mail] original fetch failed");
    }
  }
  if (!raw || !raw.length) {
    throw new AppError("MAIL_SOURCE_UNAVAILABLE", "The mail server no longer has the original of this message.", 404);
  }
  return { buffer: raw, filename: emlFilename(row.subject) };
}

module.exports = { getBody, getSource, emlFilename, RETRY_MS };
