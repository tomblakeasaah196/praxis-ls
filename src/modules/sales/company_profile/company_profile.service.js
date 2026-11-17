"use strict";
/**
 * Company Profile (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.6, §4.7, D9).
 *
 * ── VERSIONS ───────────────────────────────────────────────────────────────
 *
 * One DRAFT at a time. The first edit after a publish opens the next draft as
 * a copy of the published version, so a published version is never edited:
 * the service refuses it, and migration 14560's triggers refuse it again for
 * anything that reaches the table another way. Publish supersedes the previous
 * version. Every step is audited, and a section save records the section
 * before and after.
 *
 * ── OUTPUTS ────────────────────────────────────────────────────────────────
 *
 * Every output is `presentation.build()` over sections that `visible()` has
 * already stripped: the staff Preview and PDF, the public page and its PDF
 * (company_profile_public), and the AI, which reads the PUBLISHED version only.
 *
 * ── SHARES ─────────────────────────────────────────────────────────────────
 *
 * A link is a random token; only its hash is stored. A share raised from a
 * lead keeps `lead_id`, which is what lets the lead's Activity list it (PR 6,
 * once `lead_activity` exists). The first open notifies the person who shared.
 */

const crypto = require("crypto");
const repo = require("./company_profile.repo");
const events = require("./company_profile.events");
const presentation = require("./company_profile.presentation");
const { audit, emitEvent, resolveActorId } = require("../../../shared/events/emit");
const { atomically } = require("../../../shared/db/tx");
const { AppError } = require("../../../utils/errors");
const { parseDataUrl } = require("../../../utils/data-url");
const storage = require("../../../services/storage.service");
const imagePipeline = require("../../../services/image-pipeline.service");
const { companyProfile } = require("@praxis/shared");

const { SECTION_KEYS, LIMITS } = companyProfile;
const ref = (id) => `company_profile_version:${id}`;
const shareRef = (id) => `company_profile_share:${id}`;
const IMAGE_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const MAX_COVER_BYTES = 10 * 1024 * 1024;

const clone = (v) => JSON.parse(JSON.stringify(v));
const byKey = (rows) => Object.fromEntries(rows.map((r) => [r.section_key, r]));

/* ── reading ──────────────────────────────────────────────────────────────── */

/** The public URL of a stored image. Logos sit under `branding/`, covers under `site/`. */
const mediaUrl = (key) => (key ? storage.publicUrl(key) : null);

/** Everything a section can point at, loaded once for `presentation.build`. */
async function options(c, { version = null, sections = [] } = {}) {
  const s = byKey(sections);
  const logoIds = (s.clients && s.clients.structure && s.clients.structure.logo_ids) || [];
  const storyIds = (s.case_stories && s.case_stories.structure && s.case_stories.structure.story_ids) || [];
  const branding = require("../../branding/branding.service");
  // One after another: these share one connection, and pg queues concurrent
  // queries on a client rather than running them, with a deprecation warning.
  const services = await repo.publishedServices(c);
  const stories = storyIds.length ? await repo.publishedStories(c, storyIds) : [];
  const logos = await repo.logosByIds(c, logoIds);
  const contact = await repo.contactFacts(c);
  const derived = await repo.getSingleton(c);
  const brand = await branding.getBranding(c).catch(() => ({}));
  const cover = s.cover && s.cover.structure && s.cover.structure.image_key;
  return {
    version,
    services,
    stories,
    logos: logos.map((l) => ({ ...l, url: mediaUrl(l.storage_key) })),
    contact,
    derived,
    brand: { name: brand && brand.name, logo_url: brand && brand.logoUrl },
    coverUrl: mediaUrl(cover),
  };
}

/** The presentation of one version in one language. */
async function present(c, version, language) {
  const sections = await repo.sections(c, version.version_id);
  return presentation.build(sections, await options(c, { version, sections }), language);
}

/**
 * The editor's one read: the draft (or, with none open, the published version),
 * its raw sections with their completeness, the versions, and the choices each
 * section offers.
 */
