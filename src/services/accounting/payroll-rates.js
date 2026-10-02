/**
 * Payroll rates FROM the tax codes the accountant maintains.
 *
 * ── THE DISCREPANCY THIS CLOSES ─────────────────────────────────────────────
 *
 * Meeting 7 (1 Oct 2026), 01:20:56, on the tax screen, to the tenant:
 *
 *   "if the rate ever changes, let's say CFC changes, you just come here and you
 *    amend the rate and you pick from when it should start applying. So there is
 *    no — I mean it's not rigid. It's not hardcoded and tomorrow something
 *    changes and you're not able to change it."
 *
 * It was hardcoded. `payroll.rules.DEFAULTS` carried its own `cnps_pension_rate`,
 * `cnps_family_rate`, `cfc_*`, `fne_rate`, `cac_rate` and `irpp_brackets`, and
 * `payroll.service.compute` layered only `payroll_config` on top of them. The
 * `tax_code` rows the accountant was being shown — CNPS_PENSION_EE, CFC_ER,
 * CAC_ON_IRPP, IRPP and the rest, versioned, referenced and auditable — were read
 * by NOTHING. Amending CNPS on that screen changed no payslip, and the two
 * numbers could disagree indefinitely with nothing to reveal it.
 *
 * ── THE LAYERING, AND WHY IT IS THIS WAY ROUND ──────────────────────────────
 *
 *     payroll.rules.DEFAULTS   →   tax_code (this file)   →   payroll_config
 *
 *   DEFAULTS stay as the floor. A tenant whose jurisdiction has no PAYROLL codes
 *   yet still computes a payslip, which is what makes a fresh tenant usable.
 *
 *   tax_code is the LAW, effective-dated. It wins over a default because the
 *   accountant maintaining it against the Finance Law is the authority on what
 *   the rate is, and the version in force for the PERIOD is the one that applies —
 *   a January run uses the January rate even when computed in March.
 *
 *   payroll_config still wins over both, and keeps winning on purpose. It is the
 *   per-entity override (G18) — a negotiated injury class, a derogation — and
 *   silently overruling something an accountant deliberately set on an entity
 *   would be a worse bug than the one this file fixes. Only the keys it actually
 *   sets override; it is a sparse patch, not a replacement.
 *
 * Pure except for the one query. `fromTaxCodes` does the read; `mergeRates` is
 * the arithmetic and is unit-tested without a database.
 */
"use strict";

/**
 * tax_code.code → the payroll-config key it supplies, and how to read it.
 *
 *   rate   — `rate_percent` is a percentage; the config key is a fraction.
 *   cap    — the monthly ceiling, read from `brackets.cap_xaf`.
 *   scale  — the IRPP barème and its deductions, read from `brackets`.
 *
 * CNPS pension deliberately maps from the EMPLOYEE code: the engine applies one
 * `cnps_pension_rate` to both sides (KB §9.1 — they are equal by law), so taking
 * it from one code rather than silently preferring one of two is the honest read.
 * CNPS_PENSION_ER is cross-checked against it by `disagreements` below.
 */
const RATE_FROM_CODE = {
  CNPS_PENSION_EE: "cnps_pension_rate",
  CNPS_FAMILY_ER: "cnps_family_rate",
  CNPS_INJURY_ER: "cnps_injury_rate_default",
  CFC_EE: "cfc_employee_rate",
  CFC_ER: "cfc_employer_rate",
  FNE_ER: "fne_rate",
  CAC_ON_IRPP: "cac_rate",
};

/** The code whose `brackets.cap_xaf` is the CNPS monthly ceiling. */
const CEILING_CODE = "CNPS_PENSION_EE";

/**
 * A stored percentage as the fraction the engine wants, or null.
 *
 * The null/empty guard comes FIRST and is load-bearing: `Number(null)` is 0, not
 * NaN, so a `rate_percent IS NULL` row — which every bracket-only code is, IRPP
 * among them — would otherwise resolve to a rate of 0 and the engine would charge
 * nothing for it. Silently, with no key missing for anything to notice.
 */
const pct = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n / 100 : null;
};

/**
 * The IRPP barème, read from the tax code's `brackets`.
 *
 * `upto` in the stored shape is the band's CUMULATIVE CEILING, not its width —
 * {upto:2000000}, {upto:3000000}, {upto:5000000}, {above:5000000} is the CGI
 * scale: 0–2M at 10%, 2M–3M at 15%, 3M–5M at 25%, above 5M at 35%. The engine's
 * `progressive()` reads `upTo` (camel) and treats it the same way, so the mapping
 * is a rename and a /100, not a re-interpretation. Returns null on a shape it
 * cannot read, so a malformed bracket table falls back to DEFAULTS rather than
 * computing a wrong tax silently.
 */
