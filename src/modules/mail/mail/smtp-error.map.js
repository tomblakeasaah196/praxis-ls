/**
 * Shared SMTP-error classifier — one map for every outbound-mail path.
 *
 * A raw nodemailer/SMTP rejection must surface as a clean, actionable AppError
 * so the UI can show a fix guide keyed on `code`, not a leaked stack.
 *
 * Classification is by EVIDENCE, not SMTP family. A bare 550 is "mailbox
 * unavailable" in RFC 5321 — user-unknown, policy, AND sender-verify all use
 * it. Treating every 550 as "fix your From address" sends the operator to the
 * wrong panel and marks a retryable/recipient failure permanent.
 *
 * Order: auth → sender → recipient → transient → other 5xx.
 */
"use strict";
const { AppError } = require("../../../utils/errors");

const SENDER_SNIFF =
  /sender verif|valid sender|not allowed to send|relay(ing)? denied|relay access denied|from address must|from address.*(not|must).*(match|authenticat)|sender address rejected|mail from.*(denied|rejected)/i;

const RECIPIENT_SNIFF =
  /user unknown|unknown user|no such user|mailbox (unavailable|not found)|recipient.*(reject|unknown|not found)|invalid recipient|550 5\.1\.1|551 5\.1\.1/i;

const AUTH_SNIFF =
  /eauth|535|auth(entication)? (failed|invalid|denied|required)|must be authenticated|invalid (login|credentials|password)|username and password not accepted/i;

const TRANSIENT_SNIFF = /\b(421|451|452)\b|try again|greylist|temporarily deferred|please try later/i;

function smtpReply(err) {
  return Number(err && err.responseCode) || null;
}

function smtpText(err) {
  return String((err && err.response) || (err && err.message) || err || "");
}

function isSenderRejected(code, raw) {
  const text = String(raw || "");
  // Phrase evidence only. A bare 550/553/554 is not enough.
  if (SENDER_SNIFF.test(text)) return true;
  if (/sender verify failed/i.test(text)) return true;
  if ((code === 550 || code === 553) && /verif/i.test(text)) return true;
  return false;
}

function isRecipientRejected(code, raw) {
  const text = String(raw || "");
  if (RECIPIENT_SNIFF.test(text)) return true;
  if ((code === 551 || code === 553) && /recipient|user|mailbox/i.test(text)) return true;
  return false;
}

function isAuthFailure(err, code, raw) {
  if (err && err.code === "EAUTH") return true;
  if (code === 535) return true;
  return AUTH_SNIFF.test(String(raw || ""));
}

function isTransient(code, raw) {
  if (code === 421 || code === 451 || code === 452) return true;
  return TRANSIENT_SNIFF.test(String(raw || ""));
}

/**
 * Which sign-in was refused, said out loud.
 *
 * A mailbox can receive on one server and send through another with a DIFFERENT
 * credential, and when the relay refuses the sending one the old sentence — "The
 * mail server rejected the SMTP credentials for this mailbox" — named neither
 * the leg nor the credential. Both readings are available to the operator and
 * only one is true, so the message says which password was offered and which
 * screen holds it. Splitting on the mode rather than adding a hedge to one
 * sentence keeps each version short enough to read.
 */
const AUTH_MESSAGE = {
  shared:
    "Sending (SMTP) was refused: the mail server rejected this mailbox's sign-in. "
    + "The same username and password are used for receiving and for sending — if your "
    + "outgoing server needs its own sign-in (a relay such as SMTP2GO, SES or SendGrid does), "
    + "edit the mailbox and choose \"Use different credentials\" for sending.",
  separate:
    "Sending (SMTP) was refused: the mail server rejected the SEPARATE sending credentials "
    + "on this mailbox. The IMAP password was not offered here, so receiving is unaffected — "
    + "check the SMTP username and password on the mailbox.",
};