async function editor(c) {
  const draft = await repo.byStatus(c, "DRAFT");
  const live = await repo.byStatus(c, "PUBLISHED");
  const versions = await repo.listVersions(c);
  const services = await repo.publishedServices(c);
  const stories = await repo.publishedStories(c);
  const logos = await repo.listLogos(c);
  const contact = await repo.contactFacts(c);
  const current = draft || live;
  const sections = current ? await repo.sections(c, current.version_id) : [];
  const derived = await repo.getSingleton(c);
  const raw = byKey(sections);
  const cover = raw.cover && raw.cover.structure && raw.cover.structure.image_key;
  return {
    draft: draft ? summary(draft) : null,
    published: live ? summary(live) : null,
    versions: versions.map(summary),
    sections: SECTION_KEYS.map((key) => {
      const row = raw[key] || { structure: presentation.DEFAULT_STRUCTURE[key], text_en: {}, text_fr: {} };
      const structure = { ...row.structure };
      delete structure.image_key;
      return { key, structure, text_en: row.text_en || {}, text_fr: row.text_fr || {} };
    }),
    completeness: presentation.completeness(sections),
    cover_url: mediaUrl(cover),
    contact: contact ? {
      legal_name: contact.legal_name, trading_name: contact.trading_name || null, address: contact.address || null,
      phone: contact.phone || null, email: contact.email || null, website: contact.website || null,
    } : null,
    choices: {
      services: services.map((s) => ({
        id: s.service_type_id, name_en: s.name_en, name_fr: s.name_fr,
        short_en: s.short_description_en || null, short_fr: s.short_description_fr || null,
      })),
      stories: stories.map((s) => ({
        id: s.success_story_id, title: s.title, client_name: s.client_name || null,
        published_at: s.published_at,
      })),
      logos: logos.map((l) => ({ id: l.logo_id, name: l.name, url: mediaUrl(l.storage_key), retired: Boolean(l.retired_at) })),
    },
    derived: derived ? {
      computed_at: derived.computed_at,
      fleet_count: derived.fleet_count,
      fleet_composition: derived.fleet_composition,
      warehouse_capacity: derived.warehouse_capacity,
      warehouse_count: derived.warehouse_count,
      offices: (derived.office_list || []).length,
      gateways: (derived.gateway_list || []).map((g) => g.name),
      regions: derived.region_list || [],
      client_count: derived.client_count,
    } : null,
  };
}

function summary(v) {
  return {
    version_id: v.version_id,
    number: v.number,
    status: v.status,
    change_note: v.change_note || null,
    created_at: v.created_at,
    created_by_name: v.created_by_name || null,
    published_at: v.published_at || null,
    published_by_name: v.published_by_name || null,
  };
}

/* ── the draft ────────────────────────────────────────────────────────────── */

/**
 * The open draft, opening one when there is none: a copy of the published
 * version, or the defaults on a profile never published. Serialised by an
 * advisory lock, so two first edits at once open one draft.
 */
async function ensureDraft(c, actor = {}) {
  await c.query("SELECT pg_advisory_xact_lock(hashtext('company_profile_draft'))");
  const open = await repo.byStatus(c, "DRAFT", { lock: true });
  if (open) return open;
  const createdBy = await resolveActorId(c, actor.user_id);
  const live = await repo.byStatus(c, "PUBLISHED");
  const from = live ? byKey(await repo.sections(c, live.version_id)) : {};
  const draft = await repo.insertVersion(c, { createdBy });
  for (const key of SECTION_KEYS) {
    const src = from[key];
    await repo.insertSection(c, {
      versionId: draft.version_id,
      key,
      structure: src ? clone(src.structure) : clone(presentation.DEFAULT_STRUCTURE[key]),
      textEn: src ? clone(src.text_en) : {},
      textFr: src ? clone(src.text_fr) : {},
      updatedBy: createdBy,
    });
  }
  await audit(c, {
    actorUserId: actor.user_id || null, action: "company_profile.draft_opened", moduleKey: events.MODULE,
    entityRef: ref(draft.version_id), after: { number: draft.number, from: live ? live.number : null },
  });
  return draft;
}

