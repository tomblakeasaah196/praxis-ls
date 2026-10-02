"use strict";
/**
 * Milestone owners are a registry, in every layer at once.
 *
 * ── WHAT WENT WRONG ───────────────────────────────────────────────────────
 *
 * Meeting 7 (1 Oct 2026), 01:56:14 → 01:57:20, on the project-cargo chain: "we
 * should even have the possibility of adding more parties here … let me see if we
 * already have it. No, we don't have that. So we're going to have a settings
 * button, a configurations button that will permit us to create new milestone
 * owner categories."
 *
 * The five values were hardcoded in FOUR places: a zod enum in
 * milestone.validator, two CHECK constraints in 0650 (`milestone_template_stage`
 * and `milestone_instance`), a third on `milestone_instance.attributed_to`, and
 * `OWNER_TIERS` in the client. Freeing one and leaving another is worse than
 * leaving all four: the chain publishes and then the dossier fails to instantiate.
 * So this test checks the layers TOGETHER.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const MIGRATION = "migrations/tenant/14400_milestone_owner_registry.sql";
const SEED = "migrations/seeds/9160_seed_milestone_owners.sql";

/** The owner rows 9160 seeds: code → { isInternal }. */
function seededOwners() {
  const out = new Map();
  for (const m of read(SEED).matchAll(
    /^\s*\('([A-Z][A-Z0-9_]*)',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*(true|false),/gm,
  )) {
    out.set(m[1], { name: m[2], nameFr: m[3], isInternal: m[4] === "true" });
  }
  return out;
}

describe("the registry migration", () => {
  const sql = read(MIGRATION);

  it("creates the table with the constraints a NEW table may carry", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS milestone_owner/);
    expect(sql).toMatch(/milestone_owner_code_uq\s+UNIQUE \(code\)/);
    expect(sql).toMatch(/milestone_owner_code_shape\s+CHECK/);
  });

  it("drops ALL THREE hardcoded CHECKs, not just the obvious one", () => {
    // Leaving any one in place means a code this registry allows cannot be
    // stored — and the failure lands at a different moment for each table.
    for (const name of [
      "milestone_stage_owner_tier_chk",
      "milestone_instance_owner_tier_chk",
      "milestone_instance_attributed_chk",
    ]) {
      expect(sql).toContain(`DROP CONSTRAINT IF EXISTS ${name}`);
    }
  });

  it("adds no constraint to a table it did not create (the 13791 rule)", () => {
    // Enforced globally by migration-constraint-ordering.test.js; asserted here
    // too because the obvious fix for "no FK" is to add one, and that aborts
    // provisioning a fresh tenant.
    const executable = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    for (const stmt of executable.split(";")) {
      if (!/ALTER\s+TABLE\s+milestone_(template_stage|instance)/i.test(stmt)) continue;
      expect(stmt).not.toMatch(/\bADD\s+CONSTRAINT\b/i);
      expect(stmt).not.toMatch(/\bREFERENCES\b/i);
    }
  });

  it("declares a down section", () => {
    expect(sql).toMatch(/^-- DOWN$|--\s*DOWN/m);
  });
});

