"use strict";

/**
 * How long an SMTP transport may wait before it gives up, for every nodemailer
 * transport this server builds.
 *
 * ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────────
 *
 * No transport here set a timeout, so each ran on nodemailer's defaults: two
 * MINUTES to connect and ten to sit idle. The proxy in front of the API gives
 * a request about two minutes, so when a mail server stopped answering, the
 * request that was sending mail did not fail — it hung until the proxy cut it
 * off with a bare 504. Creating a user by invitation was the one that showed
 * it: the account was saved, the "Create user" button spun for two minutes,
 * and the screen ended on "Can't reach the server" with no word about mail.
 * The Test button for the same sender hung the same way, so the one control
 * meant to diagnose it could not report either.
 *
 * With these, an unreachable server is a named error in seconds
 * ("Connection timeout"), which every caller already knows how to report: the
 * invitation path answers "The account was created, but the invitation email
 * could not be sent. Use Resend invitation.", and the send log records FAILED
 * with the reason.
 *
 * ── THE NUMBERS ─────────────────────────────────────────────────────────────
 *
 *   connectionTimeout  the TCP (and TLS) handshake. A healthy server answers in
 *                      well under a second from the same continent.
 *   greetingTimeout    the server's 220 banner after connecting. Some hosts
 *                      delay it a few seconds on purpose (tarpitting).
 *   dnsTimeout         resolving the host name.
 *   socketTimeout      SILENCE on an open connection, not total time: a large
 *                      attachment keeps the socket busy and never trips it.
 *
 * A probe (the console's Test button) is somebody waiting on a click and sends
 * nothing, so it is given less.
 */
const SEND = Object.freeze({
  connectionTimeout: 15_000,
  greetingTimeout: 15_000,
  dnsTimeout: 10_000,
  socketTimeout: 60_000,
});

const PROBE = Object.freeze({
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  dnsTimeout: 10_000,
  socketTimeout: 15_000,
});

/** Spread into `nodemailer.createTransport({...})`. */
const smtpTimeouts = (kind = "send") => ({ ...(kind === "probe" ? PROBE : SEND) });

module.exports = { smtpTimeouts, SEND, PROBE };