/** Ids a section points at must exist, and be the kind it may point at. */
async function assertReferences(c, key, structure) {
  const bad = (msg) => new AppError("VALIDATION_ERROR", msg, 422, { structure: [msg] });
  if (key === "services") {
    const ok = new Set((await repo.publishedServices(c)).map((s) => s.service_type_id));
    if (structure.items.some((i) => !ok.has(i.id))) throw bad("Only service types published on the website can be listed.");
  } else if (key === "case_stories") {
    const found = await repo.publishedStories(c, structure.story_ids);
    if (found.length !== new Set(structure.story_ids).size) throw bad("Only published success stories can be picked.");
  } else if (key === "clients") {
    const ids = [...new Set(structure.logo_ids)];
    const logos = await repo.logosByIds(c, ids);
    if (logos.length !== ids.length || logos.some((l) => l.retired_at)) throw bad("A retired or unknown logo cannot be put on the profile.");
  } else if (key === "certifications") {
    const docs = [...new Set(structure.items.map((i) => i.document_id).filter(Boolean))];
    const found = await repo.vaultDocsExist(c, docs);
    if (found.length !== docs.length) throw bad("A certification points at a document that does not exist.");
  }
  const ids = (structure.items || []).map((i) => i.id);
  if (new Set(ids).size !== ids.length) throw bad("Each item appears once.");
}

/**
 * Save one section of the draft: what the editor sends when a field is left.
 * Words are kept only for ids the structure names, so removing an item takes
 * its words with it in both languages.
 */
async function saveSection(c, { key, body, actor = {} }) {
  if (!SECTION_KEYS.includes(key)) throw new AppError("NOT_FOUND", "No such section", 404);
  const parsed = companyProfile.section(key).safeParse(body || {});
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", "Invalid section", 422, parsed.error.flatten().fieldErrors);
  }
  return atomically(c, async () => {
    const draft = await ensureDraft(c, actor);
    const before = byKey(await repo.sections(c, draft.version_id))[key]
      || { structure: clone(presentation.DEFAULT_STRUCTURE[key]), text_en: {}, text_fr: {} };
    const structure = parsed.data.structure
      ? { ...parsed.data.structure, ...(key === "cover" ? { image_key: before.structure.image_key || null } : {}) }
      : before.structure;
    if (parsed.data.structure) await assertReferences(c, key, structure);
    const en = companyProfile.cleanText(key, structure, parsed.data.text_en !== undefined ? parsed.data.text_en : before.text_en);
    const fr = companyProfile.cleanText(key, structure, parsed.data.text_fr !== undefined ? parsed.data.text_fr : before.text_fr);
    const errors = {
      ...Object.fromEntries(Object.entries(en.errors).map(([k, v]) => [`text_en.${k}`, v])),
      ...Object.fromEntries(Object.entries(fr.errors).map(([k, v]) => [`text_fr.${k}`, v])),
    };
    if (Object.keys(errors).length) throw new AppError("VALIDATION_ERROR", "A field is too long", 422, errors);
    const updatedBy = await resolveActorId(c, actor.user_id);
    const fields = { versionId: draft.version_id, key, structure, textEn: en.text, textFr: fr.text, updatedBy };
    let row = await repo.updateSection(c, fields);
    if (!row) {
      // A draft opened before a section existed: add it rather than lose the edit.
      await repo.insertSection(c, fields);
      row = byKey(await repo.sections(c, draft.version_id))[key];
    }
    await audit(c, {
      actorUserId: actor.user_id || null, action: "company_profile.section_saved", moduleKey: events.MODULE,
      entityRef: ref(draft.version_id),
      before: { section: key, structure: before.structure, text_en: before.text_en, text_fr: before.text_fr },
      after: { section: key, structure: row.structure, text_en: row.text_en, text_fr: row.text_fr },
    });
    const all = await repo.sections(c, draft.version_id);
    const out = { ...row.structure };
    delete out.image_key;
    return {
      draft: summary(draft),
      section: { key, structure: out, text_en: row.text_en, text_fr: row.text_fr },
      completeness: presentation.completeness(all),
    };
  });
}