describe("the seeded owners", () => {
  const owners = seededOwners();

  it("parses, so nothing below passes vacuously", () => {
    expect(owners.size).toBeGreaterThanOrEqual(15);
  });

  it("keeps the five codes every existing stage already stores", () => {
    // 9091, 0680 and 11744 wrote these onto every shipped stage, and closed
    // milestones carry them in `attributed_to`. Dropping one orphans that history.
    for (const code of ["INTERNAL", "CARRIER", "TERMINAL", "AUTHORITY", "CLIENT"]) {
      expect(owners.has(code)).toBe(true);
    }
  });

  it("ships the richer list, not just the five", () => {
    // The owner's answer to the review: the registry, "but seed in more from
    // values for all tenants" — so a forwarder does not have to invent the
    // parties a Douala file waits on.
    for (const code of [
      "CUSTOMS",
      "ROAD_AUTHORITY",
      "PORT_AUTHORITY",
      "SHIPPING_LINE",
      "AIRLINE",
      "RAILWAY",
      "HAULIER",
      "WAREHOUSE",
      "SURVEYOR",
      "INSURER",
      "BANK",
      "AGENT",
      "SUPPLIER",
      "OTHER_PARTY",
    ]) {
      expect(owners.has(code)).toBe(true);
    }
  });

  it("marks INTERNAL as ours and nothing else", () => {
    // `is_internal` is the only thing the ours/theirs split reads, so a second
    // row claiming to be us silently moves delay out of the third-party column.
    const internal = [...owners.entries()].filter(([, o]) => o.isInternal).map(([c]) => c);
    expect(internal).toEqual(["INTERNAL"]);
  });

  it("gives every owner both an English and a French name", () => {
    // ⌘K and the chain render in both languages; a French desk reading
    // "Shipping line" is the gap this product spends gates preventing.
    const missing = [...owners.entries()].filter(([, o]) => !o.name.trim() || !o.nameFr.trim());
    expect(missing).toEqual([]);
  });

  it("re-owns the customs stages without touching the ones that are not customs", () => {
    const sql = read(SEED);
    // The split the owner named: a declaration stuck at the customs desk and a
    // convoi-exceptionnel permit stuck at the road authority are different
    // people to call.
    expect(sql).toMatch(/SET owner_tier = 'CUSTOMS'/);
    expect(sql).toMatch(/SET owner_tier = 'ROAD_AUTHORITY'/);
    expect(sql).toMatch(/code = 'PERMITS'/);
    // A gendarmerie checkpoint, a civil-aviation authorisation and a statutory
    // filing stay AUTHORITY.
    for (const code of ["CHECKPOINT", "RAIL_CHECKPOINT", "BOARDING_AUTH", "REGISTRATIONS", "COMPLIANCE_FILING"]) {
      expect(sql).not.toContain(`'${code}'`);
    }
    // Only system stages a tenant has not re-owned.
    expect(sql).toMatch(/WHERE is_system/);
    expect(sql).toMatch(/AND owner_tier = 'AUTHORITY'/);
  });

  it("is non-destructive on a re-run: a renamed row keeps the tenant's wording", () => {
    const sql = read(SEED);
    expect(sql).toMatch(/ON CONFLICT \(code\) DO UPDATE SET/);
    // The CASE is what makes it non-destructive — an unconditional
    // `name = EXCLUDED.name` would overwrite a tenant's rename on every deploy.
    expect(sql).toMatch(/name\s*=\s*CASE WHEN milestone_owner\.name\s*=\s*EXCLUDED\.name/);
    expect(sql).toMatch(/name_fr\s*=\s*CASE WHEN milestone_owner\.name_fr\s*=\s*EXCLUDED\.name_fr/);
  });
});

describe("the registry's write surface", () => {
  const kit = require("../../src/modules/master/milestone_owner/milestone_owner.repo");

  it("closes mass assignment on the one field that would mint a shipped row", () => {
    // The kit's allow-list is what stops a request setting is_system and creating
    // a row nobody can delete (spec §6.2).
    expect(kit.repo.writable).toContain("code");
    expect(kit.repo.writable).toContain("is_internal");
    expect(kit.repo.writable).not.toContain("is_system");
    expect(kit.repo.writable).not.toContain("owner_id");
    expect(kit.repo.writable).not.toContain("created_at");
  });

  it("strips `code` from an UPDATE instead of rejecting the call", async () => {
    // Every stage and every closed instance stores the code, so renaming it
    // orphans history. Stripped rather than 422'd: a form PATCH echoes the whole
    // row back, and that should save the names rather than fail on a field it
    // did not change.
    //
    // Asserted on the SQL that reaches the client rather than on the patch
    // object, because `query-helpers` is destructured at require time and a
    // monkey-patched export would not be the function the module calls — a stub
    // that silently never runs is the shape of test that passes forever.
    const sent = [];
    const client = {
      query: async (sql, params) => {
        sent.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
        return { rows: [{ owner_id: "id-1" }] };
      },
    };
    await kit.repo.update(client, "id-1", {
      code: "RENAMED",
      name: "New name",
      name_fr: "Nouveau nom",
    });
    const update = sent.find((q) => /^UPDATE milestone_owner/i.test(q.sql));
    expect(update).toBeDefined();
    expect(update.sql).toMatch(/\bname\b/);
    expect(update.sql).toMatch(/\bname_fr\b/);
    // The whole point: no SET on the code, and the new value is not a parameter.
    expect(update.sql).not.toMatch(/\bcode\s*=/);
    expect(update.params).not.toContain("RENAMED");
  });

  it("names which codes are unknown, and tolerates an empty or null list", async () => {
    const client = {
      query: async () => ({ rows: [{ code: "INTERNAL" }, { code: "CUSTOMS" }] }),
    };
    expect(await kit.repo.unknownCodes(client, ["INTERNAL", "CUSTOMS", "NOPE"])).toEqual(["NOPE"]);
    // No query at all for nothing to check — publishing a chain with no owners
    // set must not cost a round trip.
    expect(await kit.repo.unknownCodes({ query: () => { throw new Error("queried"); } }, [])).toEqual([]);
    expect(await kit.repo.unknownCodes({ query: () => { throw new Error("queried"); } }, [null, undefined])).toEqual([]);
  });
});

