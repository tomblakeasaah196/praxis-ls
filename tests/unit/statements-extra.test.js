"use strict";
/** Grand livre running balance + cash-flow (TAFIRE) summary. */
const { runningBalance, cashFlowSummary } = require("../../src/modules/finance/financial_statement/financial_statement.rules");
describe("runningBalance", () => {
  it("accumulates debit-positive", () => {
    const r = runningBalance([{ debit: 1000, credit: 0 }, { debit: 0, credit: 400 }, { debit: 200, credit: 0 }], 0);
    expect(r.map((x) => x.balance)).toEqual([1000, 600, 800]);
  });
  it("honours an opening balance", () => {
    expect(runningBalance([{ debit: 0, credit: 500 }], 1000)[0].balance).toBe(500);
  });
});
describe("cashFlowSummary (TAFIRE foundation)", () => {
  it("closing = opening + inflows - outflows", () => {
    const s = cashFlowSummary({ opening_cash: 1000000, inflows: 3000000, outflows: 1200000 });
    expect(s.net_change).toBe(1800000);
    expect(s.closing_cash).toBe(2800000);
  });
});

const { tafire } = require("../../src/modules/finance/financial_statement/financial_statement.rules");

describe("TAFIRE OHADA sectioning", () => {
  test("opening + operating/investing/financing = closing", () => {
    const t = tafire({ opening_cash: 1000, operating: 500, investing: -300, financing: 200 });
    expect(t.net_change).toBe(400);
    expect(t.closing_cash).toBe(1400);
    expect(t.operating).toBe(500);
    expect(t.investing).toBe(-300);
    expect(t.financing).toBe(200);
  });
  test("handles missing/zero sections and rounds", () => {
    const t = tafire({ opening_cash: 0 });
    expect(t.closing_cash).toBe(0);
    expect(t.net_change).toBe(0);
  });
});
