"use strict";
/**
 * The website's brand layer (14660, doc/smartls-website/ENGINEERING_GUIDE.md
 * PR 4): photograph slots, trust documents with a Publish button and a
 * designed PDF, and the legal facts an Impressum is built from.
 *
 * ── THE PUBLIC READS ARE ALLOW-LISTS ───────────────────────────────────────
 *
 * Same rule as `site_settings.service`: every stranger-facing read builds its
 * object field by field. The legal read is the one place on the public site
 * that states register numbers, and it states exactly the two a law requires
 * (the trade register and the VAT number); NIU, EORI and every other
 * identifier on `entity_registration` stay inside the building.
 */

const { atomically } = require("../../../shared/db/tx");
const { audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const storage = require("../../../services/storage.service");
const letterhead = require("../../master/entity-letterhead.service");
const media = require("../site_settings/site_settings.media");
const repo = require("./site_brand.repo");
const events = require("./site_brand.events");
const pdfTemplate = require("./site_brand.pdf");
const indexNow = require("../../../shared/http/indexnow");
const { siteBrand, countries } = require("@praxis/shared");

const ref = (kind, id) => `${kind}:${id}`;
const filled = (v) => v !== null && v !== undefined && String(v).trim() !== "";

/* ── the tenant's required language ─────────────────────────────────────────*/

/**
 * "en" for a tenant that offers only English, "fr" when French is offered.
 * PR 1's switch decides it (`site_switches`, `siteLanguages.requiredLanguage`);
 * read lazily so this module loads on a database that predates the switch.
 */
async function requiredLanguage(client) {
  const switches = await require("../site_settings/site_switches").load(client);
  return require("@praxis/shared").siteLanguages.requiredLanguage(switches);
}

/* ── photograph slots ───────────────────────────────────────────────────────*/

/**
 * Every slot an editor can fill: the registry, then one per active service
 * family, each with whatever the database holds for it. A slot nobody has
 * touched is listed with no image, so the screen can offer it.
 */
async function listImages(client) {
  const rows = await repo.listImages(client);
  const byKey = new Map(rows.map((r) => [r.slot_key, r]));
  const { rows: families } = await client.query(
    `SELECT key, name_en, name_fr FROM service_type_web_group WHERE is_active = true ORDER BY sort_order, key`,
  );
  const slots = [
    ...Object.entries(siteBrand.SITE_IMAGE_SLOTS).map(([key, spec]) => ({ key, ...spec })),
    ...families
      .map((f) => ({
        key: `family-${String(f.key).toLowerCase()}`,
        page: "services",
        label: `Service Family: ${f.name_en || f.name_fr}`,
        aspect: "16:9",
      }))
      .filter((s) => siteBrand.isImageSlot(s.key)),
  ];
  return slots.map((s) => {
    const r = byKey.get(s.key);
    return {
      ...s,
      image_id: r ? r.image_id : null,
      doc_id: (r && r.vault_id) || null,
      variants: (r && r.variants) || null,
      provenance: (r && r.provenance) || null,
      alt_en: (r && r.alt_en) || null,
      alt_fr: (r && r.alt_fr) || null,
      updated_at: r ? r.updated_at : null,
    };
  });
}

function assertSlot(slotKey) {
  if (!siteBrand.isImageSlot(slotKey)) {
    throw new AppError("NOT_FOUND", "There is no photograph slot by that name", 404);
  }
}

async function setImageAlt(client, { slotKey, patch, actor = {} }) {
  assertSlot(slotKey);
  return atomically(client, async () => {
    const before = await repo.getImage(client, slotKey);
    const row = await repo.setImageAlt(client, slotKey, patch, actor.user_id);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.IMAGE_UPDATED,
      moduleKey: events.MODULE,
      entityRef: ref("site_image", slotKey),
      before,
      after: row,
    });
    return row;
  });
}

/**
 * Put a photograph in a slot, through the one website-media pipeline: sniffed
 * type, size and width caps, AVIF and WebP derivatives, the replaced picture
 * archived. The alt text travels with the upload so a new picture is never
 * left described as the old one.
 */