describe("the validator no longer holds the list", () => {
  const validator = require("../../src/modules/operations/milestone/milestone.validator");

  it("accepts an owner code the old enum would have refused", () => {
    const body = {
      service_type_id: "11111111-1111-1111-1111-111111111111",
      stages: [
        { code: "A", label_fr: "a", owner_tier: "ROAD_AUTHORITY" },
        { code: "B", label_fr: "b", owner_tier: "MARINE_SURVEYOR" },
        { code: "C", label_fr: "c", owner_tier: "INTERNAL" },
      ],
    };
    expect(validator.schemas.publishTemplate.safeParse(body).success).toBe(true);
  });

  it("still refuses a code that is not a code", () => {
    // Shape only — whether the code EXISTS is checked against the registry in
    // milestone.service (assertOwnersExist), because a zod schema cannot reach
    // the tenant's database. 14400's header says why there is no FK either.
    const bad = (owner) =>
      validator.schemas.publishTemplate.safeParse({
        service_type_id: "11111111-1111-1111-1111-111111111111",
        stages: [
          { code: "A", label_fr: "a", owner_tier: owner },
          { code: "B", label_fr: "b" },
          { code: "C", label_fr: "c" },
        ],
      }).success;
    expect(bad("lower case")).toBe(false);
    expect(bad("WITH SPACE")).toBe(false);
    expect(bad("WITH-DASH")).toBe(false);
    expect(bad("X")).toBe(false);
    expect(bad("")).toBe(false);
  });
});

describe("renaming a stage in place", () => {
  const validator = require("../../src/modules/operations/milestone/milestone.validator");
  const parse = (b) => validator.schemas.renameStage.safeParse(b);

  it("takes either label, or both", () => {
    expect(parse({ label_fr: "Étude de faisabilité" }).success).toBe(true);
    expect(parse({ label_en: "Feasibility study" }).success).toBe(true);
    expect(parse({ label_fr: "a", label_en: "b" }).success).toBe(true);
    // Clearing the English label is legitimate; the French one is NOT NULL.
    expect(parse({ label_en: null }).success).toBe(true);
    expect(parse({ label_fr: "" }).success).toBe(false);
  });

  it("refuses a call that would change nothing", () => {
    expect(parse({}).success).toBe(false);
  });

  it("refuses anything that would change the SCHEDULE", () => {
    // The safety argument for renaming a PUBLISHED version in place: a weight,
    // an owner or the stage list moves dates under files already open, which is
    // what publishing a new version exists to control. `.strict()` is what keeps
    // that true as fields are added.
    expect(parse({ label_fr: "a", weight: 20 }).success).toBe(false);
    expect(parse({ label_fr: "a", owner_tier: "CUSTOMS" }).success).toBe(false);
    expect(parse({ label_fr: "a", is_target_lock: true }).success).toBe(false);
    expect(parse({ label_fr: "a", min_duration_hours: 4 }).success).toBe(false);
  });
});
