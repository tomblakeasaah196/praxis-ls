"use strict";

/**
 * 14180 — telling clients what is waiting in their portal, by email and push.
 *
 *   PRODUCER (shared/notifications/notify-portal.js)
 *     1. Only the listed events, only the kind worth telling (a team reply,
 *        not the client's own message; a stage DONE, not started).
 *     2. Never from a sandbox, never without a tenant to queue for.
 *     3. The outbox row is written inside a savepoint, so a failure cannot
 *        abort the business transaction — and nothing throws.
 *     4. One job per client, topic and window: a burst is one message.
 *
 *   DELIVERY (modules/portal/portal_notify.service.js)
 *     5. Switches: defaults (shipment steps off by email), per-scope topics,
 *        a hidden topic kept as it was.
 *     6. A chat reply pushed only to people who have not read it; emailed at
 *        most once an hour per conversation.
 *     7. Everything else batched into one email per person, with the send
 *        point an administrator can route; a person told once is not told
 *        again on a retry; a failed send gives its claim back and the job
 *        is retried.
 *     8. A push endpoint must be a real push service (the worker POSTs to it).
 */

let mockRows;
let mockPushes;
let mockEmails;
let mockEnqueued;
let mockCtx;
let mockDb;

jest.mock("../../src/config/request-context", () => ({
  getTenant: () => (mockCtx ? mockCtx.tenant : null),
  getEnv: () => (mockCtx ? mockCtx.env : null),
  get: () => mockCtx,
}));
jest.mock("../../src/jobs/queue-producer", () => ({
  enqueue: async (...args) => {
    mockEnqueued.push(args);
    return { id: "job" };
  },
}));
jest.mock("../../src/services/tenant/registry.service", () => ({
  resolveBySlug: async (slug) => ({ slug, tenant_id: "t-1", db_name: "db" }),
  publicSurfaceOrigin: async () => "https://acme.example",
  workspaceOrigin: async () => ({ origin: "https://acme.praxis.test" }),
}));
jest.mock("../../src/shared/push/push.service", () => ({
  sendToPortalUser: async (c, p) => {
    mockPushes.push(p);
    return { sent: 1, failed: 0, total: 1 };
  },
  getPublicKey: async () => "BPUBLIC",
  currentKeyFingerprint: async () => "fp",
}));
jest.mock("../../src/services/email.service", () => ({
  send: async (c, m) => {
    if (m.to === "fails@acme.cm") throw new Error("SMTP down");
    mockEmails.push(m);
    return { messageId: "m" };
  },
}));
// A team message's files, read once for every recipient (Send by email, B4).
jest.mock("../../src/services/storage.service", () => ({
  get: async () => Buffer.from("%PDF-1.4"),
}));
jest.mock("../../src/modules/branding/branding.service", () => ({
  getBranding: async () => ({ name: "Acme Logistics", primary: "#0a7d5a", primaryForeground: "#ffffff", logoUrl: "/media/logo.png" }),
}));
jest.mock("../../src/modules/portal/portal_notify.repo", () =>
  new Proxy({}, {
    get: (_t, name) => (...args) => {
      if (!mockDb[name]) throw new Error(`repo.${String(name)} not mocked`);
      return mockDb[name](...args);
    },
  }));

const producer = require("../../src/shared/notifications/notify-portal");
const notify = require("../../src/modules/portal/portal_notify.service");
const { isPushService, schemas } = require("../../src/modules/portal_auth/portal_auth.validator");

const CLIENT = "22222222-2222-4222-8222-222222222222";
const SHIP = "33333333-3333-4333-8333-333333333333";
const MSG = "44444444-4444-4444-8444-444444444444";
const STAGE = "55555555-5555-4555-8555-555555555555";
const INV = "66666666-6666-4666-8666-666666666666";
const QUOTE = "77777777-7777-4777-8777-777777777777";

/** A connection that records what it was asked, and answers from `mockRows`. */
function conn(env) {
  const calls = [];
  const c = {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      for (const [re, answer] of mockRows) {
        if (re.test(sql)) {
          if (answer instanceof Error) throw answer;
          return typeof answer === "function" ? answer(sql, params) : answer;
        }
      }
      return { rows: [], rowCount: 0 };
    }),
  };
  if (env) c[Symbol.for("praxis.conn.env")] = env;
  return c;
}
const inserts = (c) => c.calls.filter((x) => /INSERT INTO portal_notify_outbox/.test(x.sql));

