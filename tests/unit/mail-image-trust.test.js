"use strict";

/**
 * Whose remote images load without asking (§5.6.3, owner decision 15 Oct 2026).
 */
const trust = require("../../src/modules/mail/mail/image-trust.service");

const NONE = { mine: new Set(), parties: new Set(), own: new Set() };
const msg = (over = {}) => ({ direction: "IN", from_address: "someone@stranger.example", auth_verdict: "UNVERIFIED", ...over });

describe("decide", () => {
  test("a stranger is held back", () => {
    expect(trust.decide(msg(), NONE)).toEqual({ trusted: false, reason: null });
  });

  test("a sender this reader trusted, matched without regard to case", () => {
    const found = { ...NONE, mine: new Set(["lola@beautiful-fabrics.com"]) };
    expect(trust.decide(msg({ from_address: "Lola@Beautiful-Fabrics.com" }), found)).toEqual({ trusted: true, reason: "sender" });
  });

  test("a client, supplier or employee in master data", () => {
    const found = { ...NONE, parties: new Set(["ops@maersk.cm"]) };
    expect(trust.decide(msg({ from_address: "ops@maersk.cm" }), found).reason).toBe("party");
  });

  test("our own mailbox domain", () => {
    const found = { ...NONE, own: new Set(["smart-ls.com"]) };
    expect(trust.decide(msg({ from_address: "marie@smart-ls.com" }), found).reason).toBe("own_domain");
  });

  test("anything we sent", () => {
    expect(trust.decide(msg({ direction: "OUT" }), NONE)).toEqual({ trusted: true, reason: "sent" });
  });

  test.each(["SUSPICIOUS", "LIKELY_IMPERSONATION"])(
    "a %s verdict overrides every list: the From line is what a spoofer controls",
    (verdict) => {
      const found = { mine: new Set(["ops@maersk.cm"]), parties: new Set(["ops@maersk.cm"]), own: new Set(["maersk.cm"]) };
      expect(trust.decide(msg({ from_address: "ops@maersk.cm", auth_verdict: verdict }), found))
        .toEqual({ trusted: false, reason: "held" });
    },
  );

  test("consumer domains can never be 'our own'", () => {
    for (const d of ["gmail.com", "yahoo.fr", "outlook.com", "orange.fr"]) expect(trust.CONSUMER.has(d)).toBe(true);
  });
});

describe("annotate", () => {
  const thread = () => ({
    email_thread_id: "t1",
    messages: [
      msg({ from_address: "ops@maersk.cm" }),
      msg({ from_address: "a@gmail.com" }),
      msg({ from_address: "me@smart-ls.com" }),
      msg({ direction: "OUT", from_address: "me@smart-ls.com" }),
    ],
  });

  test("stamps every message from three batched lookups, never one per message", async () => {
    const client = {
      query: jest.fn(async (sql) => {
        if (/FROM email_image_trust/.test(sql)) return { rows: [] };
        if (/client_master/.test(sql)) return { rows: [{ address: "ops@maersk.cm" }] };
        if (/FROM email_connection/.test(sql)) return { rows: [{ domain: "smart-ls.com" }, { domain: "gmail.com" }] };
        return { rows: [] };
      }),
    };
    const out = await trust.annotate(client, { user_id: "u1" }, thread());
    expect(out.messages.map((m) => m.image_trust.reason)).toEqual(["party", null, "own_domain", "sent"]);
    expect(client.query).toHaveBeenCalledTimes(3);
  });

  test("a lookup failure costs the images, never the conversation", async () => {
    const client = { query: jest.fn(async () => { throw new Error("relation does not exist"); }) };
    const out = await trust.annotate(client, { user_id: "u1" }, thread());
    expect(out.messages.slice(0, 3).every((m) => m.image_trust.trusted === false)).toBe(true);
    expect(out.messages[3].image_trust.reason).toBe("sent");
  });
});

describe("the list", () => {
  test("add lowercases, so one sender is one row", async () => {
    const client = { query: jest.fn(async (_sql, params) => ({ rows: [{ sender_address: params[1] }] })) };
    const row = await trust.add(client, { user_id: "u1" }, { sender: " Lola@Beautiful-Fabrics.COM " });
    expect(row.sender_address).toBe("lola@beautiful-fabrics.com");
  });

  test("remove is scoped to the caller: someone else's id is a 404", async () => {
    const client = { query: jest.fn(async (sql, params) => ({ rowCount: params[1] === "u1" ? 0 : 1 })) };
    await expect(trust.remove(client, { user_id: "u1" }, "other-users-row")).rejects.toMatchObject({ status: 404 });
    expect(client.query.mock.calls[0][0]).toMatch(/AND user_id = \$2/);
  });
});
