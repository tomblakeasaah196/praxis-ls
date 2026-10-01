"use strict";

/**
 * Meeting 6, PR 3 — DoD #5, the review and the import, on a real tenant:
 *
 *   - the review job lists the lines whose posting differs from the suggestion
 *     and changes NOTHING (every posting_rule is byte-identical afterwards);
 *     a second pass over the same run resumes and examines nothing again;
 *   - an import row without a posting gets a suggestion at validate time, is
 *     refused at commit until the person accepts it, and is created with the
 *     accepted posting when they do.
 *
 * The engine is faked so the run is deterministic and free; its own behaviour
 * is pinned in dictionary-posting.test.js. Self-skips without DATABASE_URL.
 */
jest.mock("../../src/services/ai/dictionary-posting/engine.service", () => ({
  suggest: jest.fn(async (_c, q) => {
    const disb = q.direction === "DISBURSEMENT";
    return {
      source: "cache",
      model: "gemini-3.1-pro",
      cache_entry_id: null,
      direction: q.direction || "EXPENSE",
      is_disbursement: disb,
      vat_treatment: disb ? "DISBURSEMENT" : "STANDARD",
      generic: [],
      rules: disb
        ? [
            { applies_context: "purchase", debit_account: "4731", credit_account: "4011", tax_code_id: null, is_disbursement: true, mapping: { debit: { how: "exact" }, credit: { how: "exact" } } },
            { applies_context: "sale", debit_account: "4111", credit_account: "4731", tax_code_id: null, is_disbursement: true, mapping: { debit: { how: "exact" }, credit: { how: "exact" } } },
          ]
        : [{ applies_context: "purchase", debit_account: "6131", credit_account: "4011", tax_code_id: null, is_disbursement: false, mapping: { debit: { how: "exact" }, credit: { how: "exact" } } }],
      confidence: "high",
      check_needed: false,
      rationale: "test",
      sources: [],
      search_suggestion_html: null,
      fallback_reason: null,
    };
  }),
}));

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("dictionary posting — review and import (14343)", () => {
  let pool;
  let c;
  const service = require("../../src/modules/master/financial_dictionary/financial_dictionary.service");

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    c = await pool.connect();
  });
  afterAll(async () => {
    if (c) c.release();
    if (pool) await pool.end();
  });

  test("the review lists differences, changes nothing, and resumes", async () => {
    await c.query("BEGIN");
    try {
      const snapshot = async () =>
        (await c.query("SELECT md5(string_agg(posting_rule::text, ',' ORDER BY posting_rule::text)) AS h FROM posting_rule")).rows[0].h;
      const before = await snapshot();
      const { rows: [review] } = await c.query(
        "INSERT INTO dictionary_posting_review (total) VALUES ((SELECT count(*) FROM dictionary_item WHERE is_active)) RETURNING *",
      );
      const done = await service.runReview(c, review.review_id);
      expect(done.status).toBe("done");
      expect(done.examined).toBe(done.total);
      expect(await snapshot()).toBe(before);

      const out = await service.latestReview(c);
      const mismatches = out.lines.filter((l) => l.outcome === "mismatch");
      expect(done.mismatches).toBe(mismatches.length);
      // The fake says every EXPENSE line posts to 6131: the seeded ones that
      // do not are listed, with the reason in one line.
      const other = mismatches.find((l) => l.direction === "EXPENSE");
      if (other) expect(other.reasons.join(" ")).toMatch(/6131 suggested/);

      // Resumes: a second pass over the same run examines nothing again.
      const engine = require("../../src/services/ai/dictionary-posting/engine.service");
      engine.suggest.mockClear();
      await c.query("UPDATE dictionary_posting_review SET status = 'running' WHERE review_id = $1", [review.review_id]);
      await service.runReview(c, review.review_id);
      expect(engine.suggest).not.toHaveBeenCalled();
    } finally {
      await c.query("ROLLBACK");
    }
  });

  test("an import row without a posting is accepted only with the person's acceptance", async () => {
    const label = `Pr3 Import Row ${Date.now()}`;
    const raw = { label_fr: label, category: "overhead", direction: "EXPENSE", applicability_mode: "ANY_OPERATIONS" };
    const refused = await service.importCommit(c, { rows: [{ row: 2, raw }], actor: { user_id: null } });
    expect(refused.created).toHaveLength(0);
    expect(refused.rejected[0].reasons[0]).toMatch(/accept the AI-suggested posting/);

    const accepted = await service.importCommit(c, {
      rows: [{
        row: 2,
        raw,
        accept_posting: {
          rules: [{ applies_context: "purchase", debit_account: "6131", credit_account: "4011" }],
          provenance: { source: "cache", model: "gemini-3.1-pro", confidence: "high", direction: "EXPENSE", suggested_rules: [{ applies_context: "purchase", debit_account: "6131", credit_account: "4011" }] },
        },
      }],
      actor: { user_id: null },
    });
    try {
      expect(accepted.created).toHaveLength(1);
      const rules = (await c.query("SELECT applies_context, debit_account, credit_account FROM posting_rule WHERE dictionary_item_id = $1", [accepted.created[0].dictionary_item_id])).rows;
      expect(rules).toEqual([{ applies_context: "purchase", debit_account: "6131", credit_account: "4011" }]);
    } finally {
      if (accepted.created[0]) await c.query("DELETE FROM dictionary_item WHERE dictionary_item_id = $1", [accepted.created[0].dictionary_item_id]);
    }
  });
});