/** Store an uploaded image through the one pipeline and return what it stored. */
async function storeImage(dataUrl, { slug, segment, prefix, profile, maxBytes }) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed || !IMAGE_TYPES[parsed.mimeType]) {
    throw new AppError("BAD_FILE_TYPE", "Use a PNG, JPEG or WebP image", 422);
  }
  if (!parsed.buffer.length) throw new AppError("EMPTY_FILE", "The image is empty", 422);
  if (parsed.buffer.length > maxBytes) {
    throw new AppError("FILE_TOO_LARGE", `The image must be ${Math.round(maxBytes / (1024 * 1024))} MB or smaller`, 413);
  }
  // The bytes decide, not the declared type: SVG and anything else that only
  // claims to be a raster is refused before it reaches storage.
  if (imageKind(parsed.buffer) !== parsed.mimeType) {
    throw new AppError("BAD_FILE_TYPE", "This file is not the image it says it is", 422);
  }
  const ext = IMAGE_TYPES[parsed.mimeType];
  const key = `tenant_${slug}/${segment}/${prefix}_${crypto.randomBytes(8).toString("hex")}.${ext}`;
  // The hash recorded is the stored master's, which is what the pipeline returns.
  return imagePipeline.storeImage(
    { buffer: parsed.buffer, mimetype: parsed.mimeType, originalname: `${prefix}.${ext}` },
    { key, profile },
  );
}

function imageKind(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.slice(1, 4).toString("latin1") === "PNG") return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 12 && buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** The cover photograph: the `photo` profile, so a dull phone shot is levelled. */
async function setCover(c, { dataUrl, slug, actor = {} }) {
  const stored = await storeImage(dataUrl, { slug, segment: "site", prefix: "profile-cover", profile: "photo", maxBytes: MAX_COVER_BYTES });
  return atomically(c, async () => {
    const draft = await ensureDraft(c, actor);
    const before = byKey(await repo.sections(c, draft.version_id)).cover;
    const structure = { ...(before ? before.structure : presentation.DEFAULT_STRUCTURE.cover), image_key: stored.key };
    await repo.updateSection(c, {
      versionId: draft.version_id, key: "cover", structure,
      textEn: before ? before.text_en : {}, textFr: before ? before.text_fr : {},
      updatedBy: await resolveActorId(c, actor.user_id),
    });
    await audit(c, {
      actorUserId: actor.user_id || null, action: "company_profile.cover_set", moduleKey: events.MODULE,
      entityRef: ref(draft.version_id), before: { image_key: before && before.structure.image_key },
      after: { image_key: stored.key, content_hash: stored.content_hash },
    });
    return { cover_url: mediaUrl(stored.key), draft: summary(draft) };
  });
}

async function clearCover(c, { actor = {} }) {
  return atomically(c, async () => {
    const draft = await ensureDraft(c, actor);
    const before = byKey(await repo.sections(c, draft.version_id)).cover;
    if (!before || !before.structure.image_key) return { cover_url: null, draft: summary(draft) };
    await repo.updateSection(c, {
      versionId: draft.version_id, key: "cover", structure: { ...before.structure, image_key: null },
      textEn: before.text_en, textFr: before.text_fr, updatedBy: await resolveActorId(c, actor.user_id),
    });
    await audit(c, {
      actorUserId: actor.user_id || null, action: "company_profile.cover_removed", moduleKey: events.MODULE,
      entityRef: ref(draft.version_id), before: { image_key: before.structure.image_key }, after: { image_key: null },
    });
    return { cover_url: null, draft: summary(draft) };
  });
}

