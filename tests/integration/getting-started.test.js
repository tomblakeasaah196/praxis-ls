"use strict";

/**
 * Meeting 6, PR 3 — Definition of done #10 (register 3.9), against a real
 * tenant: a LIVE workspace with no operations file sees the go-live
 * checklist, each item with its live state and its screen; the first file
 * makes it disappear; TEST never shows it.
 *
 * Everything runs inside one transaction that is rolled back, so the file it
 * opens never outlives the test. Self-skips without DATABASE_URL.
 */

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("Getting started on an empty LIVE (meeting 6, 3.9)", () => {
  let pool;
  let c;
  const service = () => require("../../src/modules/dashboard/dashboard/dashboard.service");

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    c = await pool.connect();
    await c.query("BEGIN");
  });
  afterAll(async () => {
    if (c) {
      await c.query("ROLLBACK");
      c.release();
    }
    if (pool) await pool.end();
  });

  test("LIVE with no operations file: the six steps, each with its state and its screen", async () => {
    const { rows: [{ n }] } = await c.query("SELECT count(*)::int AS n FROM dossier_visible");
    const g = await service().gettingStarted(c);
    if (n > 0) {
      // Another suite left a file in this tenant: then it is not empty, and
      // the checklist is rightly absent. CI provisions a fresh tenant.
      expect(g.show).toBe(false);
      return;
    }
    expect(g.show).toBe(true);
    expect(g.env).toBe("live");
    expect(g.items.map((i) => [i.key, i.label, i.to])).toEqual([
      ["client", "Create a client", "/master/clients"],
      ["portal", "Invite them to the portal", "/settings/portal-access"],
      ["file", "Open the first operations file", "/operations/files"],
      ["treasury", "Set the treasury accounts", "/master/treasury-accounts"],
      ["mailbox", "Connect the mailbox", "/comms/setup"],
      ["team", "Invite the team", "/security/users"],
    ]);
    expect(g.items.find((i) => i.key === "file").done).toBe(false);
    for (const i of g.items) expect(typeof i.done).toBe("boolean");
  });

  test("an item's state is read from the data: a client ticks 'Create a client'", async () => {
    const before = (await service().gettingStarted(c)).items.find((i) => i.key === "client");
    await c.query("INSERT INTO client_master (name) VALUES ('Getting Started Test Client')");
    const after = (await service().gettingStarted(c)).items.find((i) => i.key === "client");
    expect(after.done).toBe(true);
    expect(after.count).toBe(before.count + 1);
  });

  test("the first operations file makes it disappear", async () => {
    const { rows: [cl] } = await c.query("SELECT client_id FROM client_master WHERE name = 'Getting Started Test Client'");
    await c.query("INSERT INTO dossier (ref, client_id, status) VALUES ('GS-1', $1, 'OPEN')", [cl.client_id]);
    expect(await service().gettingStarted(c)).toEqual({ show: false, env: "live", items: [] });
  });

  test("TEST never shows it", async () => {
    await c.query("SET LOCAL search_path = sandbox, public");
    expect((await c.query("SELECT count(*)::int AS n FROM dossier_visible")).rows[0].n).toBe(0);
    expect(await service().gettingStarted(c)).toEqual({ show: false, env: "sandbox", items: [] });
  });
});
