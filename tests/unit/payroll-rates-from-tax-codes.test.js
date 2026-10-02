"use strict";
/**
 * The rates an accountant edits are the rates a payslip uses.
 *
 * ── THE DISCREPANCY THIS PINS ──────────────────────────────────────────────
 *
 * Meeting 7 (1 Oct 2026), 01:20:56, on the tax screen, to the first tenant:
 *
 *   "if the rate ever changes, let's say CFC changes, you just come here and you
 *    amend the rate and you pick from when it should start applying. So there is
 *    no — I mean it's not rigid. It's not hardcoded and tomorrow something
 *    changes and you're not able to change it."
 *
 * It was hardcoded. `payroll.rules.DEFAULTS` held its own CNPS, CFC, FNE, CAC and
 * IRPP numbers, `payroll.service.compute` layered only `payroll_config` over them,
 * and the effective-dated `tax_code` rows being demonstrated were read by nothing.
 * The two could disagree indefinitely with nothing to reveal it.
 *
 * `payroll-rates.mergeRates` is the mapping, and it is pure, so the whole of it is
 * testable here without a database.
 */
const rates = require("../../src/services/accounting/payroll-rates");
const { DEFAULTS, progressive, computePayslip } = require("../../src/modules/hr/payroll/payroll.rules");

/** The PAYROLL rows 9010 seeds, in the shape the query returns them. */
const SEEDED = [
  { code: "CNPS_PENSION_EE", rate_percent: "4.2000", brackets: { cap_xaf: 750000 } },
  { code: "CNPS_PENSION_ER", rate_percent: "4.2000", brackets: { cap_xaf: 750000 } },
  { code: "CNPS_FAMILY_ER", rate_percent: "7.0000", brackets: { cap_xaf: 750000 } },
  { code: "CNPS_INJURY_ER", rate_percent: "2.5000", brackets: { risk_classes: { office: 1.75 } } },
  { code: "CFC_EE", rate_percent: "1.0000", brackets: null },
  { code: "CFC_ER", rate_percent: "1.5000", brackets: null },
  { code: "FNE_ER", rate_percent: "1.0000", brackets: null },
  { code: "CAC_ON_IRPP", rate_percent: "10.0000", brackets: null },
  {
    code: "IRPP",
    rate_percent: null,
    brackets: {
      annual_brackets: [
        { upto: 2000000, rate: 10 },
        { upto: 3000000, rate: 15 },
        { upto: 5000000, rate: 25 },
        { above: 5000000, rate: 35 },
      ],
      deductions: { cnps_pension: true, prof_allowance_pct: 30, annual_abatement: 500000 },
    },
  },
];

