"use strict";
/**
 * A seed's NUMBER decides which database it runs against. Getting it wrong is
 * invisible until CI has a live Postgres.
 *
 * ── THE FAILURE THIS PINS ──────────────────────────────────────────────────
 *
 * `migrator.files` partitions one directory by numeric prefix:
 *
 *     tenantSeeds:   /^90/    applied to EVERY tenant schema (live + sandbox)
 *     platformSeeds: /^91/    applied ONCE to the platform database
 *
 * Nothing in the filename says which, and the two ranges sit side by side in
 * `migrations/seeds/`. A tenant seed numbered 91xx is therefore run against the
 * platform database, where none of its tables exist:
 *
 *     [praxis-db] platform migration FAILED:
 *       Failed applying seeds/9160_seed_milestone_owners.sql [platform-seed]:
 *       relation "milestone_owner" does not exist
 *
 * That is a real red `migrations` job (PR #539), and it is the ONLY job that can
 * see it: `scripts/ci-local.js` skips provisioning because it needs a live
 * Postgres, so every other gate — migration numbering, idempotency,
 * reversibility, schema drift — passed on the broken file. The number was picked
 * by looking for the highest seed in the directory, which happened to be a
 * PLATFORM one (9150).
 *
 * ── WHAT MAKES IT CHECKABLE ────────────────────────────────────────────────
 *
 * Every platform seed schema-qualifies every write as `platform.<table>` — all
 * seventeen of them, with no exceptions — because the platform migration runs
 * with no tenant schema on the search path. Tenant seeds never do, because a
 * tenant's tables are reached unqualified through `search_path`. So the prefix
 * and the qualification have to agree, and when they disagree the file is in the
 * wrong range. That is the whole check.
 */
const fs = require("fs");
const path = require("path");

const SEEDS = path.join(__dirname, "..", "..", "migrations", "seeds");

/**
 * Writes, with the table they target.
 *
 * Comments are stripped so prose does not count, and `ON CONFLICT … DO UPDATE
 * SET` is removed BEFORE matching: its `UPDATE` is a clause, not a statement,
 * and reading it as one reports a write to a table called "SET" on ten of the
 * seventeen platform seeds.
 */
function writes(sql) {
  const code = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .replace(/\bDO\s+UPDATE\s+SET\b/gi, " ");
  return [...code.matchAll(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z_][\w.]*)/gi)]
    .map((m) => m[1])
    // A CTE or sub-select can put a bare keyword here; only real identifiers count.
    .filter((t) => !/^(set|only|from|where|select)$/i.test(t));
}

const files = fs.readdirSync(SEEDS).filter((f) => f.endsWith(".sql"));
const tenant = files.filter((f) => /^90/.test(f));
const platform = files.filter((f) => /^91/.test(f));

describe("a seed's prefix matches the database it writes to", () => {
  it("has files in both ranges, so neither case passes vacuously", () => {
    expect(tenant.length).toBeGreaterThan(10);
    expect(platform.length).toBeGreaterThan(10);
    // Every seed is in one range or the other — a 92xx file would be applied by
    // nothing at all, silently.
    expect(files.length).toBe(tenant.length + platform.length);
  });

  it.each(platform)("%s is in the 91xx range and writes only to platform.*", (file) => {
    const bad = writes(fs.readFileSync(path.join(SEEDS, file), "utf8")).filter(
      (t) => !t.toLowerCase().startsWith("platform."),
    );
    expect(
      bad.length
        ? `${file} is a PLATFORM seed (91xx) but writes to unqualified ${[...new Set(bad)].join(", ")}.\n` +
          "The platform migration runs with no tenant schema on the search path, so those tables\n" +
          "do not exist there. If this is tenant data, RENUMBER it into the 90xx range."
        : "",
    ).toBe("");
  });

  it.each(tenant)("%s is in the 90xx range and writes to no platform table", (file) => {
    const bad = writes(fs.readFileSync(path.join(SEEDS, file), "utf8")).filter((t) =>
      t.toLowerCase().startsWith("platform."),
    );
    expect(
      bad.length
        ? `${file} is a TENANT seed (90xx) but writes to ${[...new Set(bad)].join(", ")}.\n` +
          "Tenant seeds are applied once per tenant schema; a platform write would run once per\n" +
          "tenant. If this is platform data, RENUMBER it into the 91xx range."
        : "",
    ).toBe("");
  });
});