/* ── publishing and history ───────────────────────────────────────────────── */

async function publish(c, { changeNote = null, actor = {} }) {
  return atomically(c, async () => {
    const draft = await repo.byStatus(c, "DRAFT", { lock: true });
    if (!draft) throw new AppError("NOTHING_TO_PUBLISH", "There is no draft to publish", 422);
    const previous = await repo.byStatus(c, "PUBLISHED", { lock: true });
    const changes = presentation.diff(
      previous ? await repo.sections(c, previous.version_id) : [],
      await repo.sections(c, draft.version_id),
    );
    await repo.supersedePublished(c);
    const row = await repo.publishVersion(c, draft.version_id, {
      changeNote: changeNote ? String(changeNote).trim().slice(0, LIMITS.change_note) || null : null,
      publishedBy: await resolveActorId(c, actor.user_id),
    });
    await emitEvent(c, {
      eventTypeKey: events.PUBLISHED, moduleKey: events.MODULE, entityRef: ref(row.version_id),
      actorUserId: actor.user_id || null, payload: { number: row.number, changes: changes.length },
    });
    await audit(c, {
      actorUserId: actor.user_id || null, action: events.PUBLISHED, moduleKey: events.MODULE,
      entityRef: ref(row.version_id),
      before: previous ? { version: previous.number } : null,
      after: { version: row.number, change_note: row.change_note, changes },
    });
    return summary(await repo.getVersion(c, row.version_id));
  });
}

const history = async (c) => (await repo.listVersions(c)).map(summary);

/** A version against the one before it, field by field. */
async function diff(c, { versionId }) {
  const version = await repo.getVersion(c, versionId);
  if (!version) throw new AppError("NOT_FOUND", "Version not found", 404);
  const previous = await repo.previousOf(c, version.number);
  return {
    version: summary(version),
    previous: previous ? summary(previous) : null,
    changes: presentation.diff(
      previous ? await repo.sections(c, previous.version_id) : [],
      await repo.sections(c, version.version_id),
    ),
  };
}

/** The version a staff output reads: the one asked for, else the draft, else the published. */
async function versionFor(c, versionId) {
  const v = versionId
    ? await repo.getVersion(c, versionId)
    : (await repo.byStatus(c, "DRAFT")) || (await repo.byStatus(c, "PUBLISHED"));
  if (!v) throw new AppError("NOT_FOUND", "There is no company profile yet", 404);
  return v;
}

/* ── the document ─────────────────────────────────────────────────────────── */

/**
 * The branded HTML of one version: the document renderer, its letterhead and
 * the tenant's brand colour from the branding service when the corporate
 * entity has not set one of its own.
 */
async function documentHtml(c, data) {
  const templates = require("../../documents/template/template.service");
  const registry = require("../../../services/documents/templates/registry");
  const brandLogo = require("../../../services/brand-logo.service");
  const branding = require("../../branding/branding.service");
  const language = data.language === "FR" ? "fr" : "en";
  const { cfg, entity } = await templates.resolveCfg(c, "COMPANY_PROFILE", null, null, { language });
  const brand = await branding.getBranding(c).catch(() => ({}));
  const hex = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
  if (!(entity.letterhead_row && hex.test(String(entity.letterhead_row.brand_color || ""))) && hex.test(String(brand.primary || ""))) {
    cfg.accent = String(brand.primary).toLowerCase();
  }
  // A PDF has no origin, so every image is inlined: the cover, the logos, the brand mark.
  const inline = async (url) => (url ? brandLogo.resolveLogo(url) : null);
  const printable = {
    ...data,
    company: {
      ...data.company,
      cover_url: await inline(data.company.cover_url),
      logo_url: await inline(data.company.logo_url),
    },
    sections: [],
  };
  for (const s of data.sections) {
    if (!s.logos) {
      printable.sections.push(s);
      continue;
    }
    const logos = [];
    for (const l of s.logos) logos.push({ ...l, url: await inline(l.url) });
    printable.sections.push({ ...s, logos });
  }
  return registry.get("COMPANY_PROFILE").build(printable, cfg, entity, null);
}

