/**
 * Lead (MOD-20) — the company row's rules. No SQL, no client.
 *
 * Since the Sales lean revamp (PR 2, doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §4.1)
 * a lead is OPEN or ARCHIVED and nothing else: where a deal stands is its
 * request's stage. The five-step funnel this file used to hold
 * (NEW → CONTACTED → QUALIFIED → CONVERTED / LOST) is gone with it.
 */
"use strict";
const { lead: shape } = require("@praxis/shared");

const STATUSES = [...shape.STATUSES];

/**
 * Does this row owe a next step (§3.2, §4.4)?
 *
 * Every OPEN row does, with one exception: a client with nothing open. A
 * client whose every request is won or lost is a customer between jobs, not a
 * lead going quiet. An ARCHIVED row owes nothing, which is what Archive is for.
 */
function owesNextStep({ status, client_id: clientId }, openRequests = 0) {
  if (status !== "OPEN") return false;
  return !clientId || openRequests > 0;
}

/**
 * When a website request is due an answer: four WORKING hours from its
 * arrival, on the tenant's clock (§3.2, "Who owns a website lead").
 *
 * The working day is 08:00 to 17:00, Monday to Friday. No legal source: a
 * company rule, the hours SMART's desk keeps, and the same day the success
 * measure in §0 reads ("answer every enquiry the same day"). A request at
 * 15:30 on a Friday is due at 10:30 on Monday, not at 19:30 on Friday.
 *
 * `parts(date)` returns the local wall clock of an instant and `instant(parts)`
 * turns a wall clock back into an instant; both are injected so this stays a
 * pure function of its inputs (lead.service passes the workspace clock's).
 */
const DAY_START = 8;
const DAY_END = 17;
function addWorkingHours(from, hours, { parts, instant }) {
  let remaining = hours * 60;
  let p = parts(from);
  const isWorkday = (x) => x.weekday >= 1 && x.weekday <= 5;
  const nextMorning = (x) => {
    let n = parts(instant({ ...x, hour: 12, minute: 0 }).getTime() + 24 * 3600 * 1000);
    while (!isWorkday(n)) n = parts(instant({ ...n, hour: 12, minute: 0 }).getTime() + 24 * 3600 * 1000);
    return { ...n, hour: DAY_START, minute: 0 };
  };
  // Outside the working day, the clock starts at the next opening.
  if (!isWorkday(p) || p.hour >= DAY_END) p = nextMorning(p);
  else if (p.hour < DAY_START) p = { ...p, hour: DAY_START, minute: 0 };
  for (;;) {
    const left = (DAY_END - p.hour) * 60 - p.minute;
    if (remaining <= left) {
      const total = p.hour * 60 + p.minute + remaining;
      return instant({ ...p, hour: Math.floor(total / 60), minute: total % 60 });
    }
    remaining -= left;
    p = nextMorning(p);
  }
}

module.exports = { STATUSES, owesNextStep, addWorkingHours, DAY_START, DAY_END };
