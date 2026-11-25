/**
 * SLA clocks, applied (§9.2).
 *
 * `sla-clock.js` knows how to add four business hours to a Friday afternoon.
 * Until this file existed nothing asked it to: `mail_sla_policy`,
 * `business_hours` and `business_holiday` were created by migration 10755 and
 * read by no application code, `first_response_due_at` was never written, and
 * `mail.sla.breached` was never emitted. A team could miss every promise it had
 * made and the product would show a green tick, because the only test in the
 * suite called `addBusinessMinutes` directly and it was right.
 *
 * ── WHY THE SWEEP COMPUTES DUE DATES RATHER THAN INGEST ─────────────────────
 *
 * Setting the due date at arrival is the obvious design and the wrong one here.
 * Policies are tenant-editable, so a lead who shortens the VIP promise from
 * four hours to one expects it to apply to what is already in the queue; a due
 * date stamped at arrival would apply it only to mail that has not come yet.
 * Recomputing on a sweep also makes the whole thing idempotent and recoverable
 * — a worker outage costs lateness in the ALERT, never a lost clock.
 *
 * Everything here is written to survive being run twice.
 *
 * ── WHAT IS ON THE CLOCK, AND HOW ANYONE HEARS ABOUT IT (25 Nov 2026) ───────
 *
 * Connecting info@smartlsgroup.com as a shared mailbox imported its 2025
 * history, and the sweep sent its owner 100+ "First-response SLA missed"
 * notifications within minutes: every imported conversation got a due date in
 * the past and breached at once, carrier notices and job-board mail included,
 * one notification per thread per Manager, up to 500 threads a tick. The
 * owner's decisions, the same day:
 *
 *   1. ONLY MAIL FROM PEOPLE THAT ARRIVED AFTER THE MAILBOX WAS CONNECTED is on
 *      the clock (`ON_THE_CLOCK`). History brought in by the first sync is not
 *      a promise anybody made, and the SYSTEM stream (no-reply, carrier
 *      notices, monitoring: the Notices folder, 10734) is nobody waiting.
 *   2. ONE SUMMARY A DAY, AT 08:00 in the office's timezone, on a day the
 *      office is open (`digest`): each mailbox Manager hears how many of their
 *      mailbox's conversations are waiting, and each assignee hears about the
 *      ones they hold. Breaches are still stamped per thread, as the record,
 *      but no longer notify one by one.
 */
"use strict";

const clock = require("./sla-clock");
const notify = require("../../notification/notification.service");
const { emitEvent } = require("../../../shared/events/emit");
const { logger } = require("../../../config/logger");
const { getSetting, putSetting } = require("../../../shared/config/settings");

/**
 * Which threads a promise applies to. `t` is the thread, `c` its mailbox:
 * mail from people (not the SYSTEM stream) whose conversation began after the
 * mailbox was connected. See the header, decision 1.
 */
const ON_THE_CLOCK = "t.stream IS DISTINCT FROM 'SYSTEM' AND t.first_message_at >= c.created_at";

/** The hour the daily summary goes out, in the office's timezone. */
const DIGEST_HOUR = 8;
const DEFAULT_TZ = "Africa/Douala";

async function calendar(client) {
  const [hours, holidays] = await Promise.all([
    client.query(`SELECT day_of_week, opens_at, closes_at, timezone FROM business_hours ORDER BY day_of_week`)
      .then((r) => r.rows).catch(() => []),
    client.query(`SELECT holiday_on FROM business_holiday`).then((r) => r.rows).catch(() => []),
  ]);
  return { hours, holidays };
}

async function policies(client) {
  return client.query(
    `SELECT * FROM mail_sla_policy WHERE is_active ORDER BY applies_to_vip DESC`,
  ).then((r) => r.rows).catch(() => []);
}

/**
 * The policy that governs a thread.
 *
 * Most specific first: a policy bound to this mailbox beats a tenant-wide one,
 * and a VIP policy beats the ordinary one for a VIP thread. Ordering the rows
 * `applies_to_vip DESC` and taking the first match is what makes the VIP tier
 * actually mean something — the old `dueAt` had a VIP branch that returned the
 * ordinary number.
 */
function policyFor(rows, thread) {
  const eligible = rows.filter((p) =>
    (!p.email_connection_id || p.email_connection_id === thread.email_connection_id)
    && (!p.applies_to_vip || thread.is_vip));
  const scoped = eligible.filter((p) => p.email_connection_id);
  return scoped[0] || eligible[0] || null;
}

/**
 * Derive `first_responded_at` from the messages rather than trusting a flag.
 *
 * A first response is "we sent something after they wrote", which the message
 * table already knows. Deriving it means the clock cannot drift out of step
 * with what actually happened, and means a reply sent from the user's phone —
 * which reaches us through the Sent-folder sync, not through our own send path
 * — still stops the clock.
 */