async function uploadImage(client, { slotKey, body, actor = {}, slug }) {
  assertSlot(slotKey);
  const row = await repo.ensureImage(client, slotKey, actor.user_id);
  if (body.alt_en !== undefined || body.alt_fr !== undefined) {
    await repo.setImageAlt(client, slotKey, {
      alt_en: body.alt_en !== undefined ? body.alt_en : row.alt_en,
      alt_fr: body.alt_fr !== undefined ? body.alt_fr : row.alt_fr,
    }, actor.user_id);
  }
  const done = await media.upload(client, {
    slot: "site-image",
    ownerId: row.image_id,
    dataUrl: body.data_url,
    originalName: body.original_name,
    provenance: body.provenance,
    actor,
    slug,
  });
  return { slot_key: slotKey, image_id: row.image_id, doc_id: done.doc_id, variants: done.variants };
}

async function removeImage(client, { slotKey, actor = {} }) {
  assertSlot(slotKey);
  const row = await repo.getImage(client, slotKey);
  if (!row || !row.vault_id) return { slot_key: slotKey, doc_id: null };
  await media.remove(client, { slot: "site-image", ownerId: row.image_id, actor });
  return { slot_key: slotKey, doc_id: null };
}

/** `{ slot_key: { id, variants, alt: {en, fr} } }`: what a page needs to draw. */
async function publicImages(client) {
  const rows = await repo.publicImages(client);
  return Object.fromEntries(rows.map((r) => [r.slot_key, {
    id: r.vault_id,
    variants: r.variants || null,
    alt: { en: r.alt_en || null, fr: r.alt_fr || null },
  }]));
}

/* ── documents ──────────────────────────────────────────────────────────────*/

/** The fields a snapshot freezes, per language. */
function snapshotOf(doc) {
  const langs = {};
  for (const lang of siteBrand.DOCUMENT_LANGS) {
    if (!filled(doc[`title_${lang}`])) continue;
    langs[lang] = {
      title: doc[`title_${lang}`].trim(),
      summary: filled(doc[`summary_${lang}`]) ? doc[`summary_${lang}`].trim() : null,
      body: doc[`body_${lang}`] || "",
    };
  }
  return {
    langs,
    version_label: doc.version_label || null,
    effective_on: doc.effective_on ? String(doc.effective_on).slice(0, 10) : null,
    approved_by: doc.approved_by || null,
  };
}

/**
 * Where a document stands, in the three words the settings screen shows:
 * DRAFT (never published, or withdrawn), PUBLISHED (the site shows exactly the
 * draft), CHANGED (published, and the draft has moved on since).
 */
function statusOf(doc) {
  if (!doc.published) return "DRAFT";
  const now = snapshotOf(doc);
  const was = doc.published;
  return JSON.stringify(now) === JSON.stringify({
    langs: was.langs || {},
    version_label: was.version_label || null,
    effective_on: was.effective_on || null,
    approved_by: was.approved_by || null,
  }) ? "PUBLISHED" : "CHANGED";
}

const withStatus = (doc) => (doc ? { ...doc, status: statusOf(doc) } : doc);

async function listDocuments(client) {
  return (await repo.listDocuments(client)).map(withStatus);
}

async function getDocument(client, id) {
  const doc = await repo.getDocument(client, id);
  if (!doc) throw new AppError("NOT_FOUND", "Document not found", 404);
  return withStatus(doc);
}

async function assertKeyFree(client, key, exceptId = null) {
  const other = await repo.getDocumentByKey(client, key);
  if (other && other.document_id !== exceptId) {
    throw new AppError("CONFLICT", `Another document already uses the address "${key}".`, 409, {
      doc_key: ["Already used by another document."],
    });
  }
}

async function createDocument(client, { patch, actor = {} }) {
  await assertKeyFree(client, patch.doc_key);
  return atomically(client, async () => {
    const row = await repo.createDocument(client, patch, actor.user_id);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.DOCUMENT_CREATED,
      moduleKey: events.MODULE,
      entityRef: ref("site_document", row.document_id),
      after: row,
    });
    return withStatus(row);
  });
}