function readBrackets(brackets) {
  const raw = brackets && brackets.annual_brackets;
  if (!Array.isArray(raw) || !raw.length) return null;
  const out = [];
  for (const b of raw) {
    const rate = pct(b.rate);
    if (rate === null) return null;
    // A band is EITHER `upto` (a cumulative ceiling) or `above` (the open-ended
    // top band). `undefined` and `null` both mean "not this shape", hence the
    // explicit pair rather than `!= null`.
    const hasUpto = b.upto !== null && b.upto !== undefined;
    const hasAbove = b.above !== null && b.above !== undefined;
    const ceiling = hasUpto ? Number(b.upto) : hasAbove ? Infinity : null;
    if (ceiling === null || !(ceiling > 0)) return null;
    out.push({ upTo: ceiling, rate });
  }
  out.sort((a, b) => a.upTo - b.upTo);
  // The top band must be open-ended, or income above the last ceiling is untaxed.
  if (out[out.length - 1].upTo !== Infinity) out[out.length - 1] = { ...out[out.length - 1], upTo: Infinity };
  return out;
}

/** The two IRPP deductions the engine takes, read from the same `brackets`. */
function readDeductions(brackets) {
  const d = brackets && brackets.deductions;
  if (!d || typeof d !== "object") return {};
  const out = {};
  const fp = pct(d.prof_allowance_pct);
  if (fp !== null) out.frais_pro_rate = fp;
  const ab = Number(d.annual_abatement);
  // The engine works monthly, so the annual cap is divided here — once, rather
  // than in two places that could drift.
  if (Number.isFinite(ab) && ab >= 0) out.monthly_abatement = Math.round(ab / 12);
  return out;
}

/**
 * Turn the PAYROLL tax codes effective at `date` into a sparse payroll-config
 * patch. Only keys a code actually supplies appear, so merging is additive.
 */
function mergeRates(codes = []) {
  const patch = {};
  for (const row of codes) {
    const code = String(row.code || "").toUpperCase();
    const key = RATE_FROM_CODE[code];
    if (key) {
      const r = pct(row.rate_percent);
      if (r !== null) patch[key] = r;
    }
    if (code === CEILING_CODE) {
      const cap = Number(row.brackets && row.brackets.cap_xaf);
      if (Number.isFinite(cap) && cap > 0) patch.cnps_ceiling = cap;
    }
    if (code === "IRPP") {
      const brackets = readBrackets(row.brackets);
      if (brackets) patch.irpp_brackets = brackets;
      Object.assign(patch, readDeductions(row.brackets));
    }
  }
  return patch;
}

/**
 * Where the tax codes and an entity's `payroll_config` override disagree.
 *
 * Not an error — an override is legitimate (G18) — but it is worth showing: a
 * number nobody meant to override is exactly how the two registries drifted
 * apart in the first place. The payroll screen renders this beside the rates.
 */
function disagreements(taxPatch = {}, override = {}) {
  const out = [];
  for (const [key, taxValue] of Object.entries(taxPatch)) {
    if (!Object.prototype.hasOwnProperty.call(override, key)) continue;
    const ov = override[key];
    if (key === "irpp_brackets") {
      if (JSON.stringify(ov) !== JSON.stringify(taxValue)) out.push({ key, tax_code: taxValue, override: ov });
      continue;
    }
    if (Number(ov) !== Number(taxValue)) out.push({ key, tax_code: taxValue, override: ov });
  }
  return out;
}

/**
 * The PAYROLL tax codes in force at `date`, one row per code key.
 *
 * Reads across jurisdictions (a tenant has one active jurisdiction in practice,
 * and a second would be a second country's payroll, which is not a thing this
 * engine computes yet) and takes the version whose window contains `date` —
 * falling back to the most recent, so a date before the first version still
 * resolves rather than dropping the code.
 */
async function effectivePayrollCodes(client, date) {
  const { rows } = await client.query(
    `SELECT DISTINCT ON (tc.code) tc.code, tc.rate_percent, tc.brackets, tc.effective_from
       FROM tax_code tc
       JOIN tax_jurisdiction j USING (jurisdiction_id)
      WHERE j.is_active
        AND tc.kind = 'PAYROLL'
      ORDER BY tc.code,
               (tc.effective_from <= $1::date
                 AND (tc.effective_to IS NULL OR tc.effective_to >= $1::date)) DESC,
               tc.effective_from DESC`,
    [date],
  );
  return rows;
}

/** The sparse patch the payroll engine layers over DEFAULTS, for one period end. */
async function fromTaxCodes(client, date) {
  return mergeRates(await effectivePayrollCodes(client, date));
}

module.exports = {
  RATE_FROM_CODE,
  CEILING_CODE,
  mergeRates,
  readBrackets,
  readDeductions,
  disagreements,
  effectivePayrollCodes,
  fromTaxCodes,
};
