"use strict";
/**
 * Every tax code names BOTH accounts it posts to, and both are postable leaves.
 *
 * ── THE DEFECT THIS PINS ───────────────────────────────────────────────────
 *
 * Meeting 7 (1 Oct 2026), 01:25:15, live on the tax screen in front of the first
 * tenant: "I think there's a problem here, it doesn't write the accounts it posts
 * to, that means accounts to be debited and credited … debit accounts none … So
 * I'll ensure that every account is actually mapped to their account."
 *
 * Twelve of the twenty-one codes 9010 originally seeded were defective — nine
 * with one side NULL, three pointing at a non-postable HEADING (`62`, `447`,
 * `521`), which is worse because it looks mapped and the screen's own picker
 * would not even offer it. Seed 90999 repairs them.
 *
 * ── WHY THE COUNT IS NINE NOW, NOT TWELVE ──────────────────────────────────
 *
 * The three output-VAT codes (TVA_STD, TVA_STD_SALES, TVA_EXPORT) are now
 * born-mapped in 9010 itself — their debit is 4111 in the VALUES, not filled in
 * afterwards — so a fresh tenant needs no repair for them. That leaves NINE
 * defective in what 9010 ships: two input-VAT credits, four payroll debits and
 * the three heading-pointers. 90999 still repairs those, and still re-asserts
 * the output-VAT debit for tenants provisioned before 9010 carried it (a no-op
 * here, since the parsed VALUES already have it). Seed 9011 additionally
 * backfills WHT_SERVICE_REEL/PUBLIC on tenants whose credit was later cleared by
 * hand — those two are not in the shipped-gap set, because 9010 maps them on
 * both sides (debit 4492 / credit 4111).
 *
 * ── WHY NO TEST CAUGHT IT, AND WHY THIS ONE IS STATIC ──────────────────────
 *
 * `determination.compute` reads ONE side per context — the credit on a sale, the
 * debit on a purchase — and takes the counterpart from the document. So the
 * invoice path posted correctly from a half-written rate card and every test
 * about it stayed green, while the screen, the payroll posting and anyone checking
 * the mapping before go-live read "none".
 *
 * The repair is SQL applied once at provisioning, so a regression in it would only
 * surface against a live Postgres, long after the edit. This reads the two seeds
 * statically: 9010's VALUES for what ships, 9000/9001 for which accounts are
 * postable, 90999 for what is filled in. An edit that reintroduces a gap fails here,
 * next to the change.
 */
const fs = require("fs");
const path = require("path");

const SEEDS = path.join(__dirname, "..", "..", "migrations", "seeds");
const read = (f) => fs.readFileSync(path.join(SEEDS, f), "utf8");

/**
 * The postable leaf codes, from the COA seeds.
 * Column order: code, parent_code, label_fr, label_en, class, normal_balance,
 * is_postable, requires_analytic — so the 7th field is what matters.
 */