async function updateDocument(client, { id, patch, actor = {} }) {
  const before = await repo.getDocument(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Document not found", 404);
  if (patch.doc_key && patch.doc_key !== before.doc_key) await assertKeyFree(client, patch.doc_key, id);
  return atomically(client, async () => {
    const row = await repo.updateDocument(client, id, patch, actor.user_id);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.DOCUMENT_UPDATED,
      moduleKey: events.MODULE,
      entityRef: ref("site_document", id),
      before,
      after: row,
    });
    return withStatus(row);
  });
}

async function removeDocument(client, { id, actor = {} }) {
  const before = await repo.getDocument(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Document not found", 404);
  if (before.published) {
    throw new AppError(
      "CONFLICT",
      "This document is on the website. Withdraw it first, so nobody following a link to it lands on a missing page by surprise.",
      409,
    );
  }
  return atomically(client, async () => {
    await repo.deleteDocument(client, id);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.DOCUMENT_DELETED,
      moduleKey: events.MODULE,
      entityRef: ref("site_document", id),
      before,
    });
    return { deleted: true };
  });
}

/**
 * Publish the draft as it stands, or withdraw the document from the site.
 *
 * Publishing freezes a copy: what the site serves from then on is that copy,
 * whatever happens to the draft. Refused, with the fields named, when the
 * tenant's required language has no title or a language has a title over no
 * body.
 */
async function setPublished(client, { id, published, actor = {} }) {
  const before = await repo.getDocument(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Document not found", 404);
  if (published) {
    const gaps = siteBrand.publishGaps(before, await requiredLanguage(client));
    if (gaps.length) {
      throw new AppError(
        "VALIDATION_ERROR",
        "This document cannot be published yet: every language it has a title in needs a body, and the website's main language needs a title.",
        422,
        Object.fromEntries(gaps.map((g) => [g, ["Required before publishing."]])),
      );
    }
  }
  const out = await atomically(client, async () => {
    const row = await repo.setPublished(client, id, published ? snapshotOf(before) : null, actor.user_id);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: published ? events.DOCUMENT_PUBLISHED : events.DOCUMENT_WITHDRAWN,
      moduleKey: events.MODULE,
      entityRef: ref("site_document", id),
      before: { published_at: before.published_at },
      after: { published_at: row.published_at },
    });
    return withStatus(row);
  });
  // IndexNow (shared/http/indexnow.js): the document's page, the Trust index
  // and the home page. The privacy policy has its own address.
  const key = String(before.doc_key || "").toLowerCase();
  if (key) {
    const page = key === "privacy-policy" ? "/legal/privacy" : "/trust/" + encodeURIComponent(key);
    indexNow.ping(client, [page, "/trust", "/"]);
  }
  return out;
}

/* ── the PDF ────────────────────────────────────────────────────────────────*/

/** One language of a snapshot, flattened for the template and the page. */
function oneLanguage(doc, snapshot, lang) {
  const text = snapshot.langs[lang];
  return {
    kind: doc.kind,
    lang,
    title: text.title,
    summary: text.summary,
    body: text.body,
    version_label: snapshot.version_label,
    effective_on: snapshot.effective_on,
    approved_by: snapshot.approved_by,
  };
}

/** The tenant's letterhead and brand colour, resolved the way the Company
 *  Profile resolves them, so the policies and the profile look like one set. */
async function documentHtml(client, flat) {
  const templates = require("../../documents/template/template.service");
  const branding = require("../../branding/branding.service");
  const { cfg, entity } = await templates.resolveCfg(client, "COMPANY_PROFILE", null, null, {
    language: flat.lang === "fr" ? "fr" : "en",
  });
  const brand = await branding.getBranding(client).catch(() => ({}));
  const hex = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
  if (!(entity.letterhead_row && hex.test(String(entity.letterhead_row.brand_color || ""))) && hex.test(String(brand.primary || ""))) {
    cfg.accent = String(brand.primary).toLowerCase();
  }
  return pdfTemplate.build(flat, cfg, entity);
}

const renderPdf = async (html) => require("../../../services/pdf.service").renderHtml(html);

/** A filename a person would keep: the title, the version, the language. */
function filenameOf(flat, key) {
  const base = String(flat.title || key)
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || key;
  const v = flat.version_label ? `-v${String(flat.version_label).replace(/[^A-Za-z0-9.]+/g, "")}` : "";
  return `${base}${v}-${flat.lang}.pdf`;
}