describe("payroll rates resolved from the tax codes", () => {
  it("supplies every rate key the engine reads", () => {
    const patch = rates.mergeRates(SEEDED);
    for (const key of [
      "cnps_pension_rate",
      "cnps_ceiling",
      "cnps_family_rate",
      "cnps_injury_rate_default",
      "cfc_employee_rate",
      "cfc_employer_rate",
      "fne_rate",
      "cac_rate",
      "frais_pro_rate",
      "monthly_abatement",
      "irpp_brackets",
    ]) {
      expect(patch).toHaveProperty(key);
    }
  });

  it("every key it supplies is a key the engine actually has", () => {
    // `payroll.service.saveConfig` validates against Object.keys(DEFAULTS) and
    // throws UNKNOWN_RATE on anything else. A key this resolver invents would be
    // silently ignored by `computePayslip` instead, which is worse.
    const unknown = Object.keys(rates.mergeRates(SEEDED)).filter((k) => !(k in DEFAULTS));
    expect(unknown).toEqual([]);
  });

  it("reads a percentage as a fraction, which is what the engine wants", () => {
    const patch = rates.mergeRates(SEEDED);
    expect(patch.cnps_pension_rate).toBeCloseTo(0.042, 6);
    expect(patch.cfc_employer_rate).toBeCloseTo(0.015, 6);
    expect(patch.cac_rate).toBeCloseTo(0.1, 6);
  });

  it("takes the CNPS ceiling from the code's own cap, not a constant", () => {
    expect(rates.mergeRates(SEEDED).cnps_ceiling).toBe(750000);
    const raised = SEEDED.map((c) =>
      c.code === "CNPS_PENSION_EE" ? { ...c, brackets: { cap_xaf: 900000 } } : c,
    );
    expect(rates.mergeRates(raised).cnps_ceiling).toBe(900000);
  });

  it("divides the ANNUAL abatement into the monthly one the engine applies", () => {
    // 500 000 / 12 — done once here rather than in two places that could drift.
    expect(rates.mergeRates(SEEDED).monthly_abatement).toBe(41667);
  });

  describe("the IRPP barème", () => {
    it("reads `upto` as a cumulative ceiling, matching the CGI scale", () => {
      const b = rates.readBrackets(SEEDED.find((c) => c.code === "IRPP").brackets);
      expect(b.map((x) => x.rate)).toEqual([0.1, 0.15, 0.25, 0.35]);
      expect(b[0].upTo).toBe(2000000);
      expect(b[1].upTo).toBe(3000000);
      expect(b[2].upTo).toBe(5000000);
      // The top band is unbounded, or income above the last ceiling is untaxed.
      expect(Number.isFinite(b[3].upTo)).toBe(false);
    });

    it("produces the same tax as the shipped default, which is the point", () => {
      // The seeded code and DEFAULTS describe the SAME law. If this diverges,
      // one of the two is wrong and a payslip changed without anyone deciding.
      const b = rates.readBrackets(SEEDED.find((c) => c.code === "IRPP").brackets);
      for (const taxable of [0, 1_500_000, 2_000_000, 3_000_000, 4_200_000, 10_000_000]) {
        expect(progressive(taxable, b)).toBeCloseTo(progressive(taxable, DEFAULTS.irpp_brackets), 6);
      }
    });

    it("falls back rather than computing a wrong tax from a broken table", () => {
      expect(rates.readBrackets(null)).toBeNull();
      expect(rates.readBrackets({ annual_brackets: [] })).toBeNull();
      expect(rates.readBrackets({ annual_brackets: [{ rate: 10 }] })).toBeNull();
      expect(rates.readBrackets({ annual_brackets: [{ upto: 2000000 }] })).toBeNull();
      // A sparse patch means `computePayslip` keeps DEFAULTS.irpp_brackets.
      const patch = rates.mergeRates([{ code: "IRPP", rate_percent: null, brackets: { annual_brackets: [] } }]);
      expect(patch.irpp_brackets).toBeUndefined();
    });

    it("survives the JSON round-trip a computed run's snapshot does", () => {
      // `payroll_run.config_snapshot = JSON.stringify(cfg)` and JSON has no
      // Infinity: `{upTo: Infinity}` becomes `{upTo: null}`. Read back naively
      // the top band contributes nothing and the highest earners are
      // under-taxed by a snapshot that looks fine.
      const b = rates.readBrackets(SEEDED.find((c) => c.code === "IRPP").brackets);
      const roundTripped = JSON.parse(JSON.stringify(b));
      expect(progressive(10_000_000, roundTripped)).toBeCloseTo(progressive(10_000_000, b), 6);
    });
  });

  it("is a SPARSE patch, so a missing code leaves the default standing", () => {
    const patch = rates.mergeRates([{ code: "CFC_EE", rate_percent: "1.0000", brackets: null }]);
    expect(Object.keys(patch)).toEqual(["cfc_employee_rate"]);
    const cfg = { ...DEFAULTS, ...patch };
    expect(cfg.cnps_pension_rate).toBe(DEFAULTS.cnps_pension_rate);
  });

  it("ignores a code with no rate rather than writing a zero", () => {
    // A PAYROLL code that carries only a bracket table (IRPP) must not set a
    // rate key to 0 — the engine would then charge nothing for it.
    const patch = rates.mergeRates([{ code: "CFC_EE", rate_percent: null, brackets: null }]);
    expect(patch).toEqual({});
  });

  it("a rate amended on the tax screen changes the payslip", () => {
    // The sentence the tenant was told, as an assertion. CFC employee 1% → 3%
    // on a 1 000 000 gross is 10 000 → 30 000 off the payslip.
    const base = { ...DEFAULTS, ...rates.mergeRates(SEEDED) };
    const amended = {
      ...DEFAULTS,
      ...rates.mergeRates(
        SEEDED.map((c) => (c.code === "CFC_EE" ? { ...c, rate_percent: "3.0000" } : c)),
      ),
    };
    const before = computePayslip({ base_salary: 1_000_000 }, { config: base });
    const after = computePayslip({ base_salary: 1_000_000 }, { config: amended });
    expect(before.employee.cfc).toBe(10_000);
    expect(after.employee.cfc).toBe(30_000);
    expect(after.net_pay).toBeLessThan(before.net_pay);
  });

  describe("a stale override is visible, not silent", () => {
    it("names a key where payroll_config contradicts the tax code", () => {
      const taxPatch = rates.mergeRates(SEEDED);
      const out = rates.disagreements(taxPatch, { cnps_pension_rate: 0.05 });
      expect(out).toEqual([{ key: "cnps_pension_rate", tax_code: 0.042, override: 0.05 }]);
    });

    it("says nothing when the override agrees, or does not set the key", () => {
      const taxPatch = rates.mergeRates(SEEDED);
      expect(rates.disagreements(taxPatch, { cnps_pension_rate: 0.042 })).toEqual([]);
      expect(rates.disagreements(taxPatch, {})).toEqual([]);
      // A key the tax codes do not supply is not a disagreement.
      expect(rates.disagreements(taxPatch, { cnps_injury_rate_default: 0.05 }).length).toBe(1);
      expect(rates.disagreements({}, { cnps_pension_rate: 0.09 })).toEqual([]);
    });

    it("compares the barème structurally, not by reference", () => {
      const taxPatch = rates.mergeRates(SEEDED);
      const same = JSON.parse(JSON.stringify(taxPatch.irpp_brackets));
      expect(rates.disagreements(taxPatch, { irpp_brackets: same })).toEqual([]);
      expect(
        rates.disagreements(taxPatch, { irpp_brackets: [{ upTo: 1, rate: 0.5 }] }).length,
      ).toBe(1);
    });
  });
});
