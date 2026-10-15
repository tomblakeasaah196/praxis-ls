/**
 * What a punch is worth, decided without ever refusing it (14403). Pure.
 *
 * Every rule in here answers "how should this punch be RECORDED?", and none of
 * them answers "should it be recorded?", because that question no longer has a
 * "no". A tenant's `block` policy used to turn a punch away with a 422; it now
 * holds it for a manager, which keeps the strictness the tenant chose and stops
 * throwing away the one record that says the person turned up.
 */
"use strict";

/**
 * How long after the tap a location reading still counts as WHERE the tap
 * happened. Long enough for a cold GPS on a phone indoors; short enough that
 * nobody gets from the car park to the gate inside it.
 */
const FIX_JUDGE_WINDOW_MS = 20_000;

/** A reading later than this is not attached at all. It says nothing. */
const FIX_ATTACH_LIMIT_MS = 10 * 60_000;

/**
 * A tap time within this of the server's clock is a LIVE punch. The client
 * waits up to five seconds for a reading before it sends, plus the network, so
 * a live punch always arrives a little after its own tap.
 */
const LIVE_GAP_MS = 60_000;

/** A phone clock this far AHEAD of ours is wrong, not early. */
const TAP_FUTURE_SKEW_MS = 2 * 60_000;

/** An offline punch older than this is held: a day is long enough to notice. */
const TAP_MAX_AGE_MS = 24 * 60 * 60_000;

/** Why the phone had no location at the tap. Mirrors the 14403 CHECK. */
const LOCATION_ERRORS = ["denied", "os_off", "unavailable", "timeout", "unsupported"];

/** Why a punch was held or flagged. Mirrors the 14403 CHECK. */
const REVIEW_REASONS = ["off_site", "device", "offline_time"];

const toDate = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * The moment a punch happened, given what the phone claims and when we heard.
 *
 * The phone's tap time WINS, because it is what the person is paid on: a punch
 * held in a dead zone for an hour happened an hour ago. Three claims do not add
 * up, and each is kept but marked `implausible` so it is held for a manager
 * rather than refused:
 *
 *   · a tap in the future (beyond clock skew): the phone's clock is wrong, so
 *     the receipt time is used instead;
 *   · a tap more than a day old;
 *   · a tap earlier than a moment it must follow (the clock-in, for a
 *     clock-out; the last clock-out, for a clock-in).
 *
 * `offline` is decided HERE from the gap, not taken from the client. A punch
 * whose tap is more than a minute older than its arrival WAS held somewhere,
 * whatever the phone says about itself, and the manager is shown that it was.
 */
function resolveTapTime({ tappedAt = null, receivedAt = new Date(), notBefore = null } = {}) {
  const received = toDate(receivedAt) || new Date();
  if (tappedAt === null || tappedAt === undefined || tappedAt === "") {
    return { at: received, offline: false, implausible: false };
  }
  const tap = toDate(tappedAt);
  if (!tap) return { at: received, offline: false, implausible: true };

  const ahead = tap.getTime() - received.getTime();
  if (ahead > TAP_FUTURE_SKEW_MS) return { at: received, offline: false, implausible: true };
  // A little ahead is ordinary clock skew. Never store a punch after its own
  // arrival, but do not call it a problem either.
  if (ahead > 0) return { at: received, offline: false, implausible: false };

  const gap = -ahead;
  const offline = gap > LIVE_GAP_MS;
  const floor = toDate(notBefore);
  const tooOld = gap > TAP_MAX_AGE_MS;
  const beforeFloor = !!floor && tap.getTime() < floor.getTime();
  return { at: tap, offline, implausible: tooOld || beforeFloor };
}

/**
 * The review verdict for a punch: what is odd about it, and whether it is HELD.
 *
 * A reason is recorded whenever a policy is switched on and has something to
 * say, so `warn` tenants still see why a punch was flagged. A punch is HELD
 * (`review_status = 'PENDING'`, not counted as presence until a manager
 * decides) only where the tenant chose `block`, or where the punch's own time
 * cannot be trusted. Nothing here can stop the punch being written.
 */
function reviewFor({
  geofenceMode = "warn",
  within = null,
  devicePolicy = "off",
  devicePresented = false,
  deviceTrusted = null,
  timeImplausible = false,
} = {}) {
  const reasons = [];
  let held = false;

  if (geofenceMode !== "off" && within === false) {
    reasons.push("off_site");
    if (geofenceMode === "block") held = true;
  }

  // Under `block` a phone that presents no device id is as unknown as one the
  // register has never approved. Under `warn` a missing id stays unflagged, as
  // it always has: an old client is not evidence of anything.
  const unapproved = devicePresented ? deviceTrusted === false : devicePolicy === "block";
  if (devicePolicy !== "off" && unapproved) {
    reasons.push("device");
    if (devicePolicy === "block") held = true;
  }

  if (timeImplausible) {
    reasons.push("offline_time");
    held = true;
  }

  return { reasons, held, status: held ? "PENDING" : null };
}

/**
 * Merge a new verdict into a punch that may already carry one.
 *
 * A manager's decision is never reopened by a reading that lands afterwards:
 * APPROVED and REJECTED stay as they are, and only the reasons grow.
 */
function mergeReview(row = {}, verdict = { reasons: [], held: false }) {
  const reasons = Array.from(new Set([...(row.review_reasons || []), ...verdict.reasons]));
  const decided = row.review_status === "APPROVED" || row.review_status === "REJECTED";
  const status = decided ? row.review_status : verdict.held || row.review_status === "PENDING" ? "PENDING" : null;
  return { review_reasons: reasons, review_status: status };
}

/**
 * How a reading that arrived after the punch is treated.
 *
 *   judge   it arrived inside the window: it is where the tap happened, and it
 *           decides on-site and off-site exactly as if it had come with the punch;
 *   late    it arrived later: shown, labelled, never used to decide on-site;
 *   ignore  it arrived so late it says nothing, or before the punch it claims.
 */
function classifyLateFix({ punchAt, fixAt }) {
  const p = toDate(punchAt);
  const f = toDate(fixAt);
  if (!p || !f) return { kind: "ignore", delayMs: null };
  const delayMs = f.getTime() - p.getTime();
  if (delayMs < 0 || delayMs > FIX_ATTACH_LIMIT_MS) return { kind: "ignore", delayMs };
  return { kind: delayMs <= FIX_JUDGE_WINDOW_MS ? "judge" : "late", delayMs };
}

module.exports = {
  FIX_JUDGE_WINDOW_MS,
  FIX_ATTACH_LIMIT_MS,
  LIVE_GAP_MS,
  TAP_FUTURE_SKEW_MS,
  TAP_MAX_AGE_MS,
  LOCATION_ERRORS,
  REVIEW_REASONS,
  resolveTapTime,
  reviewFor,
  mergeReview,
  classifyLateFix,
};
