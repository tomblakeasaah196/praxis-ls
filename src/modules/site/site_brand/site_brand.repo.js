"use strict";
/**
 * The website's brand layer: SQL only, every statement parameterised.
 *
 * Column lists are CLOSED arrays written here, never keys from a request body
 * (SEC H3): a body key that is not on the list is not written, whatever the
 * validator in front of it let through.
 */

/* ── photograph slots ───────────────────────────────────────────────────────*/

const listImages = async (client) =>
  (await client.query(
    `SELECT i.slot_key, i.image_id, i.vault_id, i.alt_en, i.alt_fr, i.updated_at,
            v.public_media_variants AS variants, v.public_media_provenance AS provenance
       FROM site_image i
       LEFT JOIN document_vault v
         ON v.doc_id = i.vault_id AND v.public_media_scope = 'SITE'
      ORDER BY i.slot_key`,
  )).rows;

const getImage = async (client, slotKey) =>
  (await client.query("SELECT * FROM site_image WHERE slot_key = $1", [slotKey])).rows[0] || null;

/** The row a slot's upload is addressed to, created the first time. */
async function ensureImage(client, slotKey, actorId) {
  const { rows } = await client.query(
    `INSERT INTO site_image (slot_key, updated_by) VALUES ($1, $2)
     ON CONFLICT (slot_key) DO UPDATE SET slot_key = EXCLUDED.slot_key
     RETURNING *`,
    [slotKey, actorId || null],
  );
  return rows[0];
}

async function setImageAlt(client, slotKey, { alt_en, alt_fr }, actorId) {
  const { rows } = await client.query(
    `INSERT INTO site_image (slot_key, alt_en, alt_fr, updated_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (slot_key) DO UPDATE
        SET alt_en = EXCLUDED.alt_en, alt_fr = EXCLUDED.alt_fr,
            updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING *`,
    [slotKey, alt_en ?? null, alt_fr ?? null, actorId || null],
  );
  return rows[0];
}

/** The public read: only slots holding a servable photograph. */
const publicImages = async (client) =>
  (await client.query(
    `SELECT i.slot_key, i.vault_id, i.alt_en, i.alt_fr, v.public_media_variants AS variants
       FROM site_image i
       JOIN document_vault v ON v.doc_id = i.vault_id
      WHERE v.status = 'VERIFIED'
        AND v.public_media_scope = 'SITE'
        AND v.public_media_role = 'ATMOSPHERE'
      ORDER BY i.slot_key`,
  )).rows;

/* ── documents ──────────────────────────────────────────────────────────────*/

const DOC_COLUMNS = [
  "doc_key", "kind", "sort_order",
  "title_en", "title_fr", "title_de",
  "summary_en", "summary_fr", "summary_de",
  "body_en", "body_fr", "body_de",
  "version_label", "effective_on", "approved_by",
];

const listDocuments = async (client) =>
  (await client.query("SELECT * FROM site_document ORDER BY kind DESC, sort_order, doc_key")).rows;

const getDocument = async (client, id) =>
  (await client.query("SELECT * FROM site_document WHERE document_id = $1", [id])).rows[0] || null;

const getDocumentByKey = async (client, key) =>
  (await client.query("SELECT * FROM site_document WHERE doc_key = $1", [key])).rows[0] || null;

async function createDocument(client, patch, actorId) {
  const cols = DOC_COLUMNS.filter((c) => patch[c] !== undefined);
  const vals = cols.map((c) => patch[c]);
  vals.push(actorId || null);
  const { rows } = await client.query(
    `INSERT INTO site_document (${[...cols, "updated_by"].join(", ")})
     VALUES (${vals.map((_, i) => `$${i + 1}`).join(", ")})
     RETURNING *`,
    vals,
  );
  return rows[0];
}

async function updateDocument(client, id, patch, actorId) {
  const cols = DOC_COLUMNS.filter((c) => patch[c] !== undefined);
  if (!cols.length) return getDocument(client, id);
  const vals = cols.map((c) => patch[c]);
  vals.push(actorId || null);
  const sets = cols.map((c, i) => `${c} = $${i + 1}`);
  sets.push(`updated_by = $${vals.length}`, "updated_at = now()");
  vals.push(id);
  const { rows } = await client.query(
    `UPDATE site_document SET ${sets.join(", ")} WHERE document_id = $${vals.length} RETURNING *`,
    vals,
  );
  return rows[0] || null;
}