async function preview(c, { versionId = null, language = "EN" }) {
  const version = await versionFor(c, versionId);
  const data = await present(c, version, language);
  return { html: await documentHtml(c, data), presentation: data, version: summary(version) };
}

async function pdf(c, { versionId = null, language = "EN" }) {
  const version = await versionFor(c, versionId);
  const data = await present(c, version, language);
  return render(c, data, version);
}

async function render(c, data, version) {
  const pdfService = require("../../../services/pdf.service");
  const buffer = await pdfService.renderHtml(await documentHtml(c, data));
  return { buffer, filename: `company-profile-v${version.number}-${data.language.toLowerCase()}.pdf` };
}

/* ── derived figures ──────────────────────────────────────────────────────── */

async function refresh(c, { actor = {} } = {}) {
  const d = await repo.derived(c);
  const row = await repo.updateDerived(c, { ...d, computed_at: new Date() });
  await audit(c, {
    actorUserId: actor.user_id || null, action: "company_profile.refreshed", moduleKey: events.MODULE,
    entityRef: `company_profile:${row.company_profile_id}`, after: { computed_at: row.computed_at },
  });
  return row;
}

async function freshDerived(c, { maxAgeHours = 24 } = {}) {
  const row = await repo.getSingleton(c);
  if (!row || !row.computed_at || Date.now() - new Date(row.computed_at).getTime() > maxAgeHours * 3600000) {
    return refresh(c);
  }
  return row;
}

/**
 * The PUBLISHED profile, as the AI reads it. Nothing from a draft, nothing
 * hidden, and no cost or margin, because the profile holds none.
 */
async function published(c, { language = "EN" } = {}) {
  const version = await repo.byStatus(c, "PUBLISHED");
  if (!version) return { published: false, profile: null };
  await freshDerived(c);
  return { published: true, profile: await present(c, version, language) };
}

/**
 * The facts proposals are grounded in, in the flat shape the proposal
 * generator reads (it moves to quotations in PR 4). Read from the PUBLISHED
 * version and the derived figures only.
 */
async function getFresh(c, opts = {}) {
  const derivedRow = await freshDerived(c, opts);
  const version = await repo.byStatus(c, "PUBLISHED");
  const sections = version ? presentation.visible(await repo.sections(c, version.version_id)) : {};
  const word = (key, k) => presentation.word(sections[key], k, "EN");
  const certs = ((sections.certifications && sections.certifications.structure.items) || [])
    .map((i) => ({ kind: i.kind, name: word("certifications", i.id) })).filter((i) => i.name);
  const promises = ((sections.why_us && sections.why_us.structure.items) || [])
    .map((i) => ({ title: word("why_us", `${i.id}.title`) || "", value: word("why_us", `${i.id}.body`) || "" }))
    .filter((p) => p.title || p.value);
  const storyIds = (sections.case_stories && sections.case_stories.structure.story_ids) || [];
  const stories = storyIds.length ? await repo.publishedStories(c, storyIds) : [];
  return {
    ...(derivedRow || {}),
    slogan: word("cover", "tagline"),
    positioning: word("who_we_are", "positioning"),
    operating_regions: ((derivedRow && derivedRow.region_list) || []).map((code) => presentation.countryName(code, "EN")),
    gateways: ((derivedRow && derivedRow.gateway_list) || []).map((g) => g.name),
    certifications: certs.filter((i) => i.kind === "CERTIFICATION").map((i) => i.name),
    memberships: certs.filter((i) => i.kind === "MEMBERSHIP").map((i) => i.name),
    service_promises: promises,
    projects: stories.map((s) => ({ name_en: s.title, description_en: s.executive_summary || s.headline || null, metrics: {} })),
  };
}

/* ── the logo library ─────────────────────────────────────────────────────── */

