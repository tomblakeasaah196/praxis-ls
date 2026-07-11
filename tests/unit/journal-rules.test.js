"use strict";
/**
 * KB §23 invariants #1 (balanced) and #2 (one side per line), enforced friendly
 * before the DB triggers. See src/modules/finance/journal_entry/journal_entry.rules.js.
 */
const { assertBalanced } = require("../../src/modules/finance/journal_entry/journal_entry.rules");

const L = (account_code, debit, credit) => ({ account_code, debit, credit });

describe("journal entry balance rules", () => {
  it("accepts a balanced two-line entry", () => {
    const r = assertBalanced([L("521", 1000, 0), L("4191", 0, 1000)]);
    expect(r).toEqual({ debitMinor: 100000, creditMinor: 100000 });
  });

  it("accepts a balanced multi-line entry with decimals", () => {
    expect(() => assertBalanced([
      L("4111", 10385.25, 0),
      L("7061", 0, 10000.25),
      L("4432", 0, 385.0),
    ])).not.toThrow();
  });

  it("rejects fewer than two lines", () => {
    expect(() => assertBalanced([L("521", 100, 0)])).toThrow(/at least two lines/i);
  });

  it("rejects an unbalanced entry", () => {
    expect(() => assertBalanced([L("521", 1000, 0), L("4191", 0, 999)])).toThrow(/not balanced/i);
  });

  it("rejects a line with both sides set (#23.2)", () => {
    expect(() => assertBalanced([L("521", 100, 100), L("4191", 0, 100)])).toThrow(/exactly one/i);
  });

  it("rejects a line with neither side > 0 (#23.2)", () => {
    expect(() => assertBalanced([L("521", 0, 0), L("4191", 0, 100)])).toThrow(/exactly one/i);
  });

  it("rejects more than two decimals", () => {
    expect(() => assertBalanced([L("521", 100.001, 0), L("4191", 0, 100.001)])).toThrow(/2 decimals/i);
  });

  it("rejects a missing account_code", () => {
    expect(() => assertBalanced([L("", 100, 0), L("4191", 0, 100)])).toThrow(/account_code/i);
  });
});

describe("no compensation (#23.6)", () => {
  const { assertNoCompensation } = require("../../src/modules/finance/journal_entry/journal_entry.rules");
  it("allows an entry with distinct debit/credit accounts", () => {
    expect(() => assertNoCompensation([L("521", 1000, 0), L("4191", 0, 1000)])).not.toThrow();
  });
  it("allows the same account on the same side twice", () => {
    expect(() => assertNoCompensation([L("706", 0, 500), L("706", 0, 500), L("4111", 1000, 0)])).not.toThrow();
  });
  it("rejects an account debited AND credited in one entry", () => {
    expect(() => assertNoCompensation([L("411", 1000, 0), L("411", 0, 400), L("706", 0, 600)])).toThrow(/compensation|both debited and credited/i);
  });
});
