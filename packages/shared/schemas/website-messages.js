"use strict";
/**
 * Website messages: where a visitor's message is delivered, which mailbox sends
 * it, and the bot check in front of it. One definition for the API
 * (`setting.rules`, the public intake) and the Settings › Website › Messages
 * screen, so the form refuses exactly what the API refuses.
 *
 * ── THE THREE SETTINGS ────────────────────────────────────────────────────
 *
 * 1. `website_messages.delivery`: the INBOX every website message is emailed to
 *    (SmartLS: info@smartlsgroup.com), and the SENDER mailbox it goes out from
 *    (address, display name, SMTP host, port and user name). The mailbox
 *    PASSWORD is not here: it is an encrypted integration secret
 *    (`integration_secret.website_smtp_pass`), written once and never read back.
 *    With no sender set, messages go out through the tenant's ordinary mail
 *    settings, then the Praxis system sender, as every other email does.
 *
 * 2. `website_messages.turnstile`: the Cloudflare Turnstile SITE key, which is
 *    public by design (the browser needs it). The SECRET is the encrypted
 *    integration secret `turnstile_secret`. With either missing the website
 *    keeps working on the honeypot and the timing check alone, so a tenant (or
 *    a staging copy) with no keys is never locked out of its own forms.
 *
 * 3. The attachment rules a visitor's files are held to, here so the website,
 *    the server and the email agree on the same numbers.
 */

const { z } = require("zod");

const blankToNull = (v) => (typeof v === "string" && v.trim() === "" ? null : v);
const optionalText = (max) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());
const optionalEmail = z.preprocess(
  blankToNull,
  z.string().trim().toLowerCase().email("Enter a full email address, like info@example.com.").max(255).nullable().optional(),
);

/** Settings › Website › Messages, the delivery card. */
const deliverySetting = z
  .object({
    inbox: optionalEmail,
    from_address: optionalEmail,
    from_name: optionalText(120),
    smtp_host: z.preprocess(
      blankToNull,
      z
        .string()
        .trim()
        .toLowerCase()
        .max(255)
        .regex(/^[a-z0-9.-]+$/, "Enter the server name only, like smtppro.zoho.com.")
        .nullable()
        .optional(),
    ),
    smtp_port: z.preprocess(
      (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
      z.number().int().min(1).max(65535).nullable().optional(),
    ),
    smtp_user: optionalText(255),
  })
  .strict()
  .superRefine((v, ctx) => {
    // A host with no address to send AS is a transport that cannot be used:
    // the mail server refuses a From it did not authenticate. Said at Save,
    // not discovered when the first message fails.
    if (v.smtp_host && !v.from_address) {
      ctx.addIssue({ code: "custom", path: ["from_address"], message: "Enter the address messages are sent from." });
    }
  });

/** Settings › Website › Messages, the bot check card. */
const turnstileSetting = z
  .object({
    site_key: optionalText(200),
  })
  .strict();

/* ── Attachments ──────────────────────────────────────────────────────────── */

/** All files on one message together, decoded. The owner's number. */
const ATTACHMENTS_TOTAL_BYTES = 20 * 1024 * 1024;
/** How many files one message may carry. */
const ATTACHMENTS_MAX_FILES = 10;
/**
 * Up to this many bytes in all, the files travel IN the email to the inbox.
 * Above it they travel as expiring links instead: most mail servers refuse a
 * message much over 20 MB once base64 has grown it by a third.
 */
const ATTACHMENTS_INLINE_BYTES = 10 * 1024 * 1024;
/** How long a link to an attachment in the inbox email keeps working. */
const ATTACHMENT_LINK_DAYS = 30;

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/** What a visitor may attach. Sniffed on the server, never believed. */
const ATTACHMENT_TYPES = Object.freeze([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  DOCX,
  XLSX,
]);

module.exports = {
  deliverySetting,
  turnstileSetting,
  ATTACHMENTS_TOTAL_BYTES,
  ATTACHMENTS_MAX_FILES,
  ATTACHMENTS_INLINE_BYTES,
  ATTACHMENT_LINK_DAYS,
  ATTACHMENT_TYPES,
  DOCX,
  XLSX,
};
