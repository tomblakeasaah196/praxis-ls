"use strict";
/**
 * Company Profile — every query the module runs (guide §4.7).
 *
 * Four groups: the singleton's DERIVED figures, versions and their sections,
 * the client logo library, and share links with their opens. Nothing here
 * decides anything; the service does.
 */

const { TOTAL_COL, splitTotal, page } = require("../../../shared/db/query-helpers");

const JSONB_COLUMNS = new Set([
  "fleet_composition", "top_lanes", "vertical_mix", "office_list", "gateway_list", "region_list",
]);
const DERIVED_COLUMNS = new Set([
  "fleet_count", "fleet_composition", "warehouse_capacity", "warehouse_count", "top_lanes",
  "vertical_mix", "average_clearance_hours", "client_count", "turnover_band",
  "office_list", "gateway_list", "region_list", "computed_at",
]);

/* ── the singleton: derived figures only ─────────────────────────────────── */

const getSingleton = async (c) =>
  (await c.query("SELECT * FROM company_profile WHERE singleton = true")).rows[0] || null;

/** Write derived columns. Names come from the closed set above, never a request. */
async function updateDerived(c, fields) {
  const keys = Object.keys(fields).filter((k) => DERIVED_COLUMNS.has(k));
  if (!keys.length) return getSingleton(c);
  const vals = keys.map((k) => {
    const v = fields[k];
    return JSONB_COLUMNS.has(k) && v !== null && v !== undefined
      ? (typeof v === "string" ? v : JSON.stringify(v)) : v;
  });
  const set = keys.map((k, i) => `"${k}"=$${i + 1}`).join(",");
  await c.query("INSERT INTO company_profile (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING");
  return (await c.query(`UPDATE company_profile SET ${set}, updated_at = now() WHERE singleton = true RETURNING *`, vals)).rows[0];
}

/**
 * What the tenant's own records say. Counts, names and places only: nothing
 * commercial is read here, so nothing commercial can reach a profile.
 */
async function derived(c) {
  const q = `SELECT
  (SELECT count(*)::int FROM vehicle WHERE status='ACTIVE') fleet_count,
  (SELECT COALESCE(jsonb_object_agg(category,n),'{}') FROM (SELECT COALESCE(category,'Unspecified') category,count(*) n FROM vehicle WHERE status='ACTIVE' GROUP BY category)v) fleet_composition,
  (SELECT COALESCE(sum(capacity_units),0) FROM warehouse_location) warehouse_capacity,
  (SELECT count(*)::int FROM entity_establishment WHERE is_active AND kind = 'WAREHOUSE') warehouse_count,
  (SELECT COALESCE(jsonb_agg(x),'[]') FROM (SELECT pol origin,pod destination,count(*) frequency FROM dossier_visible WHERE pol IS NOT NULL AND pod IS NOT NULL GROUP BY pol,pod ORDER BY frequency DESC LIMIT 10)x) top_lanes,
  (SELECT COALESCE(jsonb_agg(x),'[]') FROM (SELECT COALESCE(st.name_en,st.name_fr) service, COALESCE(NULLIF(BTRIM(d.commodity_desc),''), NULLIF(BTRIM(d.commodity),''), 'Unspecified') commodity, count(*) frequency FROM dossier_visible d JOIN service_type st ON st.service_type_id=d.service_type_id GROUP BY COALESCE(st.name_en,st.name_fr), COALESCE(NULLIF(BTRIM(d.commodity_desc),''), NULLIF(BTRIM(d.commodity),''), 'Unspecified') ORDER BY frequency DESC, service, commodity)x) vertical_mix,
  (SELECT round(avg(extract(epoch FROM (done.completed_at-started.created_at))/3600)::numeric,2) FROM milestone_instance done JOIN dossier_visible d USING(dossier_id) JOIN LATERAL (SELECT created_at FROM milestone_instance mi WHERE mi.dossier_id=d.dossier_id ORDER BY stage_seq LIMIT 1) started ON true WHERE done.status='DONE' AND done.code ILIKE '%clear%') average_clearance_hours,
  (SELECT count(*)::int FROM client_master WHERE is_active) client_count,
  (SELECT CASE WHEN COALESCE(sum(jl.credit),0)<100000000 THEN '<100M XAF' WHEN sum(jl.credit)<500000000 THEN '100M-500M XAF' WHEN sum(jl.credit)<1000000000 THEN '500M-1B XAF' ELSE '1B+ XAF' END FROM journal_line jl JOIN journal_entry je USING(entry_id) WHERE je.status='validated' AND jl.account_code LIKE '7%') turnover_band,
  (SELECT COALESCE(jsonb_agg(x ORDER BY x.head DESC, x.name),'[]') FROM (SELECT es.name, es.city, es.country_code country, es.kind, (es.kind = 'HEAD_OFFICE') head FROM entity_establishment es WHERE es.is_active AND es.kind <> 'WAREHOUSE')x) office_list,
  (SELECT COALESCE(jsonb_agg(x ORDER BY x.frequency DESC, x.name),'[]') FROM (SELECT g.name, g.country, g.kind, count(*)::int frequency FROM (SELECT pol_place_id place_id FROM dossier_visible WHERE pol_place_id IS NOT NULL UNION ALL SELECT pod_place_id FROM dossier_visible WHERE pod_place_id IS NOT NULL) r JOIN geo_place g ON g.geo_place_id = r.place_id WHERE g.kind IN ('SEAPORT','AIRPORT','INLAND') GROUP BY g.name, g.country, g.kind ORDER BY frequency DESC, g.name LIMIT 8)x) gateway_list,
  (SELECT COALESCE(jsonb_agg(code ORDER BY code),'[]') FROM (SELECT DISTINCT upper(btrim(country)) code FROM (SELECT g.country FROM dossier_visible d JOIN geo_place g ON g.geo_place_id IN (d.pol_place_id, d.pod_place_id) UNION ALL SELECT country_code FROM entity_establishment WHERE is_active UNION ALL SELECT country_code FROM corporate_entity) all_c WHERE country IS NOT NULL AND length(btrim(country)) = 2)x) region_list`;
  return (await c.query(q)).rows[0];
}

