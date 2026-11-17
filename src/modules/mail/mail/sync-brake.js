"use strict";

/**
 * The brake on the scheduled mail sync: when a failing mailbox is left alone.
 *
 * ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────────
 *
 * The scheduler polls every mailbox once a minute, and a mailbox in ERROR was
 * polled exactly like a healthy one, for ever. A poll of an IMAP mailbox is a
 * sign-in. So one mailbox whose password the server refused meant one refused
 * sign-in a minute from this server's address, and the mail host's firewall
 * counts those: ten in an hour and it blocks the ADDRESS. On 9 Nov 2026 it
 * did. For eight days no system email left the platform (invitations, password
 * resets, sign-in codes) and every mailbox on that host stopped, for every
 * tenant, because of one password on one mailbox. Nothing here was failing a
 * test; the mailbox was red and the loop was doing what it was written to do.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * Up to `FAILURES_BEFORE_BRAKE` failures in a row are a wobble, and the next
 * tick tries again: this is the same three `bumpFailure` waits for before it
 * calls a mailbox ERROR. From there:
 *
 *   refused sign-in   the schedule stops trying. A password the server refused
 *                     is refused again a minute later, and every try is one
 *                     nearer the host's limit. It resumes when a person fixes
 *                     it: saving the password, Test or Sync Now.
 *   anything else     the schedule waits longer after each failure (the steps
 *                     below, the last one repeating). A host that is down or
 *                     blocking us gains nothing from sixty knocks an hour.
 *
 * Only the SCHEDULE is braked. Test, Sync Now and saving credentials always
 * try at once: a person is watching, and one deliberate attempt is not a loop.
 * A success clears the counter, which releases the brake.
 *
 * Pure on purpose: it reads the row and the clock and returns a verdict, so
 * the job, the health text and the tests all ask the same question.
 */
const { isSignInRefusal } = require("./smtp-error.map");

/** Failures in a row before the brake applies. Matches `bumpFailure`. */
const FAILURES_BEFORE_BRAKE = 3;

/** Minutes to wait after the 3rd, 4th, 5th... failure in a row. The last repeats. */
const BACKOFF_MINUTES = Object.freeze([5, 15, 60, 180, 360]);

const MINUTE_MS = 60_000;

/**
 * Should the scheduled sync try this mailbox now?
 *
 *   { due: true }
 *   { due: false, kind: "signin",  retryAt: null }   until a person fixes it
 *   { due: false, kind: "backoff", retryAt: Date }   until then
 */
function verdict(connection = {}, now = Date.now()) {
  const failures = Number(connection.consecutive_failures || 0);
  if (failures < FAILURES_BEFORE_BRAKE) return { due: true };
  if (isSignInRefusal(connection.last_failure_reason)) {
    return { due: false, kind: "signin", retryAt: null };
  }
  const last = new Date(connection.last_failure_at || 0).getTime();
  // No record of when it last failed: there is nothing to wait from.
  if (!Number.isFinite(last) || last <= 0) return { due: true };
  const step = Math.min(failures - FAILURES_BEFORE_BRAKE, BACKOFF_MINUTES.length - 1);
  const retryAt = last + BACKOFF_MINUTES[step] * MINUTE_MS;
  const at = new Date(now).getTime();
  return at >= retryAt ? { due: true } : { due: false, kind: "backoff", retryAt: new Date(retryAt) };
}

/** "about 5 minutes", "about 2 hours": how long until `retryAt`, for a sentence. */
function waitInWords(retryAt, now = Date.now()) {
  const minutes = Math.max(1, Math.ceil((new Date(retryAt).getTime() - new Date(now).getTime()) / MINUTE_MS));
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} hour${hours === 1 ? "" : "s"}`;
}

module.exports = { verdict, waitInWords, FAILURES_BEFORE_BRAKE, BACKOFF_MINUTES };
