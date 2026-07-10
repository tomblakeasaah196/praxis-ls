"use strict";
/** Tax Center (KB §15/§16) — pure, against the ACME worked numbers. */
const { vatReturn, turnoverFrom, corporateTax } = require("../../src/modules/finance/tax_declaration/tax_declaration.rules");

describe("VAT return (§16)", () => {
  it("output − input, net due", () => {
    const r = vatReturn([
      { account_code: "4432", debit: 0, credit: 385000 },
      { account_code: "4452", debit: 96250, credit: 0 },
    ]);
    expect(r.output_vat).toBe(385000);
    expect(r.input_vat).toBe(96250);
    expect(r.vat_due).toBe(288750);
  });
  it("net credit carried forward when input exceeds output", () => {
    const r = vatReturn([{ account_code: "4432", debit: 0, credit: 100000 }, { account_code: "445", debit: 150000, credit: 0 }]);
    expect(r.vat_due).toBe(0);
    expect(r.vat_credit).toBe(50000);
  });
});

describe("turnover (débours excluded)", () => {
  it("sums class 70 credit balances only", () => {
    expect(turnoverFrom([
      { account_code: "7061", debit: 0, credit: 1500000 },
      { account_code: "7062", debit: 0, credit: 500000 },
      { account_code: "4731", debit: 0, credit: 8000000 }, // débours — not class 7
    ])).toBe(2000000);
  });
});

describe("corporate tax (§15)", () => {
  it("minimum tax (2.2% of turnover) is due even at a loss", () => {
    const r = corporateTax({ result: -500000, turnover: 2000000 });
    expect(r.minimum_tax).toBe(44000);
    expect(r.tax_due).toBe(44000);
    expect(r.basis).toBe("MINIMUM_TAX");
  });
  it("IS (33%) applies when it exceeds the minimum", () => {
    const r = corporateTax({ result: 800000, turnover: 2000000 });
    expect(r.is_on_profit).toBe(264000);
    expect(r.tax_due).toBe(264000);
    expect(r.basis).toBe("IS");
  });
});
