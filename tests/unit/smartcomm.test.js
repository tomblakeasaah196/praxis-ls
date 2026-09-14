"use strict";
const service = require("../../src/modules/smartcomm/smartcomm.service");

// Fake client: findMember (SELECT * FROM comms_member) drives membership.
function makeClient({ member = null }) {
  return {
    query: async (sql) => {
      if (/FROM comms_member WHERE group_id/.test(sql))
        return { rows: member ? [member] : [] };
      return { rows: [] };
    },
  };
}
const actor = { user_id: "u1" };

describe("Smart Comms authorization + guards (MOD-64)", () => {
  test("non-member cannot post", async () => {
    await expect(
      service.postMessage(makeClient({ member: null }), {
        groupId: "g1",
        body: "hi",
        actor,
      }),
    ).rejects.toThrow(/not a member/i);
  });
  test("member cannot post an empty message", async () => {
    await expect(
      service.postMessage(
        makeClient({ member: { group_id: "g1", user_id: "u1" } }),
        { groupId: "g1", actor },
      ),
    ).rejects.toThrow(/needs a body or media/i);
  });
  test("non-member cannot read a thread", async () => {
    await expect(
      service.thread(makeClient({ member: null }), { groupId: "g1", actor }),
    ).rejects.toThrow(/not a member/i);
  });
  test("search rejects too-short terms", async () => {
    await expect(
      service.search(makeClient({ member: {} }), { actor, term: "a" }),
    ).rejects.toThrow(/too short/i);
  });
});

describe("Smart Comms channel description (comms_group.topic)", () => {
  // Captures every statement after the membership assert, so the test can see
  // exactly what the PATCH writes (and that a no-op writes nothing).
  function recordingClient() {
    const calls = [];
    return {
      calls,
      client: {
        query: async (sql, params) => {
          if (/FROM comms_member WHERE group_id/.test(sql))
            return { rows: [{ group_id: "g1", user_id: "u1" }] };
          calls.push([sql, params]);
          return { rows: [{ group_id: "g1" }] };
        },
      },
    };
  }

  test("non-member cannot edit the About text", async () => {
    await expect(
      service.updateChannel(makeClient({ member: null }), {
        id: "g1",
        data: { topic: "hello" },
        actor,
      }),
    ).rejects.toThrow(/not a member/i);
  });

  test("member sets the topic trimmed, and whitespace clears it", async () => {
    const rec = recordingClient();
    await service.updateChannel(rec.client, {
      id: "g1",
      data: { topic: "  Douala corridor standups  " },
      actor,
    });
    expect(rec.calls).toEqual([
      [
        'UPDATE comms_group SET "topic" = $2, "updated_at" = now() WHERE "group_id" = $1 RETURNING *',
        ["g1", "Douala corridor standups"],
      ],
    ]);
    rec.calls.length = 0;
    await service.updateChannel(rec.client, {
      id: "g1",
      data: { topic: "   " },
      actor,
    });
    expect(rec.calls[0][1]).toEqual(["g1", null]);
  });

  test("a patch with nothing to change issues no UPDATE", async () => {
    const rec = recordingClient();
    await service.updateChannel(rec.client, { id: "g1", data: {}, actor });
    expect(rec.calls.filter(([sql]) => sql.startsWith("UPDATE"))).toEqual([]);
  });
});