/* ── versions ─────────────────────────────────────────────────────────────── */

const VERSION_COLS = `v.*, cu.full_name AS created_by_name, pu.full_name AS published_by_name`;
const VERSION_FROM = `company_profile_version v
  LEFT JOIN app_user cu ON cu.user_id = v.created_by
  LEFT JOIN app_user pu ON pu.user_id = v.published_by`;

const listVersions = async (c) =>
  (await c.query(`SELECT ${VERSION_COLS} FROM ${VERSION_FROM} ORDER BY v.number DESC`)).rows;
const getVersion = async (c, id) =>
  (await c.query(`SELECT ${VERSION_COLS} FROM ${VERSION_FROM} WHERE v.version_id = $1`, [id])).rows[0] || null;
const byStatus = async (c, status, { lock = false } = {}) =>
  (await c.query(`SELECT * FROM company_profile_version WHERE status = $1${lock ? " FOR UPDATE" : ""}`, [status])).rows[0] || null;
/** The version a share follows: pinned, or the published one when it is opened. */
const previousOf = async (c, number) =>
  (await c.query("SELECT * FROM company_profile_version WHERE number < $1 ORDER BY number DESC LIMIT 1", [number])).rows[0] || null;

async function insertVersion(c, { createdBy }) {
  const { rows } = await c.query(
    `INSERT INTO company_profile_version (number, status, created_by)
     SELECT COALESCE(max(number), 0) + 1, 'DRAFT', $1 FROM company_profile_version
     RETURNING *`,
    [createdBy],
  );
  return rows[0];
}

async function publishVersion(c, id, { changeNote, publishedBy }) {
  const { rows } = await c.query(
    `UPDATE company_profile_version
        SET status = 'PUBLISHED', change_note = $2, published_by = $3, published_at = now()
      WHERE version_id = $1 AND status = 'DRAFT' RETURNING *`,
    [id, changeNote, publishedBy],
  );
  return rows[0] || null;
}

const supersedePublished = (c) => c.query(
  "UPDATE company_profile_version SET status = 'SUPERSEDED', superseded_at = now() WHERE status = 'PUBLISHED'",
);

/* ── sections ─────────────────────────────────────────────────────────────── */

const sections = async (c, versionId) =>
  (await c.query("SELECT * FROM company_profile_section WHERE version_id = $1", [versionId])).rows;

