"use strict";
/**
 * Calls audit D9: the channel list read ran three correlated subqueries per
 * channel row for the DIRECT partner (id, avatar, last seen). It is one
 * lateral join now; the real-schema half is
 * tests/integration/smartcomm-channel-partner.test.js.
 */
const repo = require("../../src/modules/smartcomm/smartcomm.repo");

test("the DIRECT partner comes from one lateral join", async () => {
  let sql = "";
  await repo.listChannelsForUser({ query: async (s) => { sql = s; return { rows: [] }; } }, "u1", {});
  expect(sql.match(/LEFT JOIN LATERAL/g)).toHaveLength(1);
  expect(sql).not.toMatch(/CASE WHEN g\.kind = 'DIRECT' THEN \(SELECT/);
  expect(sql).toMatch(/partner\.user_id AS partner_user_id/);
  expect(sql).toMatch(/partner\.last_seen_at AS partner_last_seen_at/);
});

test("hide my last seen (audit G4) blanks the partner's and the colleague's last seen", async () => {
  let sql = "";
  await repo.listChannelsForUser({ query: async (s) => { sql = s; return { rows: [] }; } }, "u1", {});
  expect(sql).toMatch(/live\.user_preference hp WHERE hp\.user_id = pm\.user_id/);
  expect(sql).toMatch(/hp\.key = 'hide_last_seen'/);
  await repo.listColleagues({ query: async (s) => { sql = s; return { rows: [] }; } }, {});
  expect(sql).toMatch(/hp\.key = 'hide_last_seen'/);
  expect(sql).toMatch(/THEN NULL ELSE p\.last_seen_at END AS last_seen_at/);
});

/*
 * A DIRECT conversation is the OTHER person. `comms_group.name` holds what the
 * one who started it saw, so the one who was messaged read their own name on
 * it. The partner's name now comes from the same join, and one channel read
 * resolves the partner against whoever is LOOKING (it used to take "any
 * member", which could be the viewer's own photo, and no id or name at all).
 */
test("the channel list names the DIRECT partner", async () => {
  let sql = "";
  await repo.listChannelsForUser({ query: async (s) => { sql = s; return { rows: [] }; } }, "u1", {});
  expect(sql).toMatch(/partner\.full_name AS partner_name/);
  expect(sql).toMatch(/SELECT u\.user_id, u\.full_name, u\.avatar_ref/);
});

/** A client that answers each read `getChannelEnriched` makes, by its SQL. */
function channelClient(group, partnerRow) {
  const seen = [];
  return {
    seen,
    query: async (sql, params) => {
      seen.push({ sql, params });
      if (/LEFT JOIN LATERAL/.test(sql)) return { rows: partnerRow ? [partnerRow] : [] };
      if (/COUNT\(\*\)::int AS members/.test(sql)) return { rows: [{ members: 2 }] };
      if (/COUNT\(\*\)::int AS messages/.test(sql)) return { rows: [{ messages: 5 }] };
      if (/FROM comms_message/.test(sql)) return { rows: [] };
      return { rows: [group] };
    },
  };
}

test("one DIRECT channel is read for the person looking: the partner is the OTHER member", async () => {
  const group = { group_id: "g1", kind: "DIRECT", name: "JBS Praxis" };
  const c = channelClient(group, {
    partner_user_id: "joel", partner_name: "Joel Efala", partner_avatar_ref: "avatars/joel.png", partner_last_seen_at: null,
  });
  const out = await repo.getChannelEnriched(c, "g1", "owner");
  expect(out).toMatchObject({
    name: "JBS Praxis", partner_user_id: "joel", partner_name: "Joel Efala", partner_avatar_ref: "avatars/joel.png",
    member_count: 2, message_count: 5,
  });
  const partnerRead = c.seen.find((q) => /LEFT JOIN LATERAL/.test(q.sql));
  // Against the viewer, by the list's own join: never "any member".
  expect(partnerRead.sql).toMatch(/pm\.user_id <> \$1/);
  expect(partnerRead.sql).toMatch(/WHERE g\.group_id = \$2/);
  expect(partnerRead.params).toEqual(["owner", "g1"]);
});

test("a group channel has no partner, and neither does a read with nobody looking", async () => {
  const group = await repo.getChannelEnriched(channelClient({ group_id: "g2", kind: "DEPARTMENT", name: "Ops" }, null), "g2", "owner");
  expect(group).toMatchObject({ partner_user_id: null, partner_name: null, partner_avatar_ref: null });
  const c = channelClient({ group_id: "g1", kind: "DIRECT", name: "JBS Praxis" }, { partner_name: "Somebody" });
  const blind = await repo.getChannelEnriched(c, "g1");
  expect(blind.partner_name).toBeNull();
  expect(c.seen.some((q) => /LEFT JOIN LATERAL/.test(q.sql))).toBe(false);
});