/** The staff preview of the DRAFT, in one language. Never stored. */
async function previewPdf(client, { id, lang = "en" }) {
  const doc = await repo.getDocument(client, id);
  if (!doc) throw new AppError("NOT_FOUND", "Document not found", 404);
  const snapshot = snapshotOf(doc);
  const pick = snapshot.langs[lang] ? lang : Object.keys(snapshot.langs)[0];
  if (!pick) throw new AppError("VALIDATION_ERROR", "Give the document a title first.", 422);
  const flat = oneLanguage(doc, snapshot, pick);
  return { buffer: await renderPdf(await documentHtml(client, flat)), filename: filenameOf(flat, doc.doc_key) };
}

/* ── the public reads ───────────────────────────────────────────────────────*/

/** Which language of a snapshot a visitor gets: theirs, else English, else
 *  French, else whatever exists. German is served only when asked for. */
function pickLang(langs, wanted) {
  if (wanted && langs[wanted]) return wanted;
  for (const l of ["en", "fr"]) if (langs[l]) return l;
  return Object.keys(langs)[0] || null;
}

/** The list a Trust page draws: titles and summaries, no bodies. */
async function publicDocuments(client, { lang = "en" } = {}) {
  return (await repo.publishedDocuments(client))
    .map((d) => {
      const langs = (d.published && d.published.langs) || {};
      const l = pickLang(langs, lang);
      if (!l) return null;
      return {
        key: d.doc_key,
        kind: d.kind,
        lang: l,
        languages: Object.keys(langs),
        title: langs[l].title,
        summary: langs[l].summary || null,
        version_label: d.published.version_label || null,
        effective_on: d.published.effective_on || null,
        published_at: d.published_at,
      };
    })
    .filter(Boolean);
}

async function publishedByKey(client, key) {
  const doc = await repo.getDocumentByKey(client, String(key || "").toLowerCase());
  if (!doc || !doc.published) throw new AppError("NOT_FOUND", "Document not found", 404);
  return doc;
}

async function publicDocument(client, { key, lang = "en" }) {
  const doc = await publishedByKey(client, key);
  const langs = doc.published.langs || {};
  const l = pickLang(langs, lang);
  if (!l) throw new AppError("NOT_FOUND", "Document not found", 404);
  return {
    key: doc.doc_key,
    kind: doc.kind,
    languages: Object.keys(langs),
    published_at: doc.published_at,
    ...oneLanguage(doc, doc.published, l),
  };
}

/**
 * The published PDF, rendered once per snapshot and language and then served
 * from storage. Rendering at Publish would make Publish wait on a browser and
 * fail when one is unavailable; rendering here, once, keeps the button
 * instant and the PDF exact.
 */
async function publicPdf(client, { key, lang = "en", tenantSlug = "tenant" }) {
  const doc = await publishedByKey(client, key);
  const langs = doc.published.langs || {};
  const l = pickLang(langs, lang);
  if (!l) throw new AppError("NOT_FOUND", "Document not found", 404);
  const flat = oneLanguage(doc, doc.published, l);
  const stamp = new Date(doc.published_at).getTime();
  const base = doc.pdf_key || `site-documents/${String(tenantSlug).replace(/[^a-z0-9-]/gi, "")}/${doc.document_id}/${stamp}`;
  const storageKey = `${base}-${l}.pdf`;
  if (doc.pdf_key) {
    try {
      return { buffer: await storage.get(storageKey), filename: filenameOf(flat, doc.doc_key), etag: `${stamp}-${l}` };
    } catch {
      /* @silent:storage not rendered in this language yet, or the object was
         swept: rendered below, which is the designed path. */
    }
  }
  const buffer = await renderPdf(await documentHtml(client, flat));
  await storage.put(buffer, { key: storageKey, contentType: "application/pdf" });
  if (!doc.pdf_key) await repo.setPdfKey(client, doc.document_id, doc.published_at, base);
  return { buffer, filename: filenameOf(flat, doc.doc_key), etag: `${stamp}-${l}` };
}

/* ── the legal facts ────────────────────────────────────────────────────────*/

