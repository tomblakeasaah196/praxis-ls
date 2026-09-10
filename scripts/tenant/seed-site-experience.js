#!/usr/bin/env node
/**
 * Seed one tenant's website content — theme, group About, leadership and the
 * partner list — from a JSON profile.
 *
 *   node scripts/tenant/seed-site-experience.js --slug=smartls --profile=smartls [--force]
 *
 * ── WHY THIS IS A SCRIPT AND NOT A MIGRATION SEED ──────────────────────────
 *
 * `migrations/seeds/*.sql` run for EVERY tenant. The content here is one
 * company's: a founding year, a headquarters, a named chief executive, a
 * mission somebody wrote. Putting it in a shared seed would publish
 * "Founded in 2021 in Douala" onto the About page of every tenant this product
 * ever provisions — facts about businesses that are not theirs, which is
 * exactly what `doc/WEB_BUILD_BRIEF.md` N12 forbids and the single worst
 * failure mode a white-label product has.
 *
 * 9085 already draws this line: it seeds the home page as generic scaffolding,
 * unpublished, with no claim in it. This is the other half — real content, one
 * tenant, run deliberately by a person who knows whose content it is.
 *
 * ── PARTNERS ARE SEEDED INACTIVE, AND THAT IS NOT AN OVERSIGHT ─────────────
 *
 * `site_partner.is_active` defaults false and `ck_site_partner_active_needs_
 * permission` refuses to flip it without a written permission note. These are
 * other companies' trademarks — GIZ is a German federal agency, CMA CGM
 * operates a written-permission regime — and no script gets to decide that
 * clearance exists. The rows arrive as a prepared list for somebody to activate
 * once they have the paperwork.
 *
 * ── IDEMPOTENT, AND IT DOES NOT CLOBBER ────────────────────────────────────
 *
 * Same rule as seed-branding.js: by default nothing already set is overwritten,
 * so re-running after a tenant has edited their own copy is safe. `--force`
 * overwrites, which is what you want on a workspace being reset for a demo and
 * never on a live one.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const m = require("../../src/services/platform/migrator");

const args = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const mm = s.match(/^--([^=]+)=(.*)$/);
    return mm ? [mm[1], mm[2]] : [s.replace(/^--/, ""), true];
  }),
);

const slug = args.slug;
const profile = args.profile || slug;
const force = args.force === true;

if (!slug) {
  console.error(
    "usage: node scripts/tenant/seed-site-experience.js --slug=<tenant-slug> [--profile=<name>] [--force]",
  );
  process.exit(1);
}

const profilePath = path.join(__dirname, "data", `${profile}-site.json`);
if (!fs.existsSync(profilePath)) {
  console.error(`[praxis-db] no profile at ${profilePath}`);
  console.error("            profiles are JSON in scripts/tenant/data/<name>-site.json");
  process.exit(1);
}
const DATA = JSON.parse(fs.readFileSync(profilePath, "utf8"));

/** COALESCE-style write: only fills a column that is currently NULL, unless
 *  --force. Keeps a tenant's own edits, which is the whole point of making this
 *  content parametric in the first place. */
const keepOrSet = (col) =>
  force ? `${col} = $$${col}$$` : `${col} = COALESCE(${col}, $$${col}$$)`;

