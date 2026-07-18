/** Mail repository (read-only) — per-purpose sender identities + the outbound
 *  send log. All SQL lives here. */
"use strict";

async function listIdentities(client) {
  const { rows } = await client.query(
    "SELECT email_identity_id, purpose, from_address, from_name, reply_to, smtp_host, smtp_port, is_active " +
      "FROM email_identity ORDER BY purpose",
  );
  return rows;
}

async function listSentLog(client, { limit = 100, offset = 0, identityId = null } = {}) {
  const params = [Math.min(Math.max(Number(limit) || 100, 1), 500), Number(offset) || 0];
  let where = "";
  if (identityId) { params.push(identityId); where = "WHERE l.email_identity_id = $3"; }
  const { rows } = await client.query(
    "SELECT l.email_send_id, l.email_identity_id, l.to_address, l.subject, l.entity_ref, l.status, " +
      "l.provider_message_id, l.error, l.queued_at, l.sent_at, " +
      "i.purpose, i.from_address, i.from_name " +
      "FROM email_send_log l LEFT JOIN email_identity i ON i.email_identity_id = l.email_identity_id " +
      where + " ORDER BY l.queued_at DESC LIMIT $1 OFFSET $2",
    params,
  );
  return rows;
}

async function listInbox(client, { limit = 100, offset = 0, identityId = null } = {}) {
  const params = [Math.min(Math.max(Number(limit) || 100, 1), 500), Number(offset) || 0];
  let where = "";
  if (identityId) { params.push(identityId); where = "WHERE b.email_identity_id = $3"; }
  const { rows } = await client.query(
    "SELECT b.email_inbound_id, b.email_identity_id, b.from_address, b.to_address, b.subject, " +
      "b.body_preview, b.entity_ref, b.is_read, b.received_at, i.purpose " +
      "FROM email_inbound b LEFT JOIN email_identity i ON i.email_identity_id = b.email_identity_id " +
      where + " ORDER BY b.received_at DESC LIMIT $1 OFFSET $2",
    params,
  );
  return rows;
}

async function updateIdentity(client, id, fields) {
  const allow = ["from_name", "reply_to", "smtp_host", "smtp_port", "is_active"];
  const keys = Object.keys(fields).filter((k) => allow.includes(k));
  if (!keys.length) return null;
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query(
    "UPDATE email_identity SET " + set + " WHERE email_identity_id = $1 RETURNING email_identity_id, purpose, from_address, from_name, reply_to, smtp_host, smtp_port, is_active",
    [id, ...keys.map((k) => fields[k])],
  );
  return rows[0] || null;
}

async function upsertIdentity(client, d) {
  const ex = (await client.query("SELECT email_identity_id FROM email_identity WHERE purpose = $1 ORDER BY created_at LIMIT 1", [d.purpose])).rows[0];
  if (ex) {
    const { rows } = await client.query(
      "UPDATE email_identity SET from_address = COALESCE($2, from_address), from_name = COALESCE($3, from_name), " +
        "reply_to = $4, smtp_host = $5, smtp_port = $6, is_active = COALESCE($7, is_active) " +
        "WHERE email_identity_id = $1 RETURNING email_identity_id, purpose, from_address, from_name, reply_to, smtp_host, smtp_port, is_active",
      [ex.email_identity_id, d.from_address || null, d.from_name || null, d.reply_to || null, d.smtp_host || null, d.smtp_port || null, d.is_active],
    );
    return rows[0];
  }
  const { rows } = await client.query(
    "INSERT INTO email_identity (purpose, from_address, from_name, reply_to, smtp_host, smtp_port, is_active) " +
      "VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, true)) " +
      "RETURNING email_identity_id, purpose, from_address, from_name, reply_to, smtp_host, smtp_port, is_active",
    [d.purpose, d.from_address, d.from_name, d.reply_to || null, d.smtp_host || null, d.smtp_port || null, d.is_active],
  );
  return rows[0];
}

module.exports = { listIdentities, listSentLog, listInbox, updateIdentity, upsertIdentity };