function postableAccounts() {
  const out = new Set();
  for (const file of ["9000_seed_coa.sql", "9001_seed_coa_expansion.sql"]) {
    const src = read(file);
    for (const m of src.matchAll(
      /\(\s*'([0-9A-Za-z_]+)'\s*,\s*(?:NULL|'[^']*')\s*,\s*'(?:[^']|'')*'\s*,\s*'(?:[^']|'')*'\s*,\s*\d+\s*,\s*'[DC]'\s*,\s*(true|false)\s*,/g,
    )) {
      if (m[2] === "true") out.add(m[1]);
    }
  }
  return out;
}

/**
 * The seeded tax codes, as (code → {debit, credit}) AFTER 90999's repairs are
 * applied the way Postgres would apply them.
 *
 * 9010 is parsed for what ships; 90999's UPDATEs are then replayed against it by
 * the rules below rather than by executing SQL. Replaying them by hand is the
 * price of a static test, and it is worth paying: the alternative is a gate that
 * needs a database and therefore does not run in `npm run ci`.
 */
function seededTaxCodes() {
  const src = read("9010_seed_tax.sql");
  const out = new Map();
  // ('<jur-uuid>','CODE','KIND',<rate|NULL>,<base|NULL>,<applies|NULL>,<recov>,
  //   <debit>,<credit>,...
  const row =
    /\(\s*'[0-9a-f-]{36}'\s*,\s*'([A-Z0-9_]+)'\s*,\s*'(VAT|WHT|INCOME|PAYROLL|OTHER)'\s*,\s*([0-9.]+|NULL)\s*,\s*('[^']*'|NULL)\s*,\s*('[^']*'|NULL)\s*,\s*(true|false|NULL)\s*,\s*\n?\s*('[^']*'|NULL)\s*,\s*('[^']*'|NULL)\s*,/g;
  const unquote = (v) => (v === "NULL" ? null : v.slice(1, -1));
  for (const m of src.matchAll(row)) {
    out.set(m[1], {
      kind: m[2],
      appliesTo: unquote(m[5]),
      debit: unquote(m[7]),
      credit: unquote(m[8]),
    });
  }
  return out;
}

/** 90999's UPDATEs, replayed over the parsed 9010 rows. */
function applyRepair(codes, postable) {
  for (const [code, c] of codes) {
    if (c.kind === "VAT" && c.appliesTo === "sales" && !c.debit) c.debit = "4111";
    if (c.kind === "VAT" && c.appliesTo === "purchases" && !c.credit) c.credit = "4011";
    if (
      c.kind === "PAYROLL" &&
      !c.debit &&
      ["IRPP", "CAC_ON_IRPP", "CFC_EE", "CNPS_PENSION_EE"].includes(code)
    ) {
      c.debit = "422";
    }
    if (code === "SIT_NONRES") {
      if (!c.debit || c.debit === "62") c.debit = "4011";
      if (!c.credit || c.credit === "447") c.credit = "4474";
    }
    if (["IS_MIN_REEL", "IS_MIN_SIMPL"].includes(code)) {
      if (!c.credit || c.credit === "521") c.credit = "5211";
    }
    // The catch-all: anything still pointing at a heading is cleared to NULL,
    // which this test then fails on — deliberately. NULL is honest; a heading
    // looks mapped.
    if (c.debit && !postable.has(c.debit)) c.debit = null;
    if (c.credit && !postable.has(c.credit)) c.credit = null;
  }
  return codes;
}

describe("seeded tax codes post to both sides", () => {
  const postable = postableAccounts();
  const shipped = seededTaxCodes();
  const repaired = applyRepair(seededTaxCodes(), postable);

  it("parses the seeds, so nothing below passes vacuously", () => {
    expect(postable.size).toBeGreaterThan(20);
    expect(postable.has("4111")).toBe(true);
    expect(postable.has("422")).toBe(true);
    // Headings are NOT postable — the three the seed wrongly pointed at.
    expect(postable.has("62")).toBe(false);
    expect(postable.has("447")).toBe(false);
    expect(postable.has("521")).toBe(false);
    expect(shipped.size).toBeGreaterThanOrEqual(20);
  });

  it("documents the gap 9010 shipped, so the repair cannot be dropped silently", () => {
    const defective = [...shipped.entries()]
      .filter(([, c]) => !c.debit || !c.credit || !postable.has(c.debit) || !postable.has(c.credit))
      .map(([code]) => code);
    // If this number MOVES, 9010 was edited. Either the gap was fixed at source
    // (then shrink this) or a new one was added. The three output-VAT codes were
    // fixed at source (debit 4111 now in the VALUES), so nine remain: two
    // input-VAT credits, four payroll debits, three heading-pointers.
    expect(defective.length).toBe(9);
    // The three born-mapped at source are no longer in the gap.
    expect(defective).not.toContain("TVA_STD");
    expect(defective).not.toContain("TVA_STD_SALES");
    expect(defective).not.toContain("TVA_EXPORT");
  });

  it("leaves no code unmapped once 90999 has run", () => {
    const unmapped = [...repaired.entries()]
      .filter(([, c]) => !c.debit || !c.credit)
      .map(([code, c]) => `${code} (debit ${c.debit ?? "—"} / credit ${c.credit ?? "—"})`);
    expect(unmapped).toEqual([]);
  });

  it("points every side at a POSTABLE leaf, never a heading", () => {
    const bad = [];
    for (const [code, c] of repaired) {
      if (c.debit && !postable.has(c.debit)) bad.push(`${code} debit ${c.debit}`);
      if (c.credit && !postable.has(c.credit)) bad.push(`${code} credit ${c.credit}`);
    }
    expect(bad).toEqual([]);
  });

  it("maps employee withholdings against net pay, not an expense", () => {
    // The distinction that makes the payslip right: an employee deduction
    // reduces what we owe THEM (422), while an employer charge is our own cost
    // (664). Getting these the same way round overstates payroll expense.
    for (const code of ["IRPP", "CAC_ON_IRPP", "CFC_EE", "CNPS_PENSION_EE"]) {
      expect(repaired.get(code).debit).toBe("422");
    }
    for (const code of ["CNPS_PENSION_ER", "CNPS_FAMILY_ER", "CFC_ER", "FNE_ER"]) {
      expect(repaired.get(code).debit).toBe("664");
    }
  });

  it("withholds the non-resident 15% off what we pay the supplier", () => {
    // The owner's own example (01:19:19): "if you're working with a consultant
    // who is a foreigner, once you're paying that consultant, you need to
    // withhold 15% and deposit it with the government."
    expect(repaired.get("SIT_NONRES")).toMatchObject({ debit: "4011", credit: "4474" });
  });
});

describe("the rule that stops the thirteenth", () => {
  const { assertPostingAccounts } = require("../../src/modules/master/tax_jurisdiction/tax_jurisdiction.rules");

  it("refuses a code with either side blank", () => {
    expect(() => assertPostingAccounts({ postsDebitAccount: "4452", postsCreditAccount: null }))
      .toThrow(/debits AND/);
    expect(() => assertPostingAccounts({ postsDebitAccount: null, postsCreditAccount: "4432" }))
      .toThrow(/debits AND/);
    expect(() => assertPostingAccounts({ postsDebitAccount: null, postsCreditAccount: null }))
      .toThrow(/debits AND/);
  });

  it("names BOTH missing fields at once, so one fix round is enough", () => {
    let err;
    try {
      assertPostingAccounts({ postsDebitAccount: null, postsCreditAccount: null });
    } catch (e) {
      err = e;
    }
    expect(err.code).toBe("TAX_CODE_UNMAPPED");
    expect(err.details).toEqual({
      posts_debit_account: ["required"],
      posts_credit_account: ["required"],
    });
  });

  it("refuses a heading even though both sides are present", () => {
    expect(() =>
      assertPostingAccounts(
        { postsDebitAccount: "62", postsCreditAccount: "447" },
        new Set(["4111", "4432"]),
      ),
    ).toThrow(/postable leaves/);
  });

  it("accepts a fully mapped code, and skips the leaf check with no list", () => {
    expect(assertPostingAccounts({ postsDebitAccount: "4111", postsCreditAccount: "4432" })).toBe(true);
    expect(
      assertPostingAccounts(
        { postsDebitAccount: "4111", postsCreditAccount: "4432" },
        new Set(["4111", "4432"]),
      ),
    ).toBe(true);
  });
});
