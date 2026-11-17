/**
 * IMAP IDLE worker (opt-in, experimental) — low-latency inbound for IMAP mailboxes
 * as an alternative/complement to interval polling. Run as its own process:
 *
 *   node src/jobs/mail-idle.js        (or `npm run idle`)
 *
 * Design: it holds one long-lived IMAP connection per CONNECTED imap_smtp mailbox
 * and listens for the `exists` event (new message). On a signal it just ENQUEUES
 * the normal `mail-sync` job for that tenant — the actual fetch/dedup/store runs on
 * the proven job path with a fresh tenant DB connection. IDLE only lowers latency;
 * the periodic mail-sync scheduler remains the safety net, so a dropped IDLE
 * connection never loses mail.
 *
 * Caveats (why it's opt-in): it keeps N persistent IMAP sockets open, refreshes
 * the mailbox list only at startup, and does best-effort reconnect. For large
 * fleets prefer provider webhooks (Graph/Gmail) + polling for IMAP.
 */
"use strict";

const { ImapFlow } = require("imapflow");
const registry = require("../services/tenant/registry.service");
const settings = require("../modules/security/setting/setting.service");
const mailRepo = require("../modules/mail/mail/mail.repo");
const { enqueue } = require("./queue-producer");
const { initRedis, closeRedis } = require("../config/redis");
const { logger } = require("../config/logger");
const { imapTimeouts } = require("../shared/mail/imap-timeouts");
const { isImapAuthFailure } = require("../modules/mail/mail/smtp-error.map");

const RECONNECT_MS = 15000;
/** The longest a reconnect is ever put off. */
const RECONNECT_MAX_MS = 15 * 60_000;
const idlers = new Map(); // key → ImapFlow
/** key → connections in a row that closed before they were ever idling. */
const failed = new Map();
/** Keys whose sign-in the server refused: never reconnected by this process. */
const refused = new Set();
let stopping = false;

/**
 * How long to wait before reconnecting. A connection that had been idling and
 * dropped comes straight back (15 s). One that never got as far as idling
 * waits twice as long each time, to a ceiling: a host that is down, or is
 * blocking this server, gains nothing from four knocks a minute.
 */
function reconnectDelay(failures) {
  return Math.min(RECONNECT_MS * 2 ** Math.max(0, failures), RECONNECT_MAX_MS);
}

function triggerSync(meta) {
  enqueue("mail-sync", "sync", { tenantMeta: meta, env: "live" },
    { jobId: `mailsync:${meta.db_name}:live`, removeOnComplete: true, removeOnFail: 100 })
    .catch((err) => logger.warn({ err }, "[mail-idle] enqueue failed"));
}

async function idleConnection(meta, conn) {
  const key = `${meta.db_name}:${conn.email_connection_id}`;
  if (idlers.has(key) || stopping || refused.has(key)) return;

  let password = null;
  await registry.withTenantConnection(meta, "live", async (c) => {
    password = conn.secret_key ? await settings.readSecret(c, conn.secret_key) : null;
  });
  if (!password) return;

  const imap = new ImapFlow({
    host: conn.imap_host, port: conn.imap_port || 993, secure: conn.imap_secure !== false,
    auth: { user: conn.auth_user || conn.email_address, pass: password }, logger: false,
    // Reaching the server only: an idling connection is quiet by design, so the
    // silence timeout is left to imapflow. See shared/mail/imap-timeouts.
    ...imapTimeouts(),
  });
  idlers.set(key, imap);

  let idling = false;
  imap.on("exists", () => triggerSync(meta));
  imap.on("close", () => {
    idlers.delete(key);
    if (stopping || refused.has(key)) return;
    const failures = idling ? 0 : (failed.get(key) || 0) + 1;
    if (failures) failed.set(key, failures); else failed.delete(key);
    setTimeout(() => idleConnection(meta, conn).catch(() => {}), reconnectDelay(failures));
  });

  try {
    await imap.connect();
  } catch (err) {
    // A refused sign-in is refused again fifteen seconds later, and every try
    // counts towards the mail host's limit for this server's ADDRESS: ten in an
    // hour and the host blocks it, for every mailbox and every tenant (see
    // sync-brake.js). So this process stops trying that mailbox. The scheduled
    // sync is what shows the fault on the mailbox, and a restart of this worker
    // is what brings a repaired one back.
    if (isImapAuthFailure(err)) {
      refused.add(key);
      idlers.delete(key);
      logger.warn({ conn: conn.email_connection_id, mailbox: conn.email_address },
        "[mail-idle] sign-in refused: not reconnecting this mailbox");
      return;
    }
    throw err;
  }
  await imap.mailboxOpen("INBOX"); // imapflow auto-maintains IDLE while open
  idling = true;
  failed.delete(key);
  triggerSync(meta); // catch anything that arrived before we connected
  logger.info({ conn: conn.email_connection_id, mailbox: conn.email_address }, "[mail-idle] idling");
}

async function main() {
  await initRedis();
  const tenants = await registry.listActiveTenants();
  for (const meta of tenants) {
     
    const conns = await registry.withTenantConnection(meta, "live", (c) => mailRepo.listSyncable(c));
    for (const conn of conns.filter((x) => x.provider === "imap_smtp")) {
       
      await idleConnection(meta, conn).catch((err) => logger.warn({ err, conn: conn.email_connection_id }, "[mail-idle] start failed"));
    }
  }
  logger.info({ idlers: idlers.size }, "[mail-idle] ready");

  const shutdown = async () => {
    stopping = true;
    for (const imap of idlers.values()) {
      try { await imap.logout(); } catch {
        /* @silent:teardown the worker is shutting down: a connection that is
           already closed, or will not say goodbye, is being dropped either way. */
      }
    }
    await closeRedis();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

if (require.main === module) {
  main().catch((err) => { logger.error({ err }, "[mail-idle] failed to start"); process.exit(1); });
}

module.exports = { main, reconnectDelay };
