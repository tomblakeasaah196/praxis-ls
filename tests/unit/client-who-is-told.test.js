"use strict";

/**
 * Tenant review of 29 Sep 2026, PR 1 — section B (register 1.4, 1.5, 1.13;
 * owner decisions D3, D7):
 *
 *   1. ONE list per client: account manager + "Also notify" + CEO-role users;
 *      the Client inbox team only when no reachable account manager is named.
 *   2. A document, a payment claim and a quote request each reach exactly that
 *      list under "Client activity" (email ON by default, opt-out), with one
 *      email per person per conversation per 15 minutes — and the module
 *      broadcast leaves them out, so one upload is one bell per person.
 *   3. A website prospect's quote request: the quote-request editors in-app,
 *      the CEO-role users by email — and ONE alert, not a second "New lead".
 *   4. "Also notify" takes active logins only, and is audited.
 *   5. The email window: the first notification in it emails, the rest keep
 *      their bell and push.
 */

let mockNotifyMany = [];
let mockNotify = [];
let mockHolders = {};
let mockAudits = [];

jest.mock("../../src/modules/notification/notification.service", () => ({
  notifyMany: async (c, ids, n) => {
    mockNotifyMany.push({ ids: [...ids], ...n });
    return ids.length;
  },
  notify: async (c, n) => {
    mockNotify.push(n);
    return { notification_id: "n" };
  },
}));
jest.mock("../../src/modules/notification/notification.repo", () => ({
  recipientsWithPermission: async (c, moduleKey, action) => mockHolders[`${moduleKey}:${action}`] || [],
}));
jest.mock("../../src/shared/events/emit", () => ({
  audit: async (c, a) => {
    mockAudits.push(a);
  },
  resolveActorId: async (c, id) => id || null,
}));

const accountManager = require("../../src/modules/master/client_master/account_manager.service");
const clientTeam = require("../../src/shared/notifications/notify-client-team");
const events = require("../../src/shared/notifications/notify-events");

const CLIENT = "22222222-2222-4222-8222-222222222222";
const QR = "77777777-7777-4777-8777-777777777777";
const LEAD = "88888888-8888-4888-8888-888888888888";

