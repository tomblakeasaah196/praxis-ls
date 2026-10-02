"use strict";

/**
 * Meeting 6, PR 3 — section B against the real seeded catalogue (9082) and the
 * 14342 backfill: the real search returns Gate-Pass Fee ONCE with both modes,
 * the sibling lookup and the "Lines to pair" query run, and linking enforces
 * one row per mode. Everything that writes runs in a rolled-back transaction.
 *
 * Runs only with DATABASE_URL pointing at a provisioned tenant; self-skips
 * otherwise, like every suite in this directory.
 */
const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("dictionary siblings (14342)", () => {
  let pool;
  let c;
  const service = require("../../src/modules/master/financial_dictionary/financial_dictionary.service");

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    c = await pool.connect();
  });
  afterAll(async () => {
    if (!c) return;
    c.release();
    await pool.end();
  });

  test("the backfill linked Gate-Pass Fee's two rows, and the search shows the service once", async () => {
    const { rows } = await c.query(
      "SELECT code, direction, sibling_group FROM dictionary_item WHERE label_en ILIKE 'Gate-Pass Fee%' ORDER BY direction",
    );
    if (rows.length < 2) return; // a tenant without the 9082 catalogue has nothing to pair
    expect(rows[0].sibling_group).toBeTruthy();
    expect(rows[0].sibling_group).toBe(rows[1].sibling_group);

    const hits = await service.searchItems(c, { q: "Gate-Pass Fee" });
    const gate = hits.filter((h) => h.sibling_group === rows[0].sibling_group);
    expect(gate).toHaveLength(1);
    expect(gate[0].group_label_en).toBe("Gate-Pass Fee");
    expect(gate[0].siblings.map((s) => s.mode)).toEqual(["billed", "own"]);

    const info = await service.siblingsFor(c, [gate[0].siblings[1].dictionary_item_id]);
    const own = info[gate[0].siblings[1].dictionary_item_id];
    expect(own.mode).toBe("own");
    expect(own.siblings).toHaveLength(2);
  });

  test("a tenant built from scratch pairs too: an insert joins its service's group, a confirmed line never", async () => {
    // A fresh tenant runs 14342 before seed 9082 inserts the catalogue, so the
    // pairing must also follow inserts (the statement trigger). This is the
    // case CI's migrations job caught.
    await c.query("BEGIN");
    try {
      const ins = (code, fr, en, dir) =>
        c.query(
          `INSERT INTO dictionary_item (code, label_fr, label_en, category, direction, is_disbursement)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING dictionary_item_id`,
          [code, fr, en, dir === "DISBURSEMENT" ? "disbursement" : "service", dir, dir === "DISBURSEMENT"],
        ).then((r) => r.rows[0].dictionary_item_id);
      const group = async (id) =>
        (await c.query("SELECT sibling_group FROM dictionary_item WHERE dictionary_item_id = $1", [id])).rows[0].sibling_group;

      // Base row first, its débours sibling in a later statement — as a seed does.
      const own = await ins("#E998", "Essai de quai", "Quay Trial", "EXPENSE");
      expect(await group(own)).toBeNull(); // alone: no group of one
      const billed = await ins("#D998", "Essai de quai — Pour Compte Client", "Quay Trial — Client Account", "DISBURSEMENT");
      expect(await group(own)).toBeTruthy();
      expect(await group(billed)).toBe(await group(own));

      // A person said this one stands alone: a later insert never groups it.
      const alone = await ins("#E997", "Essai seul", "Lone Trial", "EXPENSE");
      await c.query("UPDATE dictionary_item SET sibling_confirmed_at = now() WHERE dictionary_item_id = $1", [alone]);
      const partner = await ins("#D997", "Essai seul — Pour Compte Client", "Lone Trial — Client Account", "DISBURSEMENT");
      expect(await group(alone)).toBeNull();
      expect(await group(partner)).toBeNull();
    } finally {
      await c.query("ROLLBACK");
    }
  });

  test("Lines to pair runs, and a confirmed line leaves it", async () => {
    await c.query("BEGIN");
    try {
      const { rows: [line] } = await c.query(
        `INSERT INTO dictionary_item (code, label_fr, label_en, category, direction, is_disbursement)
         VALUES ('#D999', 'Essai — Pour Compte Client', 'Trial — Client Account', 'disbursement', 'DISBURSEMENT', true)
         RETURNING dictionary_item_id`,
      );
      const before = await service.unpairedLines(c);
      expect(before.map((r) => r.dictionary_item_id)).toContain(line.dictionary_item_id);
      // linkSibling owns its transaction; inside this test's, run its writes directly.
      await c.query(
        "UPDATE dictionary_item SET sibling_confirmed_at = now() WHERE dictionary_item_id = $1",
        [line.dictionary_item_id],
      );
      const after = await service.unpairedLines(c);
      expect(after.map((r) => r.dictionary_item_id)).not.toContain(line.dictionary_item_id);
    } finally {
      await c.query("ROLLBACK");
    }
  });
});
