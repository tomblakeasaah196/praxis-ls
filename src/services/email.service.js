/**
 * Email service — per-tenant SMTP send (nodemailer, lazily required). Sending
 * runs from the `email` worker job with retry/backoff. SPF/DKIM/DMARC are a DNS
 * concern per sending domain (tracked); this is the transport + logging surface.
 */
"use strict";

const { config } = require("../config/env");

function transport() {
  /// eslint-disable-next-line global-require
  const nodemailer = require("nodemailer");
  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: Number(config.SMTP_PORT) === 465,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
  });
}

function defaultFrom() {
  return "no-reply@" + (config.MAIL_FALLBACK_DOMAIN || "praxisls.com");
}

/** Send one message. `tx` is injectable for tests. */
async function send({ to, subject, html, text, from }, tx = null) {
  if (!to) throw new Error("email: 'to' is required");
  const mailer = tx || transport();
  return mailer.sendMail({ from: from || defaultFrom(), to, subject, html, text });
}

module.exports = { send, transport, defaultFrom };
