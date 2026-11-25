"use strict";

/**
 * The two emails a website message causes.
 *
 *   1. THE INBOX COPY, to the tenant's website inbox (Settings › Website ›
 *      Messages; SmartLS: info@smartlsgroup.com). Reply-To is the visitor, so
 *      answering the email answers them. The reference is in the subject, so a
 *      thread can be found by it. Attachments travel inside the email when they
 *      fit (`ATTACHMENTS_INLINE_BYTES`), and as expiring signed links otherwise.
 *   2. THE ACKNOWLEDGEMENT, to the visitor, quoting their reference. Reply-To is
 *      the inbox, so a reply to it reaches the same people.
 *
 * ── WHICH MAILBOX SENDS THEM ─────────────────────────────────────────────
 *
 * The website sender mailbox when one is complete (host, From and password;
 * SmartLS: support@smartlsgroup.com through smtppro.zoho.com:465), through its
 * own transport. Otherwise the tenant's ordinary mail chain, through the send
 * points `site.enquiry.notify` and `site.enquiry.ack` (14620), which ends at the
 * Praxis system sender. Either way every attempt is written to email_send_log.
 *
 * ── NEVER TWICE, NEVER LOST ──────────────────────────────────────────────
 *
 * This runs in the worker, after the message has committed: SMTP with 20 MB of
 * attachments can take longer than a visitor should wait, and a mail failure
 * must never cost the message, which is already safe in the database and in
 * the in-app notification. Each email stamps its own column when it leaves
 * (`inbox_notified_at`, `visitor_acked_at`), and a retry sends only what has not
 * left, so a job retried after the inbox copy went out does not send it again.
 * The last failure is kept in `mail_error` for the desk.
 */

const repo = require("../inbound_intake/inbound_intake.repo");
const settings = require("./website-messages.settings");
const links = require("./attachment-link");
const vault = require("../../vault/document_vault/document_vault.service");
const emailService = require("../../../services/email.service");
const emailRepo = require("../../../services/email.repo");
const origin = require("../../mail/mail/origin");
const { mapSmtpError, isSmtpError } = require("../../mail/mail/smtp-error.map");
const { smtpTimeouts } = require("../../../shared/mail/smtp-timeouts");
const { config } = require("../../../config/env");
const { websiteMessages } = require("@praxis/shared");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

const TYPE_LABEL = {
  GENERAL_ENQUIRY: "A shipment or a quote",
  PARTNERSHIP: "Agency or vendor partnership",
  CAREERS: "A job application",
  MEDIA: "Press or media",
};

