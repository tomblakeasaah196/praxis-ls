"use strict";

/**
 * How long an IMAP client may wait to REACH a mail server, for every imapflow
 * client this server builds. The receiving-leg counterpart of smtp-timeouts.
 *
 * ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────────
 *
 * No IMAP client here set a timeout, so each ran on imapflow's default: ninety
 * SECONDS to connect. When a mail host stopped answering this server (its
 * firewall had blocked our address), "Create and test" on a new mailbox span
 * for a minute and a half with nothing on screen, and so did Test and Sync on
 * every mailbox hosted there. The owner's report was that the buttons "load
 * perpetually and nothing happens"; the request did come back, ninety seconds
 * later, with imapflow's "Failed to establish connection in required time".
 * The sending leg was given short timeouts in smtp-timeouts and this leg was
 * missed, and verify() tries this leg FIRST.
 *
 * ── THE NUMBERS ─────────────────────────────────────────────────────────────
 *
 *   connectionTimeout  DNS, TCP and TLS together. imapflow holds one deadline
 *                      over all three. A healthy server answers in well under
 *                      a second from the same continent.
 *   greetingTimeout    the server's "* OK" banner after connecting.
 *
 * `socketTimeout` is deliberately NOT set. It is silence on an OPEN connection,
 * and an open IMAP connection is legitimately quiet for minutes: the IDLE
 * worker sits on one waiting for new mail, and a large fetch pauses between
 * chunks. imapflow's own five minutes stays.
 */
const IMAP = Object.freeze({
  connectionTimeout: 15_000,
  greetingTimeout: 15_000,
});

/** Spread into `new ImapFlow({...})`. */
const imapTimeouts = () => ({ ...IMAP });

module.exports = { imapTimeouts, IMAP };