beforeEach(() => {
  mockRows = [];
  mockPushes = [];
  mockEmails = [];
  mockEnqueued = [];
  mockCtx = { tenant: "acme", env: "live" };
  mockDb = {};
});

/* ── the producer ─────────────────────────────────────────────────────── */

describe("which events reach a client", () => {
  test("an event that is not on the list costs nothing — no query at all", async () => {
    const c = conn("live");
    expect(await producer.onEvent(c, { eventTypeKey: "invoice.drafted", entityRef: `invoice:${INV}`, payload: {} })).toBeNull();
    expect(c.calls).toEqual([]);
    expect(mockEnqueued).toEqual([]);
  });

  test("a team reply is recorded for its conversation and queued twice: a quick push, a slow email", async () => {
    const c = conn("live");
    const out = await producer.onEvent(c, {
      eventTypeKey: "portal.client_message",
      entityRef: `client_message:${MSG}`,
      payload: { client_id: CLIENT, dossier_id: SHIP, direction: "STAFF", kind: "TEXT" },
    });
    expect(out).toMatchObject({ clientId: CLIENT, topic: "MESSAGES", thread: SHIP });
    expect(inserts(c)[0].params).toEqual([CLIENT, "MESSAGES", SHIP, "portal.client_message", `client_message:${MSG}`]);
    // Inside a savepoint, released after.
    expect(c.calls[0].sql).toBe("SAVEPOINT portal_notify");
    expect(c.calls.map((x) => x.sql)).toContain("RELEASE SAVEPOINT portal_notify");
    expect(mockEnqueued.map((e) => [e[0], e[1]])).toEqual([
      ["portal-notify-deliver", "push"],
      ["portal-notify-deliver", "email"],
    ]);
    const [push, email] = mockEnqueued.map((e) => e[3].delay);
    expect(push).toBeGreaterThanOrEqual(12_000);
    expect(push).toBeLessThanOrEqual(20_000);
    expect(email).toBeGreaterThanOrEqual(10 * 60_000);
  });

  test("the client's OWN message is not news to them", async () => {
    const c = conn("live");
    const out = await producer.onEvent(c, {
      eventTypeKey: "portal.client_message",
      entityRef: `client_message:${MSG}`,
      payload: { client_id: CLIENT, dossier_id: null, kind: "TEXT" },
    });
    expect(out).toBeNull();
    expect(c.calls).toEqual([]);
  });

  test("a stage is told when it is DONE and client-visible — read, not trusted from the payload", async () => {
    mockRows = [[/FROM milestone_instance mi/, { rows: [{ client_id: CLIENT }] }]];
    const c = conn("live");
    await producer.onEvent(c, {
      eventTypeKey: "milestone.advanced",
      entityRef: `dossier:${SHIP}`,
      payload: { milestone_instance_id: STAGE, to: "IN_PROGRESS" },
    });
    expect(inserts(c)).toEqual([]);

    const out = await producer.onEvent(c, {
      eventTypeKey: "milestone.advanced",
      entityRef: `dossier:${SHIP}`,
      payload: { milestone_instance_id: STAGE, to: "DONE" },
    });
    expect(out).toMatchObject({ topic: "SHIPMENTS", item: `milestone_instance:${STAGE}` });
    const read = c.calls.find((x) => /FROM milestone_instance mi/.test(x.sql));
    expect(read.sql).toMatch(/is_client_visible/);
  });

  test("an internal stage — no client-visible row — records nothing", async () => {
    const c = conn("live");
    const out = await producer.onEvent(c, {
      eventTypeKey: "milestone.advanced",
      entityRef: `dossier:${SHIP}`,
      payload: { milestone_instance_id: STAGE, to: "DONE" },
    });
    expect(out).toBeNull();
    expect(inserts(c)).toEqual([]);
    expect(mockEnqueued).toEqual([]);
  });

  test("never from a sandbox, never without a tenant", async () => {
    const sandbox = conn("sandbox");
    const evt = { eventTypeKey: "client_request.created", entityRef: `client_request:${MSG}`, payload: { client_id: CLIENT } };
    expect(await producer.onEvent(sandbox, evt)).toBeNull();
    expect(sandbox.calls).toEqual([]);

    mockCtx = null;
    const live = conn("live");
    expect(await producer.onEvent(live, evt)).toBeNull();
    expect(live.calls).toEqual([]);
  });

  test("a failed write rolls back to the savepoint and does not throw into the business operation", async () => {
    mockRows = [[/INSERT INTO portal_notify_outbox/, new Error("relation does not exist")]];
    const c = conn("live");
    const out = await producer.onEvent(c, {
      eventTypeKey: "invoice_bundle.published", entityRef: `final_invoice:${INV}`, payload: { client_id: CLIENT },
    });
    expect(out).toBeNull();
    expect(c.calls.map((x) => x.sql)).toContain("ROLLBACK TO SAVEPOINT portal_notify");
    expect(mockEnqueued).toEqual([]);
  });

  test("a burst is one job: the same client, topic and window share a job id", async () => {
    const meta = { slug: "acme" };
    const t0 = 28_333_334 * 60_000 + 40_000; // 40 s into a minute
    await producer.schedule(meta, { clientId: CLIENT, topic: "BILLING" }, t0);
    await producer.schedule(meta, { clientId: CLIENT, topic: "BILLING" }, t0 + 5_000);
    await producer.schedule(meta, { clientId: CLIENT, topic: "BILLING" }, t0 + 30_000);
    const ids = mockEnqueued.map((e) => e[3].jobId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
    expect(ids[0]).not.toMatch(/:/);
  });
});

/* ── the switches ─────────────────────────────────────────────────────── */

describe("a person's own switches", () => {
  test("defaults: everything on, except shipment steps by email", async () => {
    mockDb.setting = async () => null;
    const s = await notify.settings(null, { clientId: CLIENT, email: "marie@acme.cm", scope: "ALL" });
    expect(s.topics.map((x) => x.topic)).toEqual(["MESSAGES", "REQUESTS", "QUOTES", "BILLING", "PROPOSALS", "SHIPMENTS"]);
    // A quote request's news is emailed by default (tenant review 29 Sep 2026, B3).
    expect(s.topics.find((x) => x.topic === "QUOTES")).toEqual({ topic: "QUOTES", email: true, push: true });
    expect(s.topics.find((x) => x.topic === "SHIPMENTS")).toEqual({ topic: "SHIPMENTS", email: false, push: true });
    expect(s.topics.find((x) => x.topic === "BILLING")).toEqual({ topic: "BILLING", email: true, push: true });
  });

  test("a colleague given Billing only is offered the General conversation and billing — nothing else", async () => {
    mockDb.setting = async () => null;
    const s = await notify.settings(null, { clientId: CLIENT, email: "fin@acme.cm", scope: "BILLING" });
    expect(s.topics.map((x) => x.topic)).toEqual(["MESSAGES", "BILLING"]);
  });

  test("saving keeps a topic this person cannot see exactly as it was", async () => {
    let saved = null;
    mockDb.setting = async () => (saved ? { email_off: saved.emailOff, push_off: saved.pushOff } : { email_off: ["SHIPMENTS", "PROPOSALS"], push_off: [] });
    mockDb.saveSetting = async (c, s) => {
      saved = s;
      return s;
    };
    await notify.saveSettings(null, {
      clientId: CLIENT, email: "fin@acme.cm", scope: "BILLING",
      topics: [{ topic: "BILLING", email: false, push: true }, { topic: "SHIPMENTS", email: true, push: true }],
    });
    // BILLING turned off by email; SHIPMENTS and PROPOSALS untouched — this
    // person cannot see them, so their choice cannot be changed from here.
    expect(saved.emailOff.sort()).toEqual(["BILLING", "PROPOSALS", "SHIPMENTS"]);
    expect(saved.pushOff).toEqual([]);
  });
});

/* ── delivery ─────────────────────────────────────────────────────────── */

const MARIE = { email: "marie@acme.cm", scope: "ALL", granted_at: "2026-01-01", portal_user_id: "pu-1", devices: 1, language: "en" };
const PAUL = { email: "paul@acme.cm", scope: "OPERATIONS", granted_at: "2026-01-01", portal_user_id: "pu-2", devices: 2, language: "fr" };
const FIN = { email: "fin@acme.cm", scope: "BILLING", granted_at: "2026-01-01", portal_user_id: "pu-3", devices: 1, language: "en" };

function deliveryDb({ people, waiting, unread = {}, told = false, claim = () => 1 }) {
  const marked = [];
  const released = [];
  Object.assign(mockDb, {
    audience: async () => people,
    clientProfile: async () => ({ name: "Acme Trading", preferred_language: "en" }),
    waiting: async (c, { channel }) => (waiting[channel] || []),
    markDone: async (c, { ids, channel }) => marked.push([channel, ids]),
    unreadReplies: async (c, { portalUserId }) => unread[portalUserId] || [],
    recentlyTold: async () => told,
    claim: async (c, a) => claim(a),
    release: async (c, id) => released.push(id),
    sweep: async () => {},
    staleGroups: async () => [],
    invoices: async () => [{ invoice_id: INV, doc_number: "FA-2026-0012", currency: "XAF", total_ttc: "1250000", payment_due_on: "2026-10-30", documents: 3 }],
    proofs: async () => [],
    requests: async () => [],
    proposals: async () => [],
    quotations: async (c, { ids }) => (ids.includes(QUOTE) ? [{ quotation_id: QUOTE, doc_number: "QT-2026-0004" }] : []),
    stages: async () => [],
    manuallySent: async () => new Set(),
    quoteRequests: async () => [],
  });
  return { marked, released };
}

const TENANT = { slug: "acme", tenant_id: "t-1" };

describe("a reply from the team", () => {
  const rows = [{ outbox_id: 7, event_key: "portal.client_message", item_ref: `client_message:${MSG}` }];

  test("is pushed to whoever has not read it, and opens that conversation", async () => {
    const { marked } = deliveryDb({
      people: [MARIE, PAUL],
      waiting: { push: rows },
      unread: { "pu-1": [{ message_id: MSG, body: "The truck left Douala", author: "Awa", dossier_ref: null }] },
    });
    const out = await notify.deliver(null, { tenant: TENANT, clientId: CLIENT, topic: "MESSAGES", thread: "general", stage: "push" });
    // Paul read it in the portal already: nothing for him.
    expect(mockPushes).toHaveLength(1);
    expect(mockPushes[0]).toMatchObject({
      portal_user_id: "pu-1",
      title: "Acme Logistics",
      body: "Awa: The truck left Douala",
      url: "/portal?chat=general",
      tag: "messages:general",
      urgency: "high",
    });
    expect(out.pushed).toBe(1);
    expect(marked).toEqual([["push", [7]]]);
  });

  test("a shipment's conversation says which shipment, and a Billing-only colleague is not told", async () => {
    deliveryDb({
      people: [FIN, MARIE],
      waiting: { push: rows },
      unread: {
        "pu-1": [{ message_id: MSG, body: "", attachment_kind: "IMAGE", author: "Awa", dossier_ref: "PRX-2026-0418" }],
        "pu-3": [{ message_id: MSG, body: "x", author: "Awa", dossier_ref: "PRX-2026-0418" }],
      },
    });
    await notify.deliver(null, { tenant: TENANT, clientId: CLIENT, topic: "MESSAGES", thread: SHIP, stage: "push" });
    expect(mockPushes.map((p) => p.portal_user_id)).toEqual(["pu-1"]);
    expect(mockPushes[0].title).toBe("Acme Logistics · PRX-2026-0418");
    expect(mockPushes[0].body).toBe("Awa: Photo");
    expect(mockPushes[0].url).toBe(`/portal?chat=${SHIP}`);
  });

  test("is emailed at most once an hour per conversation", async () => {
    const { marked } = deliveryDb({
      people: [MARIE],
      waiting: { email: rows },
      unread: { "pu-1": [{ message_id: MSG, body: "Hello", author: "Awa" }] },
      told: true,
    });
    await notify.deliver(null, { tenant: TENANT, clientId: CLIENT, topic: "MESSAGES", thread: "general", stage: "email" });
    expect(mockEmails).toEqual([]);
    // Handled, not left waiting: the earlier email already said the thread moved.
    expect(marked).toEqual([["email", [7]]]);
  });

  test("the email is in the person's language, with French punctuation", async () => {
    deliveryDb({
      people: [PAUL],
      waiting: { email: rows },
      unread: { "pu-2": [{ message_id: MSG, body: "Le camion est parti", author: "Awa" }] },
    });
    await notify.deliver(null, { tenant: TENANT, clientId: CLIENT, topic: "MESSAGES", thread: "general", stage: "email" });
    expect(mockEmails).toHaveLength(1);
    expect(mockEmails[0].subject).toBe("Acme Logistics vous a écrit");
    expect(mockEmails[0].text).toContain("Awa : Le camion est parti");
    expect(mockEmails[0].text).toContain("https://acme.example/portal?chat=general");
    expect(mockEmails[0].sendPoint).toBe("portal.notify");
  });
});

describe("everything else, batched", () => {
  const rows = [
    { outbox_id: 11, event_key: "invoice.posted", item_ref: `invoice:${INV}` },
    { outbox_id: 12, event_key: "invoice_bundle.published", item_ref: `final_invoice:${INV}` },
  ];

  test("one email and one push per person for the whole batch, to those who handle billing", async () => {
    const { marked } = deliveryDb({ people: [MARIE, PAUL, FIN], waiting: { push: rows, email: rows } });
    await notify.deliver(null, { tenant: TENANT, clientId: CLIENT, topic: "BILLING", thread: null, stage: "both" });
    // Paul has the operations side only.
    expect(mockEmails.map((m) => m.to).sort()).toEqual(["fin@acme.cm", "marie@acme.cm"]);
    expect(mockPushes.map((p) => p.portal_user_id).sort()).toEqual(["pu-1", "pu-3"]);
    const mail = mockEmails[0];
    expect(mail.subject).toBe("Acme Logistics: 2 billing updates");
    expect(mail.text).toContain("New invoice FA-2026-0012, 1,250,000 XAF, due 30/10/2026");
    expect(mail.text).toContain("Invoice FA-2026-0012: 3 supporting documents to download");
    // One invoice: the link opens it.
    expect(mail.text).toContain(`https://acme.example/portal/billing?invoice=${INV}`);
    expect(mail.html).toContain("#0a7d5a");
    expect(mail.html).not.toMatch(/<script/i);
    expect(marked).toEqual([["push", [11, 12]], ["email", [11, 12]]]);
  });

  test("somebody who switched a topic off by email is not emailed about it", async () => {
    deliveryDb({ people: [{ ...MARIE, email_off: ["BILLING"], push_off: [] }], waiting: { push: rows, email: rows } });
    await notify.deliver(null, { tenant: TENANT, clientId: CLIENT, topic: "BILLING", thread: null, stage: "both" });
    expect(mockEmails).toEqual([]);
    expect(mockPushes).toHaveLength(1);
  });

  test("a person already told (a retried job) is not told again", async () => {
    deliveryDb({ people: [MARIE], waiting: { push: rows, email: rows }, claim: () => null });
    await notify.deliver(null, { tenant: TENANT, clientId: CLIENT, topic: "BILLING", thread: null, stage: "both" });
    expect(mockEmails).toEqual([]);
    expect(mockPushes).toEqual([]);
  });

  test("a failed send gives its claim back, leaves the rows waiting and fails the job for a retry", async () => {
    let n = 0;
    const { marked, released } = deliveryDb({
      people: [{ ...MARIE, email: "fails@acme.cm" }],
      waiting: { email: rows },
      claim: () => ++n,
    });
    await expect(
      notify.deliver(null, { tenant: TENANT, clientId: CLIENT, topic: "BILLING", thread: null, stage: "email" }),
    ).rejects.toThrow("SMTP down");
    expect(released).toEqual([1]);
    expect(marked).toEqual([]);
  });

  // Meeting 6, PR 4: a commercial quotation reaches the client exactly as a
  // proposal does — same switch — and opens on its own page in the portal.
  test("a sent quotation is pushed, and opens its page in Quotations", async () => {
    const { marked } = deliveryDb({
      people: [MARIE],
      waiting: { push: [{ outbox_id: 21, event_key: "quotation.sent", item_ref: `quotation:${QUOTE}` }] },
    });
    await notify.deliver(null, { tenant: TENANT, clientId: CLIENT, topic: "PROPOSALS", thread: null, stage: "push" });
    expect(mockPushes).toHaveLength(1);
    expect(mockPushes[0]).toMatchObject({ body: "Quotation QT-2026-0004", url: `/portal/quotations/${QUOTE}`, tag: "proposals:all" });
    expect(marked).toEqual([["push", [21]]]);
  });

  test("nothing still true, nothing sent: an answered proposal is no longer news", async () => {
    const { marked } = deliveryDb({
      people: [MARIE],
      waiting: { push: [{ outbox_id: 20, event_key: "proposal.sent", item_ref: `proposal:${INV}` }] },
    });
    await notify.deliver(null, { tenant: TENANT, clientId: CLIENT, topic: "PROPOSALS", thread: null, stage: "push" });
    expect(mockPushes).toEqual([]);
    expect(marked).toEqual([["push", [20]]]);
  });
});

describe("a device", () => {
  test("must belong to a real push service — the worker POSTs to it", () => {
    expect(isPushService("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushService("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isPushService("https://web.push.apple.com/QGx")).toBe(true);
    expect(isPushService("https://wns2-db5p.notify.windows.com/w/?token=x")).toBe(true);
    expect(isPushService("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isPushService("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isPushService("https://fcm.googleapis.com.evil.example/x")).toBe(false);
    expect(isPushService("https://fcm.googleapis.com:8443/x")).toBe(false);
    const bad = schemas.pushSubscribe.safeParse({
      subscription: { endpoint: "https://internal.local/hook", keys: { p256dh: "a", auth: "b" } },
    });
    expect(bad.success).toBe(false);
  });

  test("settings take the six topics and nothing else", () => {
    expect(schemas.notifySettings.safeParse({ topics: [{ topic: "QUOTES", email: true, push: true }] }).success).toBe(true);
    expect(schemas.notifySettings.safeParse({ topics: [{ topic: "BILLING", email: false, push: true }] }).success).toBe(true);
    expect(schemas.notifySettings.safeParse({ topics: [{ topic: "PAYROLL", email: false, push: true }] }).success).toBe(false);
    expect(schemas.notifySettings.safeParse({ topics: [], client_id: CLIENT }).success).toBe(false);
  });
});


/* ── tenant review 29 Sep 2026, PR 1 (B3, B4, B5) ─────────────────────── */

const QR = "77777777-7777-4777-8777-777777777777";

describe("a quote request made in the portal (B3)", () => {
  test("is read off its row — and only a PORTAL request reaches a client", async () => {
    mockRows = [[/FROM quote_request WHERE quote_request_id/, { rows: [{ client_id: CLIENT }] }]];
    const c = conn("live");
    const out = await producer.onEvent(c, { eventTypeKey: "quote_request.created", entityRef: `quote_request:${QR}`, payload: {} });
    expect(out).toMatchObject({ clientId: CLIENT, topic: "QUOTES", item: `quote_request:${QR}` });
    const read = c.calls.find((x) => /FROM quote_request WHERE quote_request_id/.test(x.sql));
    // A website enquiry is never emailed: anyone can type any address into the public form.
    expect(read.sql).toMatch(/intake_channel = 'PORTAL'/);
  });

  test("a website enquiry — no PORTAL row — records nothing", async () => {
    const c = conn("live");
    expect(await producer.onEvent(c, { eventTypeKey: "quote_request.created", entityRef: `quote_request:${QR}`, payload: {} })).toBeNull();
    expect(inserts(c)).toEqual([]);
  });

  test("the acknowledgement and QUOTED are emailed and pushed; UNDER_REVIEW is a push only", async () => {
    const rows = [
      { outbox_id: 31, event_key: "quote_request.created", item_ref: `quote_request:${QR}` },
      { outbox_id: 32, event_key: "quote_request.under_review", item_ref: `quote_request:${QR}` },
      { outbox_id: 33, event_key: "quote_request.quoted", item_ref: `quote_request:${QR}` },
    ];
    const { marked } = deliveryDb({ people: [MARIE], waiting: { push: rows, email: rows } });
    mockDb.quoteRequests = async () => [{ quote_request_id: QR, public_ref: "SQ-2026-0003", status: "QUOTED" }];
    await notify.deliver(null, { tenant: TENANT, clientId: CLIENT, topic: "QUOTES", thread: null, stage: "both" });
    expect(mockEmails).toHaveLength(1);
    expect(mockEmails[0].text).toContain("We received your request SQ-2026-0003");
    expect(mockEmails[0].text).toContain("Your quotation for SQ-2026-0003 is ready");
    expect(mockEmails[0].text).not.toContain("We are reviewing");
    expect(mockPushes).toHaveLength(1);
    expect(mockPushes[0].url).toBe("/portal/requests");
    // Every row is handled on both channels, the push-only one included.
    expect(marked).toEqual([["push", [31, 32, 33]], ["email", [31, 32, 33]]]);
  });

  test("only UNDER_REVIEW waiting on email: nothing is emailed, the row is still handled", async () => {
    const rows = [{ outbox_id: 41, event_key: "quote_request.under_review", item_ref: `quote_request:${QR}` }];
    const { marked } = deliveryDb({ people: [MARIE], waiting: { email: rows } });
    mockDb.quoteRequests = async () => [{ quote_request_id: QR, public_ref: "SQ-2026-0003", status: "UNDER_REVIEW" }];
    await notify.deliver(null, { tenant: TENANT, clientId: CLIENT, topic: "QUOTES", thread: null, stage: "email" });
    expect(mockEmails).toEqual([]);
    expect(marked).toEqual([["email", [41]]]);
  });
});

const TEAM_MSG = {
  message_id: MSG, client_id: CLIENT, dossier_id: SHIP, direction: "STAFF", body: "The truck left Douala.\n\nETA Bangui Friday.",
  created_at: "2026-09-30T10:00:00Z", client_name: "GOUM", dossier_ref: "PRX-2026-0418", pol: "Douala", pod: "Bangui",
  author_email: "tom@smartls.cm", author_name: "Tom Blake",
  attachments: [{ attachment_id: "a1", kind: "FILE", file_name: "BL.pdf", mime_type: "application/pdf", byte_size: 1200, storage_path: "v/bl.pdf" }],
};
const ELISHA = { email: "elisha@goum.cm", full_name: "Elisha Godwin", scope: "ALL", portal_user_id: "pu-9", status: "ACTIVE", last_login_at: "2026-09-29T08:00:00Z", language: "en" };

describe("Send by email (B4)", () => {
  function sendDb({ people = [ELISHA], claimed = () => 1 } = {}) {
    const released = [];
    Object.assign(mockDb, {
      teamMessage: async () => TEAM_MSG,
      reachList: async () => people,
      clientProfile: async () => ({ name: "GOUM", preferred_language: "en" }),
      claimManual: async (c, a) => claimed(a),
      release: async (c, id) => released.push(id),
      messageOutbox: async () => [],
      threadEmails: async () => [],
      threadCursors: async () => [],
    });
    return { released };
  }

  test("sends one branded email with the sender's signature, the file attached and a reply-to", async () => {
    sendDb();
    const c = conn("live");
    const out = await notify.emailTeamMessage(c, {
      messageId: MSG, recipients: ["Elisha@goum.cm"], requestKey: "k-1", actor: { user_id: "u-tom" }, tenant: TENANT,
    });
    expect(out.emailed).toEqual(["elisha@goum.cm"]);
    expect(mockEmails).toHaveLength(1);
    const mail = mockEmails[0];
    expect(mail.subject).toBe("GOUM · PRX-2026-0418");
    expect(mail.signature).toBe("auto");
    expect(mail.actorUserId).toBe("u-tom");
    expect(mail.replyTo).toBe("tom@smartls.cm");
    expect(mail.attachments).toEqual([expect.objectContaining({ filename: "BL.pdf" })]);
    expect(mail.text).toContain("The truck left Douala.");
    expect(mail.text).toContain("Shipment PRX-2026-0418 · Douala → Bangui");
    expect(mail.text).toContain(`https://acme.example/portal?chat=${SHIP}`);
    expect(mail.html).toContain("#0a7d5a");
    expect(mail.html).not.toMatch(/<script/i);
  });

  test("a double click — the same key, the claim already taken — sends nothing twice", async () => {
    sendDb({ claimed: () => null });
    const out = await notify.emailTeamMessage(conn("live"), {
      messageId: MSG, recipients: ["elisha@goum.cm"], requestKey: "k-1", actor: {}, tenant: TENANT,
    });
    expect(out.already).toEqual(["elisha@goum.cm"]);
    expect(mockEmails).toEqual([]);
  });

  test("reaches someone who has not signed in, never a disabled login or a stranger", async () => {
    sendDb({ people: [{ ...ELISHA, last_login_at: null }, { ...ELISHA, email: "gone@goum.cm", status: "DISABLED" }] });
    const ok = await notify.emailTeamMessage(conn("live"), { messageId: MSG, recipients: ["elisha@goum.cm"], requestKey: "k", actor: {}, tenant: TENANT });
    expect(ok.emailed).toEqual(["elisha@goum.cm"]);
    await expect(notify.emailTeamMessage(conn("live"), { messageId: MSG, recipients: ["gone@goum.cm"], requestKey: "k", actor: {}, tenant: TENANT }))
      .rejects.toMatchObject({ code: "RECIPIENT_NOT_ALLOWED" });
    await expect(notify.emailTeamMessage(conn("live"), { messageId: MSG, recipients: ["someone@else.cm"], requestKey: "k", actor: {}, tenant: TENANT }))
      .rejects.toMatchObject({ code: "RECIPIENT_NOT_ALLOWED" });
  });

  test("never from TEST", async () => {
    sendDb();
    await expect(notify.emailTeamMessage(conn("sandbox"), { messageId: MSG, recipients: ["elisha@goum.cm"], requestKey: "k", actor: {}, tenant: TENANT }))
      .rejects.toMatchObject({ code: "SANDBOX_NO_EMAIL" });
    expect(mockEmails).toEqual([]);
  });

  test("a failed send gives its claim back so the next click can send", async () => {
    const { released } = sendDb({ people: [{ ...ELISHA, email: "fails@acme.cm" }], claimed: () => 5 });
    await expect(notify.emailTeamMessage(conn("live"), { messageId: MSG, recipients: ["fails@acme.cm"], requestKey: "k", actor: {}, tenant: TENANT }))
      .rejects.toMatchObject({ code: "EMAIL_FAILED" });
    expect(released).toEqual([5]);
  });

  test("the shared body is strict: who, and the key that makes it once", () => {
    const { clientPortal } = require("@praxis/shared");
    expect(clientPortal.messageEmail.safeParse({ recipients: ["a@b.cm"], request_key: "00000000-0000-4000-8000-000000000001" }).success).toBe(true);
    expect(clientPortal.messageEmail.safeParse({ recipients: [], request_key: "00000000-0000-4000-8000-000000000001" }).success).toBe(false);
    expect(clientPortal.messageEmail.safeParse({ recipients: ["a@b.cm"] }).success).toBe(false);
  });
});

describe("what each team message's email did (B5)", () => {
  const at = "2026-09-30T10:00:00Z";
  const msg = { message_id: MSG, direction: "STAFF", created_at: at };
  const people = [
    ELISHA,
    { ...ELISHA, email: "paul@goum.cm", full_name: "Paul", portal_user_id: "pu-2" },
    { ...ELISHA, email: "new@goum.cm", full_name: "New", portal_user_id: "pu-3", last_login_at: null },
    { ...ELISHA, email: "off@goum.cm", full_name: "Off", portal_user_id: "pu-4", email_off: ["MESSAGES"] },
    { ...ELISHA, email: "late@goum.cm", full_name: "Late", portal_user_id: "pu-5" },
  ];

  test("emailed, read in the portal, never signed in, switched off — read from what the sender recorded", async () => {
    Object.assign(mockDb, {
      reachList: async () => people,
      messageOutbox: async () => [{ outbox_id: 70, item_ref: `client_message:${MSG}`, created_at: at, email_done_at: "2026-09-30T10:12:00Z" }],
      threadEmails: async () => [
        { email: "elisha@goum.cm", dedupe_key: `email:MESSAGES:${SHIP}:70`, sent_at: "2026-09-30T10:12:00Z", message_id: null },
      ],
      threadCursors: async () => [{ portal_user_id: "pu-2", last_read_at: "2026-09-30T10:03:00Z" }],
    });
    const out = await notify.messageDelivery(null, { clientId: CLIENT, thread: SHIP, messages: [msg] });
    const state = Object.fromEntries(out[MSG].map((p) => [p.email, p.state]));
    expect(state).toEqual({
      "elisha@goum.cm": "EMAILED",
      "paul@goum.cm": "READ",
      "new@goum.cm": "NEVER_SIGNED_IN",
      "off@goum.cm": "SWITCHED_OFF",
      "late@goum.cm": "NOT_EMAILED",
    });
  });

  test("a deliberate send says who sent it; an email pass not run yet is on its way", async () => {
    Object.assign(mockDb, {
      reachList: async () => [ELISHA, { ...ELISHA, email: "paul@goum.cm", portal_user_id: "pu-2" }],
      messageOutbox: async () => [{ outbox_id: 71, item_ref: `client_message:${MSG}`, created_at: new Date().toISOString(), email_done_at: null }],
      threadEmails: async () => [
        { email: "elisha@goum.cm", dedupe_key: `manual:${MSG}:k`, sent_at: "2026-09-30T10:42:00Z", message_id: MSG, sent_by_name: "Tom Blake" },
      ],
      threadCursors: async () => [],
    });
    const out = await notify.messageDelivery(null, { clientId: CLIENT, thread: SHIP, messages: [{ ...msg, created_at: new Date(Date.now() - 60_000).toISOString() }] });
    expect(out[MSG][0]).toMatchObject({ state: "EMAILED", manual: true, by: "Tom Blake" });
    expect(out[MSG][1]).toMatchObject({ state: "PENDING" });
  });
});