(async () => {
  const cli = m.client(m.tenantDbName(slug), { superuser: true });
  await cli.connect();
  try {
    // LIVE only. The sandbox is a rehearsal space; seeding marketing copy there
    // helps nobody and doubles the rows a demo reset has to clear.
    await cli.query("SET search_path = live, public");

    /* ── theme ─────────────────────────────────────────────────────────── */
    if (DATA.theme) {
      const cols = Object.keys(DATA.theme);
      const sets = cols.map((c, i) => (force ? `${c} = $${i + 1}` : `${c} = COALESCE(NULLIF(${c}, ''), $${i + 1})`));
      // Numeric and enum columns cannot take the NULLIF(...,'') trick, so on a
      // non-forced run they are simply left alone — a tenant who set a radius
      // meant it.
      const safeSets = cols.map((c, i) =>
        force || ["primary_hex", "secondary_hex", "tertiary_hex", "font_display", "font_body", "font_mono"].includes(c)
          ? sets[i]
          : `${c} = ${c}`,
      );
      await cli.query(
        `UPDATE site_theme SET ${safeSets.join(", ")}, updated_at = now() WHERE singleton = true`,
        cols.map((c) => DATA.theme[c]),
      );
      console.warn(`[praxis-db] theme ${force ? "written" : "written (existing kept)"}`);
    }

    /* ── group About ───────────────────────────────────────────────────── */
    if (DATA.about) {
      const a = DATA.about;
      const textCols = [
        "headline_fr", "headline_en", "summary_fr", "summary_en",
        "mission_fr", "mission_en", "vision_fr", "vision_en", "headquarters",
      ].filter((c) => a[c] !== undefined);
      const jsonCols = ["principles", "esg", "timeline"].filter((c) => a[c] !== undefined);

      const params = [];
      const sets = [];
      for (const c of textCols) {
        params.push(a[c]);
        sets.push(force ? `${c} = $${params.length}` : `${c} = COALESCE(${c}, $${params.length})`);
      }
      for (const c of jsonCols) {
        params.push(JSON.stringify(a[c]));
        // '[]' and '{}' are the migration's defaults and therefore mean "unset"
        // here — a tenant who has written principles has a non-empty array.
        sets.push(
          force
            ? `${c} = $${params.length}::jsonb`
            : `${c} = CASE WHEN ${c} IS NULL OR ${c} IN ('[]'::jsonb, '{}'::jsonb) THEN $${params.length}::jsonb ELSE ${c} END`,
        );
      }
      if (a.founded_year !== undefined) {
        params.push(a.founded_year);
        sets.push(force ? `founded_year = $${params.length}` : `founded_year = COALESCE(founded_year, $${params.length})`);
      }
      await cli.query(
        `UPDATE site_about SET ${sets.join(", ")}, updated_at = now() WHERE singleton = true`,
        params,
      );
      console.warn(`[praxis-db] about ${force ? "written" : "written (existing kept)"}`);
    }

    /* ── leadership ────────────────────────────────────────────────────── */
    let leaders = 0;
    for (const l of DATA.leaders || []) {
      // Matched on name at the GROUP tier, so re-running does not duplicate a
      // chief executive. Photographs are never seeded — N12 and guide §1.3: a
      // portrait is a real photograph of a real person, uploaded deliberately.
      const res = await cli.query(
        `INSERT INTO site_leader (entity_id, full_name, role_fr, role_en, bio_fr, bio_en, sort_order)
         SELECT NULL, $1, $2, $3, $4, $5, $6
          WHERE NOT EXISTS (
            SELECT 1 FROM site_leader WHERE entity_id IS NULL AND full_name = $1
          )`,
        [l.full_name, l.role_fr || null, l.role_en || null, l.bio_fr || null, l.bio_en || null, l.sort_order || 0],
      );
      leaders += res.rowCount || 0;
    }
    if (DATA.leaders) console.warn(`[praxis-db] leaders: ${leaders} added, ${DATA.leaders.length - leaders} already present`);

    /* ── partners ──────────────────────────────────────────────────────── */
    let partners = 0;
    for (const p of DATA.partners || []) {
      // is_active is NOT set. See the header: clearance for a third-party mark
      // is not a decision a seed script is entitled to make.
      const res = await cli.query(
        `INSERT INTO site_partner (name, kind, sort_order)
         SELECT $1, $2, $3
          WHERE NOT EXISTS (SELECT 1 FROM site_partner WHERE name = $1)`,
        [p.name, p.kind, p.sort_order || 0],
      );
      partners += res.rowCount || 0;
    }
    if (DATA.partners) {
      console.warn(`[praxis-db] partners: ${partners} added, ${DATA.partners.length - partners} already present`);
      console.warn("[praxis-db]   all INACTIVE — record who cleared each mark in Settings › Website before showing it");
    }

    console.warn(`[praxis-db] website experience seeded for '${slug}' from profile '${profile}' ✓`);
  } finally {
    await cli.end();
  }
})()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[praxis-db] site experience seed FAILED:", e.message || String(e));
    process.exit(1);
  });
