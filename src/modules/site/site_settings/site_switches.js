"use strict";
/**
 * The website's switches (14600): the languages it offers and the optional
 * sections, every one of them off until a person turns it on.
 *
 * ── WHY THIS IS ITS OWN SMALL FILE ─────────────────────────────────────────
 *
 * Four modules read it: the website settings (which write it), the public
 * site reads (which decide what to serve), the service web profiles (which
 * decide which language a field needs) and the server-side head and sitemap.
 * `site_settings.service` pulls in the vault, the letterhead and the careers
 * repo; requiring all of that to learn "is French offered" would make every
 * caller depend on half the product. This file depends on the shared rule and
 * on its own SQL, and nothing else.
 *
 * Never null to a caller. 14600 seeds the singleton, and a database restored
 * without it reads as the defaults: English only, every section off, which is
 * also what the product ships.
 */

const { siteLanguages } = require("@praxis/shared");

const SWITCH_COLUMNS = [
  "top_rail",
  "portfolio",
  "corridors",
  "case_notes",
  "careers_in_header",
  "visitor_theme_switch",
];

const DEFAULTS = Object.freeze({
  languages: [...siteLanguages.DEFAULT_LANGUAGES],
  ...Object.fromEntries(SWITCH_COLUMNS.map((k) => [k, false])),
});

/** A stored row as the plain object every caller reads. */
function shape(row) {
  if (!row) return { ...DEFAULTS, languages: [...DEFAULTS.languages] };
  const out = { languages: siteLanguages.normaliseLanguages(row.languages) };
  for (const k of SWITCH_COLUMNS) out[k] = row[k] === true;
  return out;
}

async function loadRow(client) {
  const { rows } = await client.query("SELECT * FROM site_switches LIMIT 1");
  return rows[0] || null;
}

/** The switches, defaults filled in. */
async function load(client) {
  return shape(await loadRow(client));
}

/**
 * Write the fields present in `patch` and return the stored row.
 *
 * An upsert rather than an UPDATE, so a database restored without the seeded
 * singleton still saves instead of silently writing nothing.
 */
async function save(client, patch, actorId) {
  const cols = [];
  const vals = [];
  if (patch.languages !== undefined) {
    cols.push("languages");
    vals.push(siteLanguages.normaliseLanguages(patch.languages));
  }
  for (const k of SWITCH_COLUMNS) {
    if (patch[k] !== undefined) {
      cols.push(k);
      vals.push(patch[k] === true);
    }
  }
  vals.push(actorId || null);
  const insertCols = ["singleton", ...cols, "updated_by"];
  const placeholders = ["true", ...cols.map((_, i) => `$${i + 1}`), `$${vals.length}`];
  const sets = cols.map((c) => `${c} = EXCLUDED.${c}`);
  sets.push("updated_by = EXCLUDED.updated_by", "updated_at = now()");
  const { rows } = await client.query(
    `INSERT INTO site_switches (${insertCols.join(", ")})
          VALUES (${placeholders.join(", ")})
     ON CONFLICT (singleton) DO UPDATE SET ${sets.join(", ")}
       RETURNING *`,
    vals,
  );
  return rows[0] || null;
}

module.exports = { SWITCH_COLUMNS, DEFAULTS, shape, loadRow, load, save };
