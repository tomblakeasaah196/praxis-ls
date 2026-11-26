"use strict";
/**
 * The AI profile (14700): what AI assistants read about the company.
 *
 * One row, seeded by its migration, read three ways:
 *
 *   · by the settings screen (Settings › Website › AI Profile), whole;
 *   · by `/llms.txt` and `/llms-full.txt` (`src/shared/http/llms-txt.js`);
 *   · by the Organization structured data every public page carries
 *     (`public-head.organizationLd`): `alternateName`, `description`,
 *     `knowsAbout` and `areaServed`.
 *
 * NOTHING IS INVENTED. A profile without a summary is not published: `published`
 * answers null and every public reader treats that as "say nothing", so a
 * tenant who has not written one gets a 404 at /llms.txt rather than a file of
 * defaults that describe somebody else.
 *
 * Plain SQL with no requires, like `site_switches.js`, so the public head can
 * load it without pulling the settings service and its media graph in.
 */

const COLUMNS = [
  "summary",
  "alternate_names",
  "founded",
  "offices",
  "services_summary",
  "sectors",
  "areas_served",
  "credentials",
  "leadership",
  "not_offered",
  "contact",
  "reviewed_on",
];

/** `reviewed_on` as the ISO day the form and the API both carry. */
function shape(row) {
  if (!row) return null;
  const out = { ...row };
  if (out.reviewed_on instanceof Date) {
    // A `date` column arrives as local midnight; the parts are the day.
    const d = out.reviewed_on;
    out.reviewed_on = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0"),
    ].join("-");
  }
  for (const k of ["alternate_names", "sectors", "areas_served"]) {
    if (!Array.isArray(out[k])) out[k] = [];
  }
  return out;
}

async function load(client) {
  const { rows } = await client.query("SELECT * FROM site_ai_profile LIMIT 1");
  return shape(rows[0] || null);
}

async function save(client, patch, actorId) {
  const cols = COLUMNS.filter((c) => patch[c] !== undefined);
  if (!cols.length) return load(client);
  const vals = cols.map((c) => patch[c]);
  vals.push(actorId || null);
  const sets = cols.map((c, i) => `${c} = $${i + 1}`);
  sets.push(`updated_by = $${vals.length}`, "updated_at = now()");
  const { rows } = await client.query(
    `UPDATE site_ai_profile SET ${sets.join(", ")} WHERE singleton = true RETURNING *`,
    vals,
  );
  return shape(rows[0] || null);
}

/**
 * The profile as the public may read it, or null when there is nothing to
 * publish. Never throws: a tenant database that predates 14700 has no table,
 * and the public pages must render without it.
 */
async function published(client) {
  const row = await load(client).catch(() => null);
  if (!row || !String(row.summary || "").trim()) return null;
  // The fields and the edit date; never the row's id or who edited it.
  const out = { updated_at: row.updated_at || null };
  for (const c of COLUMNS) out[c] = row[c];
  return out;
}

module.exports = { COLUMNS, load, save, published, shape };