const REGISTER_KINDS = new Set(["HRB", "HRA", "RCCM", "REGISTER", "COMMERCIAL_REGISTER", "TRADE_REGISTER", "HANDELSREGISTER", "CRN", "COMPANY_NUMBER"]);
const VAT_KINDS = new Set(["VAT", "VAT_ID", "USTIDNR", "UST_ID", "UST-IDNR"]);
const kindOf = (k) => String(k || "").trim().toUpperCase().replace(/[\s.]+/g, "_");

const countryName = (code) => {
  const c = countries.byCode ? countries.byCode(String(code || "").toUpperCase()) : null;
  return (c && c.name) || (code ? String(code).toUpperCase() : null);
};

/** The registered office as printed lines: street, town, country. */
function addressLinesOf(entity, rows) {
  const a = letterhead.registeredAddressRow((rows || []).filter((r) => r.is_active !== false));
  if (!a) return entity.address ? String(entity.address).split(/\n|,\s*/).map((s) => s.trim()).filter(Boolean) : [];
  return [
    a.line1,
    a.line2,
    a.po_box ? (/^(b\.?p|p\.?o|postfach)/i.test(a.po_box) ? a.po_box : `B.P. ${a.po_box}`) : null,
    [a.postal_code, a.city].filter(Boolean).join(" ") || null,
    countryName(a.country_code || entity.country_code),
  ].filter(filled);
}

/**
 * Every published company, with what an Impressum (Germany, § 5 DDG) and a
 * privacy notice's controller section must state. A fact the company has not
 * recorded is null, and the page leaves its line out rather than printing an
 * empty label.
 */
async function publicLegal(client) {
  const { entities, registrations, people, addresses } = await repo.legalEntities(client);
  return entities.map((e) => {
    const regs = registrations.filter((r) => r.entity_id === e.entity_id);
    const register = regs.find((r) => REGISTER_KINDS.has(kindOf(r.kind))) || null;
    const vat = regs.find((r) => VAT_KINDS.has(kindOf(r.kind))) || null;
    return {
      id: e.entity_id,
      legal_name: e.legal_name,
      legal_form: e.legal_form || null,
      country_code: e.country_code,
      country: countryName(e.country_code),
      address_lines: addressLinesOf(e, addresses.filter((a) => a.entity_id === e.entity_id)),
      representatives: people
        .filter((p) => p.entity_id === e.entity_id)
        .map((p) => ({ name: p.full_name, title: p.title || null })),
      register: register
        ? { kind: register.kind, number: register.number, authority: register.issuing_authority || null }
        : null,
      vat_id: vat ? vat.number : null,
      email: e.email || null,
      phone: e.phone || null,
      website: e.website || null,
    };
  });
}

/* ── the privacy policy, drafted from the companies ─────────────────────────*/

/**
 * Create (or refresh) the privacy policy's DRAFT from the published companies,
 * in English and German. It is a draft: an editor reads it, corrects it and
 * publishes it. The published copy is never touched here.
 */
async function draftPrivacy(client, { actor = {} }) {
  const legal = await publicLegal(client);
  if (!legal.length) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Publish at least one company on the website first (Master Data, the company's Public Story). The policy names the companies responsible for the data.",
      422,
    );
  }
  const drafted = require("./site_brand.privacy").draft(legal);
  const existing = await repo.getDocumentByKey(client, "privacy-policy");
  const patch = {
    doc_key: "privacy-policy",
    kind: "LEGAL",
    sort_order: 900,
    title_en: drafted.en.title,
    body_en: drafted.en.body,
    summary_en: drafted.en.summary,
    title_de: drafted.de.title,
    body_de: drafted.de.body,
    summary_de: drafted.de.summary,
    version_label: existing && existing.version_label ? existing.version_label : "1.0",
  };
  return existing
    ? updateDocument(client, { id: existing.document_id, patch, actor })
    : createDocument(client, { patch, actor });
}

module.exports = {
  requiredLanguage,
  listImages, setImageAlt, uploadImage, removeImage, publicImages,
  snapshotOf, statusOf,
  listDocuments, getDocument, createDocument, updateDocument, removeDocument, setPublished,
  previewPdf, publicDocuments, publicDocument, publicPdf,
  publicLegal, draftPrivacy,
};