const logos = async (c) => (await repo.listLogos(c)).map((l) => ({
  id: l.logo_id, name: l.name, url: mediaUrl(l.storage_key), retired: Boolean(l.retired_at), created_at: l.created_at,
}));

/** A client logo: the `brand` profile, so the client's colours come back exactly. */
async function addLogo(c, { name, dataUrl, slug, actor = {} }) {
  const stored = await storeImage(dataUrl, { slug, segment: "branding", prefix: "profile-logo", profile: "brand", maxBytes: MAX_LOGO_BYTES });
  return atomically(c, async () => {
    const row = await repo.insertLogo(c, {
      name: String(name).trim(),
      storage_key: stored.key,
      content_type: stored.content_type,
      content_hash: stored.content_hash,
      bytes: stored.size || 0,
      created_by: await resolveActorId(c, actor.user_id),
    });
    await audit(c, {
      actorUserId: actor.user_id || null, action: "company_profile.logo_added", moduleKey: events.MODULE,
      entityRef: `company_profile_logo:${row.logo_id}`, after: { name: row.name, content_hash: row.content_hash },
    });
    return { id: row.logo_id, name: row.name, url: mediaUrl(row.storage_key), retired: false, created_at: row.created_at };
  });
}

/**
 * Retire a logo: it leaves the library and the draft, and stays on every
 * published version that showed it, because a published version is never
 * edited. Its bytes are kept for the same reason.
 */
async function retireLogo(c, { id, actor = {} }) {
  return atomically(c, async () => {
    const row = await repo.retireLogo(c, id, await resolveActorId(c, actor.user_id));
    if (!row) {
      if (!(await repo.getLogo(c, id))) throw new AppError("NOT_FOUND", "Logo not found", 404);
      throw new AppError("ALREADY_RETIRED", "This logo is already retired", 422);
    }
    const draft = await repo.byStatus(c, "DRAFT", { lock: true });
    if (draft) {
      const clients = byKey(await repo.sections(c, draft.version_id)).clients;
      if (clients && (clients.structure.logo_ids || []).includes(id)) {
        await repo.updateSection(c, {
          versionId: draft.version_id, key: "clients",
          structure: { ...clients.structure, logo_ids: clients.structure.logo_ids.filter((x) => x !== id) },
          textEn: clients.text_en, textFr: clients.text_fr, updatedBy: await resolveActorId(c, actor.user_id),
        });
      }
    }
    await audit(c, {
      actorUserId: actor.user_id || null, action: "company_profile.logo_retired", moduleKey: events.MODULE,
      entityRef: `company_profile_logo:${id}`, after: { retired_at: row.retired_at },
    });
    return { id, retired: true };
  });
}

/* ── shares ───────────────────────────────────────────────────────────────── */

const tokenHash = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

function shareView(s) {
  const now = Date.now();
  const state = s.revoked_at ? "REVOKED" : new Date(s.expires_at).getTime() <= now ? "EXPIRED" : "ACTIVE";
  return {
    share_id: s.share_id,
    recipient_name: s.recipient_name || null,
    recipient_email: s.recipient_email || null,
    lead_id: s.lead_id || null,
    lead_name: s.lead_name || null,
    language: s.language,
    pinned_version: s.version_number || null,
    expires_at: s.expires_at,
    revoked_at: s.revoked_at || null,
    state,
    created_at: s.created_at,
    created_by_name: s.created_by_name || null,
    first_opened_at: s.first_opened_at || null,
    last_opened_at: s.last_opened_at || null,
    open_count: s.open_count || 0,
    downloaded_at: s.downloaded_at || null,
  };
}

async function shares(c, query = {}) {
  const { rows, total } = await repo.listShares(c, query);
  return { rows: rows.map(shareView), total };
}

