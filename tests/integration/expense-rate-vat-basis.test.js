"use strict";

/**
 * Meeting 6, PR 3 — Definition of done #6 (register 3.4, owner decision F4),
 * against a real tenant:
 *
 *   - a VAT-inclusive standard rate stores its HT figure and keeps the TTC and
 *     the rate it was divided by beside it;
 *   - a costing priced from it adds VAT once — its TTC is the price typed;
 *   - the flag is refused on a débours, and the open rate is left as it was;
 *   - existing rates whose note says "TTC" are listed for review and not
 *     changed.
 *
 * Runs only with DATABASE_URL pointing at a provisioned tenant; self-skips
 * otherwise.
 */

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("A rate says whether it includes VAT (14344)", () => {
  let pool;
  let c;
  const created = [];
  const STAMP = Date.now();

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    c = await pool.connect();
  });
  afterAll(async () => {
    if (c) {
      for (const id of created) await c.query("DELETE FROM dictionary_item WHERE dictionary_item_id = $1", [id]);
      c.release();
    }
    if (pool) await pool.end();
  });

  const dict = () => require("../../src/modules/master/financial_dictionary/financial_dictionary.service");
  const rates = () => require("../../src/modules/master/expense_rate/expense_rate.service");

  async function item(label, { disbursement = false } = {}) {
    const row = await dict().create(c, {
      data: disbursement
        ? {
            label_fr: label, category: "disbursement", direction: "DISBURSEMENT",
            posting_rules: [
              { applies_context: "purchase", debit_account: "4731", credit_account: "4011", is_disbursement: true },
              { applies_context: "sale", debit_account: "4111", credit_account: "4731", is_disbursement: true },
            ],
          }
        : {
            label_fr: label, category: "service", direction: "EXPENSE",
            posting_rules: [{ applies_context: "purchase", debit_account: "6131", credit_account: "4011" }],
          },
      actor: { user_id: null },
    });
    created.push(row.dictionary_item_id);
    return row;
  }

  test("a VAT-inclusive standard rate stores its HT and shows both; a costing adds VAT once", async () => {
    const line = await item(`Pr3 Vat Gate Fee ${STAMP}`);
    const basis = await rates().vatBasisFor(c, { dictionaryItemId: line.dictionary_item_id });
    expect(basis.offered).toBe(true);
    expect(basis.vat_rate_percent).toBe(19.25);

    await dict().supersedeRate(c, {
      id: line.dictionary_item_id,
      data: { rate: 72700, currency: "XAF", effective_from: "2026-01-01", price_includes_vat: true },
      actor: { user_id: null },
    });
    const { rows } = await c.query(
      "SELECT rate, rate_ttc, price_includes_vat, vat_rate_percent FROM expense_rate WHERE dictionary_item_id = $1 AND effective_to IS NULL",
      [line.dictionary_item_id],
    );
    expect(rows).toHaveLength(1);
    // 72 700 ÷ 1.1925 = 60 964.3605… — stored at the column's precision.
    expect(Number(rows[0].rate)).toBe(60964.36);
    expect(Number(rows[0].rate_ttc)).toBe(72700);
    expect(rows[0].price_includes_vat).toBe(true);
    expect(Number(rows[0].vat_rate_percent)).toBe(19.25);

    // What the costing pre-fill reads is the HT…
    const costingRepo = require("../../src/modules/costing/costing/costing.repo");
    const byItem = await costingRepo.ratesForItems(c, [line.dictionary_item_id]);
    const unitCost = Number(byItem.get(line.dictionary_item_id)[0].rate);
    expect(unitCost).toBe(60964.36);
    // …so the sheet adds 19,25 % once and lands on the price typed, not 86 695.
    const { computeCosting } = require("../../src/modules/costing/costing/costing.rules");
    const totals = computeCosting([{ qty: 1, unit_cost: unitCost, tax_rate_percent: 19.25, is_disbursement: false }]);
    expect(totals.total_ht).toBe(60964.36);
    expect(totals.total_ttc).toBe(72700);
  });

  test("the expense-rate API path stores the same, and editing the figure keeps its basis", async () => {
    const line = await item(`Pr3 Vat Handling ${STAMP}`);
    const row = await rates().create(c, {
      dictionaryItemId: line.dictionary_item_id, rate: 11925, currency: "XAF",
      effectiveFrom: "2026-01-01", priceIncludesVat: true, actor: { user_id: null },
    });
    expect(Number(row.rate)).toBe(10000);
    expect(Number(row.rate_ttc)).toBe(11925);

    const edited = await rates().update(c, { id: row.expense_rate_id, patch: { rate: 23850 }, actor: { user_id: null } });
    expect(Number(edited.rate)).toBe(20000);
    expect(Number(edited.rate_ttc)).toBe(23850);

    const off = await rates().update(c, { id: row.expense_rate_id, patch: { rate: 5000, price_includes_vat: false }, actor: { user_id: null } });
    expect(Number(off.rate)).toBe(5000);
    expect(off.price_includes_vat).toBe(false);
    expect(off.rate_ttc).toBeNull();
    expect(off.vat_rate_percent).toBeNull();
  });

  test("a débours is always HT: the flag is refused and the open rate is untouched", async () => {
    const line = await item(`Pr3 Vat Debours ${STAMP}`, { disbursement: true });
    const basis = await rates().vatBasisFor(c, { dictionaryItemId: line.dictionary_item_id });
    expect(basis.is_disbursement).toBe(true);
    expect(basis.offered).toBe(false);

    await dict().supersedeRate(c, {
      id: line.dictionary_item_id,
      data: { rate: 50000, currency: "XAF", effective_from: "2026-01-01" },
      actor: { user_id: null },
    });
    await expect(
      dict().supersedeRate(c, {
        id: line.dictionary_item_id,
        data: { rate: 59625, currency: "XAF", effective_from: "2026-02-01", price_includes_vat: true },
        actor: { user_id: null },
      }),
    ).rejects.toMatchObject({ code: "DEBOURS_ALWAYS_HT", status: 422 });
    const { rows } = await c.query(
      "SELECT rate, effective_to FROM expense_rate WHERE dictionary_item_id = $1",
      [line.dictionary_item_id],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].rate)).toBe(50000);
    expect(rows[0].effective_to).toBeNull();
  });

  test("an existing rate whose note says TTC is listed for review and not changed", async () => {
    const line = await item(`Pr3 Vat Noted ${STAMP}`);
    const ttc = await rates().create(c, {
      dictionaryItemId: line.dictionary_item_id, rate: 72700, currency: "XAF",
      effectiveFrom: "2026-01-01", note: "Tarif 72 700 TTC (TVA incluse)", actor: { user_id: null },
    });
    const plain = await rates().create(c, {
      dictionaryItemId: line.dictionary_item_id, rate: 1000, currency: "XAF",
      effectiveFrom: "2026-01-01", containerTypeRefId: null, rateProviderId: null,
      note: "HT, per BL", actor: { user_id: null },
    });
    const review = await rates().vatReview(c);
    const ids = review.rates.map((r) => r.expense_rate_id);
    expect(ids).toContain(ttc.expense_rate_id);
    expect(ids).not.toContain(plain.expense_rate_id);
    const after = await rates().get(c, ttc.expense_rate_id);
    expect(Number(after.rate)).toBe(72700);
    expect(after.price_includes_vat).toBe(false);
  });
});