async function insertSection(c, { versionId, key, structure, textEn, textFr, updatedBy }) {
  await c.query(
    `INSERT INTO company_profile_section (version_id, section_key, structure, text_en, text_fr, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (version_id, section_key) DO NOTHING`,
    [versionId, key, JSON.stringify(structure || {}), JSON.stringify(textEn || {}), JSON.stringify(textFr || {}), updatedBy],
  );
}

async function updateSection(c, { versionId, key, structure, textEn, textFr, updatedBy }) {
  const { rows } = await c.query(
    `UPDATE company_profile_section
        SET structure = $3, text_en = $4, text_fr = $5, updated_by = $6, updated_at = now()
      WHERE version_id = $1 AND section_key = $2 RETURNING *`,
    [versionId, key, JSON.stringify(structure), JSON.stringify(textEn), JSON.stringify(textFr), updatedBy],
  );
  return rows[0] || null;
}

/* ── what a section may point at ─────────────────────────────────────────── */

/** Service types published on the website, with their own short description. */
async function publishedServices(c) {
  const { rows } = await c.query(
    `SELECT st.service_type_id, st.name_en, st.name_fr,
            w.short_description_en, w.short_description_fr, w.sort_order
       FROM service_type st
       JOIN service_type_web_profile w ON w.service_type_id = st.service_type_id
      WHERE w.is_published = true AND st.is_active = true
      ORDER BY w.sort_order, COALESCE(st.name_en, st.name_fr)`,
  );
  return rows;
}

/**
 * Published success stories, consent respected: the client is named only when
 * they said NAMED, exactly as the website Portfolio does.
 */
async function publishedStories(c, ids = null) {
  const params = [];
  let filter = "";
  if (ids) {
    params.push(ids);
    filter = " AND s.success_story_id = ANY($1::uuid[])";
  }
  const { rows } = await c.query(
    `SELECT s.success_story_id, s.slug, s.title, s.headline, s.executive_summary, s.kpis,
            s.service_category, s.published_at,
            CASE WHEN cm.public_reference_consent = 'NAMED'
                 THEN COALESCE(cm.legal_name, cm.name) END AS client_name
       FROM success_story s
       LEFT JOIN client_master cm ON cm.client_id = s.client_id
      WHERE s.is_published = true${filter}
      ORDER BY s.published_at DESC NULLS LAST, s.title`,
    params,
  );
  return rows;
}

const vaultDocsExist = async (c, ids) => {
  if (!ids.length) return [];
  return (await c.query("SELECT doc_id FROM document_vault WHERE doc_id = ANY($1::uuid[])", [ids])).rows.map((r) => r.doc_id);
};

/** The first corporate entity, with its primary address: what Contact prints. */
async function contactFacts(c) {
  const { rows } = await c.query(
    `SELECT ce.entity_id, ce.legal_name, ce.trading_name, ce.email, ce.phone, ce.website, ce.country_code,
            (SELECT concat_ws(', ', NULLIF(btrim(a.line1), ''), NULLIF(btrim(a.city), ''))
               FROM entity_address a WHERE a.entity_id = ce.entity_id AND a.is_active
              ORDER BY a.is_primary DESC, a.type LIMIT 1) AS address
       FROM corporate_entity ce ORDER BY ce.created_at LIMIT 1`,
  );
  return rows[0] || null;
}

/* ── logos ────────────────────────────────────────────────────────────────── */

const listLogos = async (c) =>
  (await c.query("SELECT * FROM company_profile_logo ORDER BY retired_at IS NOT NULL, lower(name)")).rows;
const logosByIds = async (c, ids) => (ids.length
  ? (await c.query("SELECT * FROM company_profile_logo WHERE logo_id = ANY($1::uuid[])", [ids])).rows
  : []);
const getLogo = async (c, id) =>
  (await c.query("SELECT * FROM company_profile_logo WHERE logo_id = $1", [id])).rows[0] || null;