/** The end of the last day the link works, in UTC. */
function expiryFrom(isoDay) {
  const end = new Date(`${isoDay}T23:59:59.999Z`);
  const now = Date.now();
  if (Number.isNaN(end.getTime()) || end.getTime() <= now) {
    throw new AppError("VALIDATION_ERROR", "The link must work until today or later", 422, { expires_on: ["Choose today or a later day."] });
  }
  if (end.getTime() - now > (LIMITS.share_days + 1) * 86400000) {
    throw new AppError("VALIDATION_ERROR", `A link can work for at most ${LIMITS.share_days} days`, 422, { expires_on: [`At most ${LIMITS.share_days} days ahead.`] });
  }
  return end;
}

async function createShare(c, { data, actor = {} }) {
  const parsed = companyProfile.share.safeParse(data || {});
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid share", 422, parsed.error.flatten().fieldErrors);
  const d = parsed.data;
  const expiresAt = expiryFrom(d.expires_on);
  return atomically(c, async () => {
    const live = await repo.byStatus(c, "PUBLISHED");
    if (!live) throw new AppError("NOTHING_PUBLISHED", "Publish the profile before sharing it", 422);
    let lead = null;
    if (d.lead_id) {
      lead = await repo.leadExists(c, d.lead_id);
      if (!lead) throw new AppError("VALIDATION_ERROR", "Lead not found", 422, { lead_id: ["This lead does not exist."] });
    }
    const token = crypto.randomBytes(32).toString("base64url");
    const createdBy = await resolveActorId(c, actor.user_id);
    const { share_id: id } = await repo.insertShare(c, {
      token_hash: tokenHash(token),
      recipient_name: d.recipient_name ? d.recipient_name.trim() || null : (lead ? lead.company_name : null),
      recipient_email: d.recipient_email || null,
      lead_id: lead ? lead.lead_id : null,
      version_id: d.pin_version ? live.version_id : null,
      language: d.language,
      expires_at: expiresAt,
      created_by: createdBy,
    });
    await emitEvent(c, {
      eventTypeKey: events.SHARED, moduleKey: events.MODULE, entityRef: shareRef(id),
      actorUserId: actor.user_id || null,
      payload: { lead_id: lead ? lead.lead_id : null, version: d.pin_version ? live.number : null },
    });
    await audit(c, {
      actorUserId: actor.user_id || null, action: events.SHARED, moduleKey: events.MODULE, entityRef: shareRef(id),
      after: { lead_id: lead ? lead.lead_id : null, language: d.language, expires_at: expiresAt, pinned: d.pin_version },
    });
    return { share: shareView(await repo.getShare(c, id)), token, path: `/public/profile/${encodeURIComponent(token)}` };
  });
}

async function revokeShare(c, { id, actor = {} }) {
  return atomically(c, async () => {
    const row = await repo.revokeShare(c, id, await resolveActorId(c, actor.user_id));
    if (!row) {
      if (!(await repo.getShare(c, id))) throw new AppError("NOT_FOUND", "Share not found", 404);
      throw new AppError("ALREADY_REVOKED", "This link is already revoked", 422);
    }
    await emitEvent(c, { eventTypeKey: events.SHARE_REVOKED, moduleKey: events.MODULE, entityRef: shareRef(id), actorUserId: actor.user_id || null });
    await audit(c, { actorUserId: actor.user_id || null, action: events.SHARE_REVOKED, moduleKey: events.MODULE, entityRef: shareRef(id), after: { revoked: true } });
    return shareView(await repo.getShare(c, id));
  });
}

async function shareOpens(c, { id }) {
  const share = await repo.getShare(c, id);
  if (!share) throw new AppError("NOT_FOUND", "Share not found", 404);
  return { share: shareView(share), opens: await repo.listOpens(c, id) };
}

module.exports = {
  editor, saveSection, setCover, clearCover, publish, history, diff, preview, pdf,
  refresh, getFresh, published, logos, addLogo, retireLogo,
  shares, createShare, revokeShare, shareOpens,
  // For company_profile_public, which reads the same contract.
  present, render, tokenHash, shareView, imageKind, expiryFrom,
};