/** A connection answering by SQL pattern; records what it was asked. */
function conn(routes) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      for (const [re, answer] of routes) {
        if (re.test(sql)) return typeof answer === "function" ? answer(sql, params) : answer;
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

const AUDIENCE = (rows) => [/SELECT 'manager' AS why/, { rows }];
const COMPANY = [/FROM client_master WHERE client_id = \$1/, { rows: [{ name: "GOUM International" }] }];

const notificationRepo = require("../../src/modules/notification/notification.repo");
const byHolders = async (c, moduleKey, action) => mockHolders[`${moduleKey}:${action}`] || [];

beforeEach(() => {
  mockNotifyMany = [];
  mockNotify = [];
  mockHolders = {};
  mockAudits = [];
  notificationRepo.recipientsWithPermission = byHolders;
});

describe("the one list (D7)", () => {
  test("account manager + also notify + CEO-role users; the inbox is not asked while someone looks after the client", async () => {
    const c = conn([AUDIENCE([
      { why: "manager", user_id: "am-1" }, { why: "also", user_id: "paul-1" }, { why: "also", user_id: "am-1" },
      { why: "ceo", user_id: "ceo-1" }, { why: "ceo", user_id: "jbs-1" },
    ])]);
    mockHolders["MOD-64C:edit"] = ["inbox-1"];
    const list = await accountManager.audience(c, { clientId: CLIENT });
    expect(list.manager).toEqual(["am-1"]);
    expect(list.also).toEqual(["paul-1", "am-1"]);
    expect(list.inbox).toEqual([]);
    expect(list.all.sort()).toEqual(["am-1", "ceo-1", "jbs-1", "paul-1"]);
    // Only ACTIVE logins are ever read: someone who left drops out on their own.
    expect(c.calls[0].sql.match(/status = 'ACTIVE'/g)).toHaveLength(3);
  });

  test("no reachable account manager → the Client inbox team as well", async () => {
    const c = conn([AUDIENCE([{ why: "ceo", user_id: "ceo-1" }])]);
    mockHolders["MOD-64C:edit"] = ["inbox-1", "inbox-2"];
    const list = await accountManager.audience(c, { clientId: CLIENT });
    expect(list.inbox).toEqual(["inbox-1", "inbox-2"]);
    expect(list.all.sort()).toEqual(["ceo-1", "inbox-1", "inbox-2"]);
  });
});

describe("Also notify", () => {
  const read = [/FROM client_master cm\s+LEFT JOIN app_user u ON u.user_id = cm.relationship_manager_user_id/, { rows: [{ client_id: CLIENT, client_name: "GOUM International" }] }];

  test("takes active logins only", async () => {
    const c = conn([read, [/FROM app_user WHERE user_id = ANY/, { rows: [{ user_id: "u-1" }] }]]);
    await expect(accountManager.setAlsoNotify(c, { clientId: CLIENT, userIds: ["u-1", "u-left"] }))
      .rejects.toMatchObject({ code: "ALSO_NOTIFY_INACTIVE" });
  });

  test("writes the change with its audit row and tells the people added", async () => {
    const c = conn([
      read,
      [/FROM app_user WHERE user_id = ANY/, { rows: [{ user_id: "u-1" }] }],
      [/FROM client_notify_person n/, { rows: [] }],
    ]);
    await accountManager.setAlsoNotify(c, { clientId: CLIENT, userIds: ["u-1"], actor: { user_id: "u-boss" } });
    expect(c.calls.some((x) => /INSERT INTO client_notify_person/.test(x.sql))).toBe(true);
    expect(mockAudits.map((a) => a.action)).toContain("client.also_notify_set");
    expect(mockNotify).toEqual([expect.objectContaining({ userId: "u-1", category: "clients" })]);
  });

  test("is one shared shape on both sides", () => {
    const { clientMaster } = require("@praxis/shared");
    expect(clientMaster.alsoNotify.safeParse({ user_ids: ["00000000-0000-4000-8000-000000000001"] }).success).toBe(true);
    expect(clientMaster.alsoNotify.safeParse({ user_ids: ["x"] }).success).toBe(false);
    expect(clientMaster.create.safeParse({ name: "GOUM", also_notify_user_ids: ["00000000-0000-4000-8000-000000000001"] }).success).toBe(true);
  });
});

describe("client activity reaches the client's list (D3)", () => {
  const LIST = AUDIENCE([{ why: "manager", user_id: "am-1" }, { why: "also", user_id: "paul-1" }, { why: "ceo", user_id: "ceo-1" }]);

  test("a document: the list, under Client activity, one email per conversation per 15 minutes", async () => {
    const c = conn([LIST, COMPANY]);
    const told = await clientTeam.onEvent(c, {
      eventTypeKey: "client_request.submitted", entityRef: "client_request:x",
      payload: { client_id: CLIENT, kind: "DOCUMENT", by: { name: "Elisha Godwin", email: "elisha@goum.cm" } },
    });
    expect(told.sort()).toEqual(["am-1", "ceo-1", "paul-1"]);
    expect(mockNotifyMany).toHaveLength(1);
    expect(mockNotifyMany[0]).toMatchObject({
      category: "clients",
      title: "GOUM International sent a document",
      emailOnceEvery: { key: `client:${CLIENT}:documents`, seconds: 900 },
    });
    expect(mockNotifyMany[0].body).toContain("Elisha Godwin");
  });

  test("a payment claim: the same list, HIGH", async () => {
    const c = conn([LIST, COMPANY]);
    await clientTeam.onEvent(c, { eventTypeKey: "payment_proof.submitted", entityRef: "payment_proof:x", payload: { client_id: CLIENT, amount: 250000, currency: "XAF" } });
    expect(mockNotifyMany[0]).toMatchObject({ category: "clients", priority: "HIGH", title: "GOUM International reported a payment" });
  });

  test("the module broadcast leaves out whoever the list already told", async () => {
    const c = conn([LIST, COMPANY, [/SELECT DISTINCT u.user_id/, { rows: [] }]]);
    mockHolders["MOD-29:view"] = ["am-1", "ops-1"];
    await events.onEvent(c, {
      eventTypeKey: "client_request.submitted", moduleKey: "MOD-29", entityRef: "client_request:x", payload: { client_id: CLIENT },
    });
    const broadcast = mockNotifyMany.find((n) => n.category !== "clients");
    expect(broadcast.ids).toEqual(["ops-1"]);
  });

  test("a quote request linked to a client: that client's list", async () => {
    const c = conn([
      [/FROM quote_request WHERE quote_request_id/, { rows: [{ quote_request_id: QR, client_id: CLIENT, intake_channel: "PORTAL", public_ref: "SQ-2026-0003" }] }],
      LIST, COMPANY,
    ]);
    const told = await clientTeam.onEvent(c, { eventTypeKey: "quote_request.created", entityRef: `quote_request:${QR}`, payload: {} });
    expect(told.sort()).toEqual(["am-1", "ceo-1", "paul-1"]);
    expect(mockNotifyMany[0]).toMatchObject({ category: "clients", title: "GOUM International asked for a quote" });
    expect(mockNotifyMany[0].body).toContain("SQ-2026-0003");
  });
});

describe("a website prospect's quote request (B3)", () => {
  test("quote-request editors in-app, the CEO-role users by email", async () => {
    mockHolders["MOD-20:edit"] = ["sales-1", "ceo-1"];
    const c = conn([
      [/FROM quote_request WHERE quote_request_id/, { rows: [{ quote_request_id: QR, client_id: null, intake_channel: "WEBSITE", public_ref: "SQ-2026-0004", requester_company: "Bois du Sud" }] }],
      [/WHERE r.code = 'CEO'/, { rows: [{ user_id: "ceo-1" }] }],
    ]);
    const told = await clientTeam.onEvent(c, { eventTypeKey: "quote_request.created", entityRef: `quote_request:${QR}`, payload: {} });
    expect(told.sort()).toEqual(["ceo-1", "sales-1"]);
    const ceo = mockNotifyMany.find((n) => n.ids.includes("ceo-1"));
    const sales = mockNotifyMany.find((n) => n.ids.includes("sales-1"));
    // "Client activity" emails by default; the editors keep their own sales preferences.
    expect(ceo.category).toBe("clients");
    expect(sales.category).toBe("sales");
    expect(sales.ids).not.toContain("ceo-1");
  });

  test("a request staff keyed in themselves, with no client, tells nobody", async () => {
    const c = conn([[/FROM quote_request WHERE quote_request_id/, { rows: [{ quote_request_id: QR, client_id: null, intake_channel: "MANUAL" }] }]]);
    expect(await clientTeam.onEvent(c, { eventTypeKey: "quote_request.created", entityRef: `quote_request:${QR}`, payload: {} })).toEqual([]);
    expect(mockNotifyMany).toEqual([]);
  });

  test("ONE alert: the website lead created with it raises no second \"New lead\"", async () => {
    const c = conn([[/FROM lead WHERE lead_id/, { rows: [{ intake_channel: "WEBSITE" }] }]]);
    expect(await events.onEvent(c, { eventTypeKey: "lead.created", moduleKey: "MOD-20", entityRef: `lead:${LEAD}`, payload: {} })).toBe(0);
    expect(mockNotifyMany).toEqual([]);
  });

  test("a lead keyed in by hand still raises \"New lead\"", async () => {
    mockHolders["MOD-20:view"] = ["sales-1"];
    const c = conn([[/FROM lead WHERE lead_id/, { rows: [{ intake_channel: "MANUAL" }] }]]);
    await events.onEvent(c, { eventTypeKey: "lead.created", moduleKey: "MOD-20", entityRef: `lead:${LEAD}`, payload: {} });
    expect(mockNotifyMany).toEqual([expect.objectContaining({ title: "New lead", ids: ["sales-1"] })]);
  });
});

describe("the email window", () => {
  test("the first notification in the window emails; the rest keep their bell and push", async () => {
    const svc = jest.requireActual("../../src/modules/notification/notification.service");
    expect(await svc.claimEmailWindow("client:c:documents:u", 900)).toBe(true);
    expect(await svc.claimEmailWindow("client:c:documents:u", 900)).toBe(false);
    // Another person, or another conversation, has its own window.
    expect(await svc.claimEmailWindow("client:c:documents:v", 900)).toBe(true);
    expect(await svc.claimEmailWindow("client:c:payments:u", 900)).toBe(true);
  });
});