const RESPONDED = `
  UPDATE email_thread t SET first_responded_at = sub.first_out
    FROM (SELECT email_thread_id, min(received_at) AS first_out
            FROM email_message WHERE direction = 'OUT' GROUP BY email_thread_id) sub
   WHERE sub.email_thread_id = t.email_thread_id
     AND t.first_responded_at IS DISTINCT FROM sub.first_out`;

async function sweep(client, { now = new Date() } = {}) {
  const rows = await policies(client);
  if (!rows.length) return { policies: 0, dated: 0, breached: 0, resolution_breached: 0 };

  const ctx = await calendar(client);
  await client.query(RESPONDED);

  // Only threads that still need a due date. Recomputing every open thread on
  // every tick would be correct and wasteful; a policy change is picked up by
  // the reset below instead.
  // P5-1. `LIMIT 500` without an order starved the oldest (most at-risk)
  // threads under a sustained backlog: which 500 got dated was whatever the
  // planner returned. Oldest first is the only order that matches "the clock
  // that has been running longest is the one we date next".
  const { rows: pending } = await client.query(
    `SELECT t.email_thread_id, t.email_connection_id, t.is_vip, t.first_message_at,
            t.work_status, t.first_responded_at, t.resolved_at
       FROM email_thread t
       JOIN email_connection c ON c.email_connection_id = t.email_connection_id
      WHERE t.work_status = 'OPEN'
        AND t.first_response_due_at IS NULL
        AND c.kind IN ('SHARED','DELEGATED')
        AND ${ON_THE_CLOCK}
      ORDER BY t.first_message_at ASC NULLS LAST
      LIMIT 500`,
  );

  let dated = 0;
  for (const t of pending) {
    const policy = policyFor(rows, t);
    if (!policy) continue;
    const dues = clock.dueDates(t.first_message_at || now, policy, ctx);
    if (!dues.first_response_due_at) continue;
    await client.query(
      `UPDATE email_thread SET first_response_due_at = $2, resolution_due_at = $3
        WHERE email_thread_id = $1`,
      [t.email_thread_id, dues.first_response_due_at, dues.resolution_due_at],
    );
    dated += 1;
  }

  // Breaches are STAMPED here, once per thread (`… IS NULL`), as the record a
  // screen can show. They no longer notify one by one: the people who can act
  // hear about them in the daily summary (header, decision 2).
  const { rows: breaches } = await client.query(
    `UPDATE email_thread t SET sla_breached_at = $1
       FROM email_connection c
      WHERE c.email_connection_id = t.email_connection_id
        AND ${ON_THE_CLOCK}
        AND t.sla_breached_at IS NULL
        AND t.work_status = 'OPEN'
        AND t.first_responded_at IS NULL
        AND t.first_response_due_at IS NOT NULL
        AND t.first_response_due_at <= $1
      RETURNING t.email_thread_id`,
    [now],
  );

  // P5-1: the resolution clock has its own stamp, so a first-response breach
  // does not swallow the later resolution one.
  const { rows: resolutionBreaches } = await client.query(
    `UPDATE email_thread t SET resolution_breached_at = $1
       FROM email_connection c
      WHERE c.email_connection_id = t.email_connection_id
        AND ${ON_THE_CLOCK}
        AND t.resolution_breached_at IS NULL
        AND t.work_status = 'OPEN'
        AND t.resolved_at IS NULL
        AND t.resolution_due_at IS NOT NULL
        AND t.resolution_due_at <= $1
      RETURNING t.email_thread_id`,
    [now],
  );

  let digested = 0;
  try {
    digested = (await digest(client, { now, ctx })).notified;
  } catch (err) {
    logger.warn({ err }, "[mail] SLA daily summary failed; the next sweep tries again");
  }
  return {
    policies: rows.length,
    dated,
    breached: breaches.length,
    resolution_breached: resolutionBreaches.length,
    digested,
  };
}

/* ── The daily summary ───────────────────────────────────────────────────── */

const FMT_OPTS = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short", hourCycle: "h23" };

/**
 * The office's local date (`YYYY-MM-DD`), hour and ISO weekday (1 = Monday).
 * @date-format:parts built only to call formatToParts(); nothing here is
 * rendered for a person to read.
 */
function localClock(now, timeZone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-GB", { ...FMT_OPTS, timeZone: timeZone || DEFAULT_TZ }).formatToParts(now);
  } catch {
    // @silent:parse an unknown zone name in business_hours falls back to the office default
    parts = new Intl.DateTimeFormat("en-GB", { ...FMT_OPTS, timeZone: DEFAULT_TZ }).formatToParts(now);
  }
  const get = (type) => (parts.find((p) => p.type === type) || {}).value;
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday")) + 1;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), weekday };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "3 conversations wait for a first reply, 1 is past the time to resolve" */
function counts(first, resolution) {
  const parts = [];
  if (first) parts.push(`${plural(first, "conversation waits", "conversations wait")} for a first reply`);
  if (resolution) parts.push(`${plural(resolution, "is", "are")} past the time to resolve`);
  return parts.join(", ");
}