const deleteDocument = async (client, id) =>
  (await client.query("DELETE FROM site_document WHERE document_id = $1", [id])).rowCount > 0;

/** Publish (a snapshot) or withdraw (null). The PDF key is always cleared: a
 *  PDF belongs to exactly one snapshot and is rendered again from the next. */
async function setPublished(client, id, snapshot, actorId) {
  const { rows } = await client.query(
    `UPDATE site_document
        SET published = $2::jsonb,
            published_at = CASE WHEN $2::jsonb IS NULL THEN NULL ELSE now() END,
            published_by = CASE WHEN $2::jsonb IS NULL THEN NULL ELSE $3::uuid END,
            pdf_key = NULL,
            updated_at = now()
      WHERE document_id = $1
      RETURNING *`,
    [id, snapshot ? JSON.stringify(snapshot) : null, actorId || null],
  );
  return rows[0] || null;
}

/** Recorded only against the snapshot it was rendered from, so a PDF finished
 *  after a newer Publish cannot attach itself to the newer copy. */
async function setPdfKey(client, id, publishedAt, key) {
  const { rowCount } = await client.query(
    `UPDATE site_document SET pdf_key = $3
      WHERE document_id = $1 AND published_at = $2`,
    [id, publishedAt, key],
  );
  return rowCount > 0;
}

const publishedDocuments = async (client) =>
  (await client.query(
    `SELECT document_id, doc_key, kind, sort_order, published, published_at, pdf_key
       FROM site_document
      WHERE published IS NOT NULL
      ORDER BY kind DESC, sort_order, doc_key`,
  )).rows;

/* ── the legal facts of the published companies ─────────────────────────────*/

/**
 * What an Impressum and a privacy notice must state about each company: who it
 * is, where it is registered, who represents it, how to reach it.
 *
 * Same gate as `publicEntities` (Decision Q1): a company is stated only while it
 * is public and ACTIVE on the lifecycle ladder.
 */
async function legalEntities(client) {
  const { rows } = await client.query(
    `SELECT entity_id, code, legal_name, trading_name, legal_form, country_code,
            address, email, phone, website, share_capital, share_capital_currency
       FROM corporate_entity
      WHERE public_enabled = true
        AND registration_status = 'ACTIVE'
      ORDER BY legal_name`,
  );
  if (!rows.length) return { entities: [], registrations: [], people: [], addresses: [] };
  const ids = rows.map((r) => r.entity_id);
  const registrations = (await client.query(
    `SELECT entity_id, kind, number, issuing_authority, country_code, is_primary
       FROM entity_registration
      WHERE entity_id = ANY($1::uuid[])
        AND number IS NOT NULL AND btrim(number) <> ''
        AND (expires_on IS NULL OR expires_on >= CURRENT_DATE)
      ORDER BY is_primary DESC, kind`,
    [ids],
  )).rows;
  const people = (await client.query(
    `SELECT entity_id, role, role_tags, full_name, title
       FROM entity_person
      WHERE entity_id = ANY($1::uuid[])
        AND is_active = true
        AND holder_type = 'PERSON'
        AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
        AND (role IN ('DIRECTOR', 'LEGAL_REPRESENTATIVE')
             OR role_tags && ARRAY['DIRECTOR', 'LEGAL_REPRESENTATIVE']::text[])
      ORDER BY (role = 'LEGAL_REPRESENTATIVE') DESC, full_name`,
    [ids],
  )).rows;
  const addresses = (await client.query(
    `SELECT entity_id, address_id, type, line1, line2, city, region, postal_code,
            country_code, po_box, is_primary, is_active, is_public,
            public_label_fr, public_label_en
       FROM entity_address
      WHERE entity_id = ANY($1::uuid[])
      ORDER BY is_primary DESC, type`,
    [ids],
  )).rows;
  return { entities: rows, registrations, people, addresses };
}

module.exports = {
  listImages, getImage, ensureImage, setImageAlt, publicImages,
  DOC_COLUMNS,
  listDocuments, getDocument, getDocumentByKey, createDocument, updateDocument,
  deleteDocument, setPublished, setPdfKey, publishedDocuments,
  legalEntities,
};