function mapSmtpError(err, { separateSmtpCredentials = false } = {}) {
  if (err instanceof AppError) return err;
  const code = smtpReply(err);
  const raw = smtpText(err);
  const details = { smtp_code: code, smtp_response: raw.slice(0, 300) };

  if (isAuthFailure(err, code, raw)) {
    return new AppError(
      "SMTP_AUTH_FAILED",
      separateSmtpCredentials ? AUTH_MESSAGE.separate : AUTH_MESSAGE.shared,
      502,
      { ...details, leg: "smtp", smtp_auth: separateSmtpCredentials ? "separate" : "same" },
    );
  }
  if (isSenderRejected(code, raw)) {
    return new AppError(
      "SENDER_NOT_AUTHORIZED",
      "The mail server rejected the sender address. "
        + "The \"From\" address must be a real mailbox on a domain with valid "
        + "MX/SPF/DKIM records and usually has to match the login you connected with. "
        + "This is the mailbox's SMTP setup — not Praxis.",
      422,
      details,
    );
  }
  if (isRecipientRejected(code, raw)) {
    return new AppError(
      "RECIPIENT_REJECTED",
      "The mail server refused one or more recipients. "
        + "Check the To/Cc addresses exist and are allowed by the receiving server.",
      422,
      details,
    );
  }
  if (isTransient(code, raw)) {
    return new AppError(
      "SMTP_SEND_FAILED",
      "The mail server deferred the message. This is usually temporary — try again shortly.",
      502,
      details,
    );
  }
  if (code >= 500 || (err && err.code === "EENVELOPE")) {
    return new AppError(
      "SMTP_SEND_REJECTED",
      `The mail server rejected the message${code ? ` (${code})` : ""}.`,
      502,
      details,
    );
  }
  return new AppError(
    "SMTP_SEND_FAILED",
    "Could not send the message through the mail server.",
    502,
    { reason: raw.slice(0, 300) },
  );
}

function smtpCodeFromMessage(msg) {
  const text = String(msg || "");
  if (isAuthFailure(null, null, text)) return "SMTP_AUTH_FAILED";
  if (isSenderRejected(null, text)) return "SENDER_NOT_AUTHORIZED";
  if (isRecipientRejected(null, text)) return "RECIPIENT_REJECTED";
  if (isTransient(null, text)) return "SMTP_SEND_FAILED";
  if (/\b5\d\d\b/.test(text) || /rejected|refused|denied/i.test(text)) return "SMTP_SEND_REJECTED";
  return null;
}

function isSmtpError(err) {
  if (!err) return false;
  return !!(err.responseCode || err.code === "EAUTH" || err.code === "EENVELOPE" || smtpCodeFromMessage(err.response || err.message));
}

/**
 * The RECEIVING leg's counterpart to the block above.
 *
 * imapflow reports a refused login as a bare `AUTHENTICATIONFAILED`, which
 * reads as "you typed your password wrong" and says nothing about which of a
 * mailbox's two sign-ins is meant. Once a mailbox can hold two, that ambiguity
 * costs the operator the same wrong hour the SMTP one did — so the receiving
 * leg names itself too, and says that the sending credential is not what was
 * refused.
 *
 * Only an AUTH failure is renamed as a credential problem. A DNS failure, a
 * refused connection or a TLS error is a fact about the HOST, and dressing one
 * up as a credential problem would send somebody to retype a password that is
 * perfectly correct.
 *
 * A host that could not be REACHED is said as that, when the caller passes the
 * host it tried (`where`). imapflow's own sentence for it is "Failed to
 * establish connection in required time", which names no server and reads as
 * the product being slow; the truth is that the server never answered, and the
 * usual cause is the mail host's firewall blocking this server's address. The
 * sentence ends by ruling the password out, because that is what an operator
 * retypes first. Without `where` the text is left exactly as imapflow gave it.
 */
const IMAP_AUTH_SNIFF = /authenticationfailed|invalid credentials|login failed|\[auth\]|authentication failed/i;

/** A failure before the server said anything: DNS, TCP, TLS or the greeting. */
const IMAP_UNREACHABLE_CODES = new Set([
  "CONNECT_TIMEOUT", "GREETING_TIMEOUT", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND",
  "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "ECONNRESET",
]);
const IMAP_UNREACHABLE_SNIFF = /in required time|getaddrinfo|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i;

function isImapUnreachable(err, raw) {
  return IMAP_UNREACHABLE_CODES.has(err && err.code) || IMAP_UNREACHABLE_SNIFF.test(raw);
}

function describeImapFailure(err, where) {
  const raw = String((err && err.message) || err || "");
  if (!IMAP_AUTH_SNIFF.test(raw)) {
    if (where && where.host && isImapUnreachable(err, raw)) {
      const reason = (err && err.code) || raw.slice(0, 80);
      return {
        message:
          `Could not reach ${where.host} on port ${where.port || 993} from this server (${reason}). `
          + "This is the incoming (IMAP) host name, the port, or a firewall at the mail host blocking this server. "
          + "The password was never tried.",
        code: "IMAP_UNREACHABLE",
      };
    }
    return { message: raw, code: null };
  }
  return {
    message:
      "Receiving (IMAP) was refused: the mail server rejected this mailbox's sign-in "
      + `(${raw.slice(0, 120)}). This is the mailbox password, not any separate sending `
      + "credential — check the username and password on the mailbox.",
    code: "IMAP_AUTH_FAILED",
  };
}

module.exports = {
  mapSmtpError,
  smtpCodeFromMessage,
  isSmtpError,
  isSenderRejected,
  isRecipientRejected,
  describeImapFailure,
};
