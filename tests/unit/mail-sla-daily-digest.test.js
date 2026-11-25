"use strict";

/**
 * The SLA alert, once a day (owner's decision, 25 Nov 2026).
 *
 * Connecting info@smartlsgroup.com imported its history and the sweep sent
 * 100+ "First-response SLA missed" notifications in minutes. Now: one summary
 * at 08:00 in the office's timezone, on a working day, to each mailbox Manager
 * (their mailbox's totals) and each assignee (what they hold); never twice in
 * a day; never about history or automated mail.
 */

jest.mock("../../src/modules/notification/notification.service", () => ({
  notify: jest.fn(async () => ({ notification_id: "n-1" })),
}));
jest.mock("../../src/shared/events/emit", () => ({ emitEvent: jest.fn(async () => ({})) }));

const notify = require("../../src/modules/notification/notification.service");
const sla = require("../../src/modules/mail/triage/sla.service");

const HOURS = [1, 2, 3, 4, 5].map((d) => ({ day_of_week: d, opens_at: "08:00", closes_at: "17:00", timezone: "Africa/Douala" }));
const CTX = { hours: HOURS, holidays: [] };

// Wednesday 25 Nov 2026. Douala is UTC+1.
const AT_0805 = new Date("2026-11-25T07:05:00Z");
const AT_0700 = new Date("2026-11-25T06:00:00Z");
const SATURDAY_0900 = new Date("2026-11-28T08:00:00Z");

function client({ lastSent = null, threads = [], managers = [] } = {}) {
  const calls = [];
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      if (/FROM setting/.test(text)) return { rows: lastSent ? [{ value: { last_sent_on: lastSent } }] : [] };
      if (/AS first_late/.test(text)) return { rows: threads };
      if (/FROM email_connection_member/.test(text)) return { rows: managers };
      return { rows: [] };
    },
  };
}

const THREADS = [
  { email_thread_id: "a", email_connection_id: "info", email_address: "info@smartlsgroup.com", assigned_user_id: "u-agent", first_late: true, resolution_late: false },
  { email_thread_id: "b", email_connection_id: "info", email_address: "info@smartlsgroup.com", assigned_user_id: null, first_late: true, resolution_late: true },
  { email_thread_id: "c", email_connection_id: "info", email_address: "info@smartlsgroup.com", assigned_user_id: "u-agent", first_late: false, resolution_late: true },
];

beforeEach(() => notify.notify.mockClear());

describe("the daily summary", () => {
  it("waits for 08:00 in the office's timezone", async () => {
    const out = await sla.digest(client({ threads: THREADS }), { now: AT_0700, ctx: CTX });
    expect(out).toEqual({ notified: 0, skipped: "before 08:00" });
    expect(notify.notify).not.toHaveBeenCalled();
  });

  it("sends nothing on a day the office is closed", async () => {
    const out = await sla.digest(client({ threads: THREADS }), { now: SATURDAY_0900, ctx: CTX });
    expect(out.skipped).toBe("office closed");
  });

  it("sends once a day, never twice", async () => {
    const out = await sla.digest(client({ lastSent: "2026-11-25", threads: THREADS }), { now: AT_0805, ctx: CTX });
    expect(out.skipped).toBe("already sent today");
    expect(notify.notify).not.toHaveBeenCalled();
  });

  it("tells each Manager their mailbox's totals and each assignee what they hold, one notification each", async () => {
    const c = client({ threads: THREADS, managers: [{ email_connection_id: "info", user_id: "u-owner" }] });
    const out = await sla.digest(c, { now: AT_0805, ctx: CTX });
    expect(out.notified).toBe(2);
    const byUser = Object.fromEntries(notify.notify.mock.calls.map(([, n]) => [n.userId, n]));
    expect(byUser["u-owner"].body).toBe(
      "info@smartlsgroup.com: 2 conversations wait for a first reply, 2 are past the time to resolve.",
    );
    expect(byUser["u-agent"].body).toBe(
      "Assigned to you: 1 conversation waits for a first reply, 1 is past the time to resolve.",
    );
    expect(byUser["u-owner"].dedupeKey).toBe("SLA_DIGEST:2026-11-25:u-owner");
    expect(byUser["u-owner"].priority).toBe("NORMAL");
    // The day is recorded, so the next five-minute sweep sends nothing.
    const write = c.calls.find((q) => /INSERT INTO setting/.test(q.text));
    expect(write.params.slice(0, 2)).toEqual(["mail", "sla_digest"]);
    expect(JSON.parse(write.params[2]).last_sent_on).toBe("2026-11-25");
  });

  it("a Manager who is also the assignee gets one notification with both lines", async () => {
    const c = client({ threads: THREADS, managers: [{ email_connection_id: "info", user_id: "u-agent" }] });
    await sla.digest(c, { now: AT_0805, ctx: CTX });
    expect(notify.notify).toHaveBeenCalledTimes(1);
    expect(notify.notify.mock.calls[0][1].body).toMatch(/^info@smartlsgroup\.com: .*\. Assigned to you: .*\.$/);
  });

  it("only counts mail from people that arrived after the mailbox was connected", async () => {
    const c = client({ threads: [] });
    await sla.digest(c, { now: AT_0805, ctx: CTX });
    const q = c.calls.find((x) => /AS first_late/.test(x.text)).text;
    expect(q).toContain("t.stream IS DISTINCT FROM 'SYSTEM'");
    expect(q).toContain("t.first_message_at >= c.created_at");
  });

  it("no dashes in anything a person reads", async () => {
    const c = client({ threads: THREADS, managers: [{ email_connection_id: "info", user_id: "u-owner" }] });
    await sla.digest(c, { now: AT_0805, ctx: CTX });
    for (const [, n] of notify.notify.mock.calls) expect(`${n.title} ${n.body}`).not.toMatch(/—|–|--/);
  });
});