async function insertLogo(c, row) {
  const { rows } = await c.query(
    `INSERT INTO company_profile_logo (name, storage_key, content_type, content_hash, bytes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [row.name, row.storage_key, row.content_type, row.content_hash, row.bytes, row.created_by],
  );
  return rows[0];
}

async function retireLogo(c, id, retiredBy) {
  const { rows } = await c.query(
    `UPDATE company_profile_logo SET retired_at = now(), retired_by = $2
      WHERE logo_id = $1 AND retired_at IS NULL RETURNING *`,
    [id, retiredBy],
  );
  return rows[0] || null;
}

/* ── shares ───────────────────────────────────────────────────────────────── */

const SHARE_COLS = `s.share_id, s.recipient_name, s.recipient_email, s.lead_id, s.version_id, s.language,
  s.expires_at, s.revoked_at, s.created_at, s.created_by, s.first_opened_at, s.last_opened_at,
  s.open_count, s.downloaded_at, v.number AS version_number,
  l.company_name AS lead_name, u.full_name AS created_by_name`;
const SHARE_FROM = `company_profile_share s
  LEFT JOIN company_profile_version v ON v.version_id = s.version_id
  LEFT JOIN lead l ON l.lead_id = s.lead_id
  LEFT JOIN app_user u ON u.user_id = s.created_by`;

async function listShares(c, query = {}) {
  const { limit, offset } = page(query);
  const params = [];
  const where = [];
  if (query.lead_id) {
    params.push(query.lead_id);
    where.push(`s.lead_id = $${params.length}`);
  }
  params.push(limit, offset);
  const { rows } = await c.query(
    `SELECT ${SHARE_COLS}, ${TOTAL_COL} FROM ${SHARE_FROM}
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY s.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return splitTotal(rows);
}

const getShare = async (c, id) =>
  (await c.query(`SELECT ${SHARE_COLS} FROM ${SHARE_FROM} WHERE s.share_id = $1`, [id])).rows[0] || null;
const shareByHash = async (c, hash) =>
  (await c.query("SELECT * FROM company_profile_share WHERE token_hash = $1", [hash])).rows[0] || null;
const leadExists = async (c, id) =>
  (await c.query("SELECT lead_id, company_name, owner_user_id FROM lead WHERE lead_id = $1", [id])).rows[0] || null;

async function insertShare(c, row) {
  const { rows } = await c.query(
    `INSERT INTO company_profile_share
       (token_hash, recipient_name, recipient_email, lead_id, version_id, language, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING share_id`,
    [row.token_hash, row.recipient_name, row.recipient_email, row.lead_id, row.version_id, row.language, row.expires_at, row.created_by],
  );
  return rows[0];
}

async function revokeShare(c, id, revokedBy) {
  const { rows } = await c.query(
    `UPDATE company_profile_share SET revoked_at = now(), revoked_by = $2
      WHERE share_id = $1 AND revoked_at IS NULL RETURNING share_id`,
    [id, revokedBy],
  );
  return rows[0] || null;
}

/**
 * Record one open. Returns whether it was the FIRST, decided by the same
 * statement that stamps it, so two simultaneous first opens notify once.
 */
async function recordOpen(c, shareId, { kind, agentLabel, visitorHash }) {
  await c.query(
    `INSERT INTO company_profile_share_open (share_id, kind, agent_label, visitor_hash) VALUES ($1, $2, $3, $4)`,
    [shareId, kind, agentLabel, visitorHash],
  );
  const { rows } = await c.query(
    `UPDATE company_profile_share s
        SET open_count = s.open_count + CASE WHEN $2 = 'VIEW' THEN 1 ELSE 0 END,
            last_opened_at = now(),
            first_opened_at = COALESCE(s.first_opened_at, now()),
            downloaded_at = CASE WHEN $2 = 'DOWNLOAD' THEN COALESCE(s.downloaded_at, now()) ELSE s.downloaded_at END
       FROM (SELECT first_opened_at AS before FROM company_profile_share WHERE share_id = $1 FOR UPDATE) prev
      WHERE s.share_id = $1
      RETURNING prev.before IS NULL AS first`,
    [shareId, kind],
  );
  return Boolean(rows[0] && rows[0].first);
}

const listOpens = async (c, shareId) =>
  (await c.query(
    `SELECT open_id, kind, opened_at, agent_label FROM company_profile_share_open
      WHERE share_id = $1 ORDER BY opened_at DESC LIMIT 50`,
    [shareId],
  )).rows;

module.exports = {
  getSingleton, updateDerived, derived,
  listVersions, getVersion, byStatus, previousOf, insertVersion, publishVersion, supersedePublished,
  sections, insertSection, updateSection,
  publishedServices, publishedStories, vaultDocsExist, contactFacts,
  listLogos, logosByIds, getLogo, insertLogo, retireLogo,
  listShares, getShare, shareByHash, leadExists, insertShare, revokeShare, recordOpen, listOpens,
};
