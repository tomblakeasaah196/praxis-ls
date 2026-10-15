/**
 * Whose remote images load without asking (§5.6.3).
 *
 * ── WHAT A REMOTE IMAGE IS ──────────────────────────────────────────────────
 *
 * A read receipt. A 1×1 GIF in a supplier's footer tells their mailing tool the
 * moment an invoice was opened, from what address, on what device, every time
 * it is displayed. Q32 removed our own read tracking for the EU counterparties;
 * blocking other people's is the inbound half of the same decision, and the
 * reading pane has done it since §5.6.3 landed. What it did not have was any
 * memory: a client's logo stayed behind "Show images" on every message, which
 * is why branded mail never looked right on first open.
 *
 * ── WHO IS TRUSTED (owner decision, 15 Oct 2026) ────────────────────────────
 *
 *   sender      the reader said "Always show images from this sender". Per
 *               USER: a remote image reports the person who opens it, so one
 *               colleague's choice is not the mailbox's.
 *   party       the sender is a client, supplier or employee in master data,
 *               matched on the exact address. Leads are NOT included: a lead is
 *               somebody we have not done business with yet.
 *   own_domain  the sender is on one of the tenant's own mailbox domains. A
 *               consumer domain (gmail.com, yahoo.fr) is never "own", or every
 *               Gmail user on earth would qualify through one connected inbox.
 *   sent        we sent it. Nothing in it reports to anyone but us.
 *
 * ── WHO IS NEVER TRUSTED ────────────────────────────────────────────────────
 *
 * A message whose anti-spoof verdict is SUSPICIOUS or LIKELY_IMPERSONATION,
 * whatever list its From address is on. The From line is written by the
 * sender, so "is this a client's address" is exactly the question a spoofer
 * answers yes to; the verdict is the one thing here that is not.
 */
"use strict";

const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

/** Verdicts that override every kind of trust. */
const HELD = new Set(["SUSPICIOUS", "LIKELY_IMPERSONATION"]);

/**
 * Consumer mail domains. Connecting a personal Gmail inbox must not make every
 * Gmail sender "our own domain". The francophone set matters: half this
 * corridor's correspondence arrives from yahoo.fr and orange.fr addresses.
 */
const CONSUMER = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "outlook.fr", "hotmail.com", "hotmail.fr",
  "live.com", "live.fr", "msn.com", "yahoo.com", "yahoo.fr", "ymail.com", "icloud.com",
  "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.fr",
  "mail.com", "orange.fr", "free.fr", "laposte.net", "sfr.fr", "wanadoo.fr", "zoho.com",
]);

const norm = (address) => String(address || "").trim().toLowerCase();
const domainOf = (address) => {
  const a = norm(address);
  const at = a.lastIndexOf("@");
  return at === -1 ? "" : a.slice(at + 1);
};

/** The caller's own list, newest first. */
async function list(client, actor) {
  const { rows } = await client.query(
    `SELECT email_image_trust_id, sender_address, created_at
       FROM email_image_trust WHERE user_id = $1 ORDER BY created_at DESC`,
    [actor.user_id],
  );
  return rows;
}

/** "Always show images from this sender." Idempotent: trusting twice is one row. */
async function add(client, actor, { sender }) {
  const address = norm(sender);
  if (!address.includes("@")) throw new AppError("VALIDATION_ERROR", "sender must be an email address", 422);
  const { rows } = await client.query(
    `INSERT INTO email_image_trust (user_id, sender_address) VALUES ($1, $2)
     ON CONFLICT (user_id, sender_address) DO UPDATE SET sender_address = EXCLUDED.sender_address
     RETURNING email_image_trust_id, sender_address, created_at`,
    [actor.user_id, address],
  );
  return rows[0];
}

/** Withdraw one. Only the caller's own: someone else's id is a 404. */
async function remove(client, actor, id) {
  const { rowCount } = await client.query(
    `DELETE FROM email_image_trust WHERE email_image_trust_id = $1 AND user_id = $2`,
    [id, actor.user_id],
  );
  if (!rowCount) throw new AppError("NOT_FOUND", "trusted sender not found", 404);
  return { email_image_trust_id: id, removed: true };
}

/** Every lookup `annotate` needs, for a set of addresses, in three queries. */
async function lookups(client, actor, addresses) {
  const [mine, parties, domains] = await Promise.all([
    client.query(
      `SELECT sender_address FROM email_image_trust WHERE user_id = $1 AND sender_address = ANY($2::text[])`,
      [actor.user_id, addresses],
    ),
    // Matched by the functional indexes from 10736, as knownParty is.
    client.query(
      `SELECT lower(email) AS address FROM client_master   WHERE lower(email) = ANY($1::text[]) AND is_active
       UNION SELECT lower(email) FROM supplier_master WHERE lower(email) = ANY($1::text[]) AND is_active
       UNION SELECT lower(email) FROM employee        WHERE lower(email) = ANY($1::text[]) AND is_active`,
      [addresses],
    ),
    client.query(
      `SELECT DISTINCT lower(split_part(email_address, '@', 2)) AS domain
         FROM email_connection WHERE status <> 'DISABLED'`,
    ),
  ]);
  return {
    mine: new Set(mine.rows.map((r) => r.sender_address)),
    parties: new Set(parties.rows.map((r) => r.address)),
    own: new Set(domains.rows.map((r) => r.domain).filter((d) => d && !CONSUMER.has(d))),
  };
}

/** One message's answer, given the lookups. Pure, so the rules are testable. */
function decide(message, { mine, parties, own }) {
  if (message.direction === "OUT") return { trusted: true, reason: "sent" };
  if (HELD.has(message.auth_verdict)) return { trusted: false, reason: "held" };
  const address = norm(message.from_address);
  if (mine.has(address)) return { trusted: true, reason: "sender" };
  if (parties.has(address)) return { trusted: true, reason: "party" };
  if (own.has(domainOf(address))) return { trusted: true, reason: "own_domain" };
  return { trusted: false, reason: null };
}

/**
 * Stamp `image_trust` on every message of a conversation the caller opened.
 *
 * A failure here must not cost the reader the conversation, so a lookup error
 * leaves every message untrusted, which is the state the pane already handles:
 * images held back behind "Show images".
 */
async function annotate(client, actor, thread) {
  const messages = (thread && thread.messages) || [];
  if (!messages.length) return thread;
  const addresses = [...new Set(messages.map((m) => norm(m.from_address)).filter(Boolean))];
  let found = { mine: new Set(), parties: new Set(), own: new Set() };
  try {
    found = await lookups(client, actor, addresses);
  } catch (err) {
    logger.warn({ err, thread: thread.email_thread_id }, "[mail] image trust lookup failed; images stay held");
  }
  for (const m of messages) m.image_trust = decide(m, found);
  return thread;
}

module.exports = { list, add, remove, annotate, decide, CONSUMER, HELD };