const esc = (v) =>
  String(v === null || v === undefined ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const size = (n) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Header-safe: one line, no angle brackets or quotes a display name could break out with. */
const oneLine = (v, max = 120) => String(v || "").replace(/[\r\n<>"]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/* ── composing ──────────────────────────────────────────────────────────── */

/**
 * The inbox copy. Pure: everything it needs is passed in, so the tests can read
 * the subject, the headers and both bodies without a mail server.
 */
function composeInbox({ row, attachments, mode, linkFor, siteOrigin, tenantName }) {
  const who = oneLine(row.name) || oneLine(row.email) || "a visitor";
  const company = oneLine(row.company_name);
  const ref = row.public_ref || row.contact_enquiry_id;
  const subject = `Website message ${ref} from ${who}${company ? `, ${company}` : ""}`;
  const page = row.origin_page ? `${siteOrigin || ""}${row.origin_page}` : null;

  const facts = [
    ["Reference", ref],
    ["From", row.email ? `${row.name ? `${oneLine(row.name)} ` : ""}<${row.email}>` : oneLine(row.name) || "Not given"],
    ["Company", company || null],
    ["Phone", oneLine(row.phone, 60) || null],
    ["Topic", TYPE_LABEL[row.enquiry_type] || null],
    ["Subject", oneLine(row.subject, 255) || null],
    ["Written on", page],
  ].filter(([, v]) => v);

  const files = attachments.map((a) => ({
    name: a.original_name || "attachment",
    size: size(a.byte_size),
    href: mode === "link" ? linkFor(a) : null,
  }));

  const replyLine = row.email
    ? `Reply to this email to answer ${who} directly.`
    : "The visitor left no email address. Use the phone number above if there is one.";
  const where = "The message is also in Praxis LS under Sales, General Enquiries.";
  const linkNote = mode === "link"
    ? `The files are too large to attach, so each link below opens one of them for ${websiteMessages.ATTACHMENT_LINK_DAYS} days.`
    : null;

  const text = [
    `New message from the ${tenantName || "company"} website.`,
    "",
    ...facts.map(([k, v]) => `${k}: ${v}`),
    "",
    "Message:",
    String(row.message || ""),
    ...(files.length
      ? ["", `Attachments (${files.length}):`, ...(linkNote ? [linkNote] : []), ...files.map((f) => `- ${f.name} (${f.size})${f.href ? `: ${f.href}` : ", attached"}`)]
      : []),
    "",
    replyLine,
    where,
  ].join("\n");

  const html = [
    `<p>New message from the ${esc(tenantName || "company")} website.</p>`,
    `<table cellpadding="4" cellspacing="0" style="border-collapse:collapse">`,
    ...facts.map(([k, v]) => `<tr><td style="color:#555;vertical-align:top"><strong>${esc(k)}</strong></td><td>${k === "Written on" ? `<a href="${esc(v)}">${esc(v)}</a>` : esc(v)}</td></tr>`),
    `</table>`,
    `<p><strong>Message</strong></p>`,
    `<p style="white-space:pre-wrap">${esc(row.message)}</p>`,
    ...(files.length
      ? [
        `<p><strong>Attachments (${files.length})</strong>${linkNote ? `<br>${esc(linkNote)}` : ""}</p>`,
        `<ul>${files.map((f) => `<li>${f.href ? `<a href="${esc(f.href)}">${esc(f.name)}</a>` : esc(f.name)} (${esc(f.size)})</li>`).join("")}</ul>`,
      ]
      : []),
    `<p>${esc(replyLine)}<br>${esc(where)}</p>`,
  ].join("\n");

  return { subject, text, html };
}

/** The visitor's acknowledgement. Pure, for the same reason. */
function composeAck({ row, tenantName }) {
  const ref = row.public_ref || row.contact_enquiry_id;
  const name = oneLine(row.name);
  const company = oneLine(tenantName) || "us";
  const subject = `We have your message, reference ${ref}`;
  const lines = [
    name ? `Hello ${name},` : "Hello,",
    "",
    `Thank you for writing to ${company}. Your message has reached our team, and we will reply to this address.`,
    "",
    `Your reference is ${ref}. Please quote it if you contact us about this message.`,
    "",
    company,
  ];
  const text = lines.join("\n");
  const html = lines.map((l) => (l ? `<p>${esc(l).replace(esc(ref), `<strong>${esc(ref)}</strong>`)}</p>` : "")).join("\n");
  return { subject, text, html };
}

/* ── sending ────────────────────────────────────────────────────────────── */

function transportFor(mailbox) {
  const nodemailer = require("nodemailer");
  return nodemailer.createTransport({
    host: mailbox.host,
    port: mailbox.port,
    secure: mailbox.secure,
    auth: { user: mailbox.user, pass: mailbox.pass },
    ...smtpTimeouts("send"),
    ...(config.MAIL_HELO_NAME ? { name: config.MAIL_HELO_NAME } : {}),
  });
}

/**
 * Send one email through the website mailbox when there is one, else the
 * tenant's mail chain. `tx` is the injectable transport for the tests.
 */
async function sendVia(client, { mailbox, to, replyTo, subject, text, html, attachments = [], sendPoint, entityRef, tenantSlug }, tx = null) {
  if (!mailbox) {
    const out = await emailService.send(client, {
      to, replyTo, subject, text, html, attachments,
      purpose: "SUPPORT", moduleKey: "MOD-25", entityRef, sendPoint, tenantSlug, signature: "none",
    }, tx);
    if (out && out.suppressed) throw new Error(`not sent: ${out.reason}`);
    return { via: "tenant", messageId: (out && out.messageId) || null };
  }
  const from = mailbox.from_name ? `"${oneLine(mailbox.from_name)}" <${mailbox.from_address}>` : mailbox.from_address;
  const payload = {
    from, to, subject, text, html,
    ...(replyTo ? { replyTo } : {}),
    ...(attachments.length ? { attachments } : {}),
    messageId: origin.generateMessageId(mailbox.from_address),
    headers: origin.buildOriginHeaders({ tenantSlug, sendPoint }),
  };
  const log = { email_identity_id: null, to_address: Array.isArray(to) ? to.join(", ") : to, subject, entity_ref: entityRef || null, document_vault_id: null };
  try {
    const info = await (tx || transportFor(mailbox)).sendMail(payload);
    await emailRepo.recordSend(client, { ...log, status: "SENT", provider_message_id: (info && info.messageId) || null, error: null })
      .catch(() => { /* @silent:storage the log is best-effort and never masks a sent message */ });
    return { via: "website", messageId: (info && info.messageId) || null };
  } catch (err) {
    await emailRepo.recordSend(client, { ...log, status: "FAILED", provider_message_id: null, error: err && err.message })
      .catch(() => { /* @silent:storage the log is best-effort; the original error is the one worth raising */ });
    throw err;
  }
}

/** The files themselves, or links to them, and which it was. */
async function attachmentsFor(client, { row, attachments, slug }) {
  const total = attachments.reduce((n, a) => n + Number(a.byte_size || 0), 0);
  if (!attachments.length) return { mode: "none", files: [] };
  if (total <= websiteMessages.ATTACHMENTS_INLINE_BYTES) {
    const files = [];
    for (const a of attachments) {
      const { buffer } = await vault.fetchBytes(client, a.doc_id);
      files.push({ filename: a.original_name || "attachment", content: buffer, contentType: a.content_type });
    }
    return { mode: "attach", files };
  }
  return {
    mode: "link",
    files: [],
    linkFor: (a) => links.sign({ slug, enquiryId: row.contact_enquiry_id, docId: a.doc_id }),
  };
}

/**
 * Deliver both emails for one message. Throws when either failed, after
 * recording what did go out, so the worker retries only the rest.
 */
async function deliverEnquiry(client, { enquiryId, slug, tenantName, siteOrigin }, tx = null) {
  const row = await repo.getEnquiry(client, enquiryId);
  if (!row) return { skipped: "not_found" };
  const delivery = await settings.delivery(client);
  const mailbox = await settings.senderMailbox(client);
  const entityRef = "contact_enquiry:" + enquiryId;
  const failures = [];
  const out = { inbox: null, ack: null };

  if (!row.inbox_notified_at && delivery.inbox) {
    try {
      const attachments = await repo.listAttachments(client, enquiryId);
      const att = await attachmentsFor(client, { row, attachments, slug });
      const linkBase = `${siteOrigin || ""}/api/tenant/public/intake/attachments/`;
      const mail = composeInbox({
        row, attachments, mode: att.mode, siteOrigin, tenantName,
        linkFor: (a) => linkBase + encodeURIComponent(att.linkFor(a)),
      });
      await sendVia(client, {
        mailbox, to: delivery.inbox, replyTo: row.email || undefined, ...mail,
        attachments: att.files, sendPoint: "site.enquiry.notify", entityRef, tenantSlug: slug,
      }, tx);
      await repo.markDelivery(client, enquiryId, { inbox: true });
      out.inbox = "sent";
    } catch (err) {
      failures.push(`inbox: ${err && err.message}`);
      out.inbox = "failed";
    }
  } else {
    out.inbox = row.inbox_notified_at ? "already" : "no_inbox";
  }

  if (!row.visitor_acked_at && row.email) {
    try {
      const mail = composeAck({ row, tenantName });
      await sendVia(client, {
        mailbox, to: row.email, replyTo: delivery.inbox || undefined, ...mail,
        sendPoint: "site.enquiry.ack", entityRef, tenantSlug: slug,
      }, tx);
      await repo.markDelivery(client, enquiryId, { ack: true });
      out.ack = "sent";
    } catch (err) {
      failures.push(`acknowledgement: ${err && err.message}`);
      out.ack = "failed";
    }
  } else {
    out.ack = row.visitor_acked_at ? "already" : "no_email";
  }

  await repo.markDelivery(client, enquiryId, { error: failures.length ? failures.join("; ") : null });
  if (failures.length) {
    const err = new Error("website message mail failed: " + failures.join("; "));
    err.delivery = out;
    throw err;
  }
  return out;
}

/** Settings › Website › Messages › Send Test. */
async function sendTest(client, { tenantName = "" } = {}, tx = null) {
  const delivery = await settings.delivery(client);
  if (!delivery.inbox) {
    throw new AppError("NO_WEBSITE_INBOX", "Enter the website inbox and save it before sending a test", 422, { inbox: ["required for a test"] });
  }
  const mailbox = await settings.senderMailbox(client);
  const subject = "Test message from your website settings";
  const text = [
    `This is a test from Settings, Website, Messages${tenantName ? ` for ${tenantName}` : ""}.`,
    "",
    "Messages that visitors send from the website will arrive at this address like this one.",
  ].join("\n");
  try {
    await sendVia(client, {
      mailbox, to: delivery.inbox, subject, text, html: text.split("\n").map((l) => (l ? `<p>${esc(l)}</p>` : "")).join("\n"),
      sendPoint: "site.enquiry.notify", entityRef: "setting:website_messages.delivery",
    }, tx);
  } catch (err) {
    if (isSmtpError(err)) throw mapSmtpError(err, { separateSmtpCredentials: true });
    logger.warn({ err: { message: err && err.message } }, "[website-mail] test send failed");
    throw new AppError("SMTP_SEND_FAILED", "The test message could not be sent: " + String((err && err.message) || "unknown error").slice(0, 200), 502);
  }
  return { sent: true, to: delivery.inbox, from: mailbox ? mailbox.from_address : null };
}

module.exports = { deliverEnquiry, sendTest, composeInbox, composeAck, sendVia, attachmentsFor, TYPE_LABEL };