/**
 * Once a day, at 08:00 in the office's timezone, on a day the office is open:
 * one notification per person, saying what is waiting.
 *
 *   · a mailbox MANAGER hears the totals for each mailbox they manage;
 *   · an ASSIGNEE hears about the conversations assigned to them.
 *
 * Someone who is both gets ONE notification with both. "Once" is held by the
 * `mail.sla_digest` setting (the local date it last went out), so the
 * five-minute sweep, a restart or a second worker cannot send it twice; the
 * notification's dedupe key carries the date as the second guard.
 */
async function digest(client, { now = new Date(), ctx = null } = {}) {
  const cal = ctx || (await calendar(client));
  const tz = (cal.hours[0] && cal.hours[0].timezone) || DEFAULT_TZ;
  const local = localClock(now, tz);
  if (local.hour < DIGEST_HOUR) return { notified: 0, skipped: "before 08:00" };
  if (cal.hours.length && !cal.hours.some((h) => Number(h.day_of_week) === local.weekday)) {
    return { notified: 0, skipped: "office closed" };
  }
  const last = (await getSetting(client, "mail", "sla_digest", {})) || {};
  if (last.last_sent_on === local.date) return { notified: 0, skipped: "already sent today" };

  const { rows } = await client.query(
    `SELECT t.email_thread_id, t.email_connection_id, t.assigned_user_id, c.email_address,
            (t.first_responded_at IS NULL AND t.first_response_due_at <= $1) AS first_late,
            (t.resolved_at IS NULL AND t.resolution_due_at <= $1) AS resolution_late
       FROM email_thread t
       JOIN email_connection c ON c.email_connection_id = t.email_connection_id
      WHERE t.work_status = 'OPEN'
        AND c.kind IN ('SHARED','DELEGATED')
        AND ${ON_THE_CLOCK}
        AND ((t.first_responded_at IS NULL AND t.first_response_due_at <= $1)
          OR (t.resolved_at IS NULL AND t.resolution_due_at <= $1))`,
    [now],
  );

  const byMailbox = new Map();
  const byAssignee = new Map();
  for (const r of rows) {
    const box = byMailbox.get(r.email_connection_id) || { address: r.email_address, first: 0, resolution: 0 };
    if (r.first_late) box.first += 1;
    if (r.resolution_late) box.resolution += 1;
    byMailbox.set(r.email_connection_id, box);
    if (r.assigned_user_id) {
      const mine = byAssignee.get(r.assigned_user_id) || { first: 0, resolution: 0 };
      if (r.first_late) mine.first += 1;
      if (r.resolution_late) mine.resolution += 1;
      byAssignee.set(r.assigned_user_id, mine);
    }
  }

  const lines = new Map();
  const add = (userId, line) => {
    if (!lines.has(userId)) lines.set(userId, []);
    lines.get(userId).push(line);
  };
  if (byMailbox.size) {
    const { rows: managers } = await client.query(
      `SELECT email_connection_id, user_id FROM email_connection_member
        WHERE email_connection_id = ANY($1::uuid[]) AND member_role = 'MANAGER' AND revoked_at IS NULL`,
      [[...byMailbox.keys()]],
    );
    for (const m of managers) {
      const box = byMailbox.get(m.email_connection_id);
      add(m.user_id, `${box.address}: ${counts(box.first, box.resolution)}.`);
    }
  }
  for (const [userId, mine] of byAssignee) add(userId, `Assigned to you: ${counts(mine.first, mine.resolution)}.`);

  let notified = 0;
  for (const [userId, body] of lines) {
    await notify.notify(client, {
      userId,
      eventTypeKey: "mail.sla.breached",
      title: "Conversations waiting for a reply",
      body: body.join(" "),
      entityRef: null,
      priority: "NORMAL",
      dedupeKey: `SLA_DIGEST:${local.date}:${userId}`,
    });
    notified += 1;
  }
  await putSetting(client, { section: "mail", key: "sla_digest", value: { last_sent_on: local.date, notified } });
  if (notified) {
    await emitEvent(client, {
      eventTypeKey: "mail.sla.breached",
      moduleKey: "MOD-72",
      entityRef: null,
      actorUserId: null,
      payload: { digest: local.date, notified, threads: rows.length },
    }).catch(() => { /* @silent:storage the setting row is the record that it went out */ });
  }
  return { notified };
}

/**
 * Clear computed due dates so the next sweep recomputes them.
 *
 * Called when a policy or the business calendar is edited. Without it, a lead
 * who shortens the VIP promise would see it apply only to future mail, which is
 * not what "we now answer VIPs in an hour" means to the person who said it.
 */
const resetComputed = (client) =>
  client.query(
    `UPDATE email_thread SET first_response_due_at = NULL, resolution_due_at = NULL
      WHERE work_status = 'OPEN' AND first_responded_at IS NULL`,
  ).then((r) => ({ reset: r.rowCount }));

module.exports = { sweep, digest, localClock, policyFor, calendar, policies, resetComputed, ON_THE_CLOCK, DIGEST_HOUR };
