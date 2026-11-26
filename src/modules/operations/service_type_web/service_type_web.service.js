/**
 * Service-type web profile business logic (guide §4.2, §4.5, §4.6).
 *
 * Owns:
 *   - the publish gate (every row of §4.2), the SAME function the GET
 *     uses to render the readiness checklist — one readiness function,
 *     one source of truth (guide §4.6 last paragraph);
 *   - the "while published" lock for slug and media writes;
 *   - the cover/icon upload (replaces the previous one, archives the old
 *     vault row, clears its public scope);
 *   - the archive auto-unpublish hook (called from service_type.service);
 *   - the audit + event trail.
 */
"use strict";
const { atomically } = require("../../../shared/db/tx");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const aiCopy = require("./service_type_web.ai_copy");
const { parseDataUrl } = require("../../../utils/data-url");
const storage = require("../../../services/storage.service");
const vault = require("../../vault/document_vault/document_vault.service");
const events = require("./service_type_web.events");
const repo = require("./service_type_web.repo");
const { siteLanguages, quoteEngine } = require("@praxis/shared");
const websiteService = require("./website-service");
const siteSwitches = require("../../site/site_settings/site_switches");
const indexNow = require("../../../shared/http/indexnow");

/**
 * English first (website v2). Which half of a bilingual field this tenant
 * needs is the website's switch, not a constant: English on an English-only
 * site, French where French is offered. One rule, from @praxis/shared, so the
 * profile, its FAQ and its pillar names agree with the rest of the site.
 */
async function assertLanguage(client, row, bases, { mustHave = [], prefix = "" } = {}) {
  const site = await siteSwitches.load(client);
  const gaps = siteLanguages.pairGaps(row, bases, site, { mustHave });
  if (gaps.length) {
    throw new AppError(
      "VALIDATION_ERROR",
      siteLanguages.gapMessage(site),
      422,
      Object.fromEntries(gaps.map((g) => [`${prefix}${g}`, [siteLanguages.gapMessage(site)]])),
    );
  }
}

const PROFILE_COPY = [
  "short_description", "long_description", "highlights", "coverage",
  "meta_title", "meta_description", "claim",
];

const IMAGE_TYPES = repo.IMAGE_TYPES;
const ref = (id) => `service_type:${id}`;

const WRITABLE = [
  "short_description_fr", "short_description_en",
  "long_description_fr", "long_description_en",
  "highlights_fr", "highlights_en",
  "coverage_fr", "coverage_en",
  "slug_fr", "slug_en",
  "meta_title_fr", "meta_title_en",
  "meta_description_fr", "meta_description_en",
  "cover_vault_id", "icon_vault_id",
  "gallery_vault_ids",
  "video_url",
  "sort_order",
  "group_id", "claim_fr", "claim_en", "accent",
  // 14640 — the website's name for the service, and the homepage band.
  "web_name_en", "web_name_fr", "is_featured",
];

/** `pick` of the patch — every key present in the request body is sent
 *  through; absent keys are simply not sent (omitted-keys-unchanged). The
 *  service has the WRITABLE allow-list, the validator is `.strict()`,
 *  query-helpers accept only its own identifiers — three layers, as
 *  recommended by `check-write-route-validators.js`'s header. */
const pickWritable = (patch) => {
  const out = {};
  for (const key of WRITABLE) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) out[key] = patch[key];
  }
  return out;
};

/* ── READINESS — the one function the GET and the publish gate share ────── */

/**
 * The §4.6 readiness object. Computed per call (never stored), so ticking
 * an item elsewhere (e.g. setting `name_en` in the service-type edit modal)
 * reflects on the next GET with no cache to invalidate.
 *
 * The `missing` array names the first item not yet ticked — the publish
 * endpoint also throws on missing.length > 0, and the FE checklist renders
 * the same array.
 */
function computeReadiness({ profile, serviceType, site = null }) {
  const has = (v) => v !== null && v !== undefined && String(v).trim() !== "";
  // English first (website v2): on an English-only site the French half is
  // optional, so a missing French line never blocks publishing. Where French
  // is offered, both halves are required, exactly as before. A caller that
  // passes no switches keeps the old rule.
  const frenchOptional = site !== null && !siteLanguages.offersFrench(site);
  const coverSet = Boolean(profile && profile.cover_vault_id);
  const cover = {
    present: coverSet,
    // coverAllowed is the allowlist truth (VERIFIED + scoped + image).
    // Without the allowlist check, a profile whose cover was archived
    // would still report "present" and let publish through; the public
    // media route re-checks this exact shape before streaming.
    allowed: Boolean(profile && profile.cover_allowed),
  };
  const nameEnPresent = Boolean(serviceType && has(serviceType.name_en));
  const items = {
    name_en: nameEnPresent,
    short_fr: has(profile && profile.short_description_fr),
    short_en: has(profile && profile.short_description_en),
    long_fr: has(profile && profile.long_description_fr),
    long_en: has(profile && profile.long_description_en),
    slug_fr: has(profile && profile.slug_fr),
    slug_en: has(profile && profile.slug_en),
    cover: cover.allowed,
  };
  const missing = [];
  if (!items.name_en) missing.push("name_en");
  if (!items.short_fr && !frenchOptional) missing.push("short_description_fr");
  if (!items.short_en) missing.push("short_description_en");
  if (!items.long_fr && !frenchOptional) missing.push("long_description_fr");
  if (!items.long_en) missing.push("long_description_en");
  if (!items.slug_fr && !frenchOptional) missing.push("slug_fr");
  if (!items.slug_en) missing.push("slug_en");
  if (!items.cover) missing.push("cover_image");
  return {
    name_en_present: items.name_en,
    short_fr: items.short_fr,
    short_en: items.short_en,
    long_fr: items.long_fr,
    long_en: items.long_en,
    slug_fr: items.slug_fr,
    slug_en: items.slug_en,
    cover,
    publishable: missing.length === 0,
    missing,
  };
}

/* ── ADMIN GET (always 200 for a known service type) ────────────────────── */

async function getTab(client, serviceTypeId) {
  const exists = await repo.serviceTypeExists(client, serviceTypeId);
  if (!exists) throw new AppError("NOT_FOUND", "Service type not found", 404);
  const [profile, serviceType] = await Promise.all([
    repo.getProfile(client, serviceTypeId),
    repo.serviceTypeForPublish(client, serviceTypeId),
  ]);
  // Profile is null when no row exists yet — the FE renders the empty
  // state from the readiness object without ever branching on a 404.
  const effective = profile || repo.emptyProfile(serviceTypeId);
  // The cover.allowed flag is a server-side allowlist check; the FE
  // checklist renders the gate, the publish endpoint enforces it.
  effective.cover_allowed = Boolean(
    effective.cover_vault_id && await isCoverAllowed(client, effective.cover_vault_id, serviceTypeId),
  );
  const [faq, related] = await Promise.all([
    repo.listFaq(client, serviceTypeId),
    repo.listRelated(client, serviceTypeId),
  ]);
  return {
    profile: profile || null,
    faq,
    related,
    readiness: computeReadiness({ profile: effective, serviceType, site: await siteSwitches.load(client) }),
    // The website service (14640): the other types it quotes for, its own
    // routing rules beside the generic ones, and what the engine warns about.
    ...(await websiteSection(client, serviceType)),
    service_type: { is_active: serviceType.is_active, name_fr: serviceType.name_fr, name_en: serviceType.name_en },
  };
}

async function isCoverAllowed(client, vaultId, serviceTypeId) {
  if (!vaultId) return false;
  const doc = await repo.vaultMediaForServe(client, vaultId);
  if (!doc) return false;
  return doc.public_media_entity_ref === ref(serviceTypeId) && doc.public_media_role === "COVER";
}

/* ── UPSERT (the one writer for the profile) ─────────────────────────────── */

async function upsertProfile(client, { serviceTypeId, patch, actor = {} }) {
  const exists = await repo.serviceTypeExists(client, serviceTypeId);
  if (!exists) throw new AppError("NOT_FOUND", "Service type not found", 404);
  const before = await repo.getProfile(client, serviceTypeId);
  if (before && before.is_published) {
    // §4.2 rule 4: slug + media are LOCKED while published. Copy edits
    // (descriptions, highlights, meta, video, sort_order) stay live.
    if (patch.slug_fr !== undefined || patch.slug_en !== undefined
      || patch.cover_vault_id !== undefined || patch.icon_vault_id !== undefined
      || patch.gallery_vault_ids !== undefined) {
      throw new AppError("LOCKED", "Unpublish before changing slugs or media", 422);
    }
  }
  const fields = pickWritable(patch || {});
  await assertLanguage(client, { ...(before || {}), ...fields }, PROFILE_COPY);
  // An unknown pillar would otherwise reach the FK and surface as a 500 with a
  // Postgres string in it. Named field, 422, same shape as SLUG_TAKEN. Null is
  // allowed through untouched — clearing the pillar is how a service returns to
  // the trailing unnamed group.
  if (fields.group_id) {
    const group = await repo.getGroup(client, fields.group_id);
    if (!group) {
      throw new AppError("NOT_FOUND", "Pillar not found", 422, {
        group_id: ["no such pillar"],
      });
    }
  }
  // Slug-uniqueness: drafts included, so two services cannot both want the same
  // /fr/<slug>. The partial unique index (ux_stwp_slug_fr / _en) is the real
  // guard; this is the friendlier one — it turns 23505 into a 422 that names
  // the field the form can show it against.
  //
  // Deliberately NOT gated on an existing row. It used to sit inside
  // `if (before)`, which skipped it on exactly the write most likely to collide:
  // the FIRST save of a page, where the slug is whatever the tab suggested from
  // the service name and has never been checked against anything. That write
  // reached the unique index and came back as the generic constraint handler's
  // "a record with these values already exists" — no field, no slug, and no clue
  // which of the two languages was the problem.
  //
  // `before` is still consulted, only as the skip: re-sending the slug a row
  // already has is not a collision with itself.
  for (const lang of ["fr", "en"]) {
    const key = `slug_${lang}`;
    if (fields[key] && (!before || fields[key] !== before[key])) {
      const dup = await client.query(
        `SELECT 1 FROM service_type_web_profile
          WHERE slug_${lang} = $1 AND service_type_id <> $2 LIMIT 1`,
        [fields[key], serviceTypeId],
      );
      if (dup.rowCount) {
        throw new AppError(
          "SLUG_TAKEN",
          `Another service already uses the slug "${fields[key]}" in language "${lang}"`,
          422,
          { [key]: ["already in use"] },
        );
      }
    }
  }
  return atomically(client, async () => {
    const row = await repo.upsertProfile(client, serviceTypeId, fields);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: before ? events.UPDATED : events.CREATED,
      moduleKey: events.MODULE,
      entityRef: ref(serviceTypeId),
      before: before || null,
      after: row,
    });
    return getTab(client, serviceTypeId);
  });
}

/* ── PUBLISH / UNPUBLISH ─────────────────────────────────────────────────── */

/**
 * Tell the search engines a service page changed state (shared/http/indexnow.js):
 * the page, the services index and the home page. Fire and forget, after the
 * transaction, from the slugs the transaction read: the connection is not
 * touched again once the publish has returned.
 */
function announce(client, profile) {
  if (!profile) return;
  const slugs = [profile.slug_en, profile.slug_fr].filter(Boolean);
  indexNow.ping(client, [...new Set(slugs)].map((s) => "/services/" + encodeURIComponent(s)).concat(["/services", "/"]));
}

async function publish(client, { serviceTypeId, actor = {} }) {
  const exists = await repo.serviceTypeExists(client, serviceTypeId);
  if (!exists) throw new AppError("NOT_FOUND", "Service type not found", 404);
  let announced = null;
  const out = await atomically(client, async () => {
    const profile = await repo.lockProfile(client, serviceTypeId);
    announced = profile;
    const serviceType = await repo.serviceTypeForPublish(client, serviceTypeId);
    if (!serviceType) throw new AppError("NOT_FOUND", "Service type not found", 404);
    if (!serviceType.is_active) {
      throw new AppError("INACTIVE_SERVICE_TYPE", "Inactive service types cannot be published", 422);
    }
    if (!profile) {
      throw new AppError("NOT_FOUND", "Web profile not found — create one before publishing", 404);
    }
    // cover_allowed is a server-side allowlist truth, not the FE checkbox.
    const enriched = { ...profile, cover_allowed: await isCoverAllowed(client, profile.cover_vault_id, serviceTypeId) };
    const readiness = computeReadiness({ profile: enriched, serviceType, site: await siteSwitches.load(client) });
    if (!readiness.publishable) {
      throw new AppError(
        "INCOMPLETE_PROFILE",
        `Cannot publish: missing ${readiness.missing.join(", ")}`,
        422,
        { missing: readiness.missing },
      );
    }
    const before = profile;
    const row = await repo.setPublished(client, serviceTypeId, await resolveActorId(client, actor.user_id));
    await emitEvent(client, {
      eventTypeKey: events.PUBLISHED,
      moduleKey: events.MODULE,
      entityRef: ref(serviceTypeId),
      actorUserId: actor.user_id || null,
    });
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.PUBLISHED,
      moduleKey: events.MODULE,
      entityRef: ref(serviceTypeId),
      before,
      after: row,
    });
    return getTab(client, serviceTypeId);
  });
  announce(client, announced);
  return out;
}

async function unpublish(client, { serviceTypeId, actor = {} }) {
  const exists = await repo.serviceTypeExists(client, serviceTypeId);
  if (!exists) throw new AppError("NOT_FOUND", "Service type not found", 404);
  let announced = null;
  const out = await atomically(client, async () => {
    const before = await repo.lockProfile(client, serviceTypeId);
    if (!before) throw new AppError("NOT_FOUND", "No web profile to unpublish", 404);
    if (!before.is_published) {
      // Idempotent — already unpublished is not an error.
      return getTab(client, serviceTypeId);
    }
    const row = await repo.setUnpublished(client, serviceTypeId);
    announced = before;
    await emitEvent(client, {
      eventTypeKey: events.UNPUBLISHED,
      moduleKey: events.MODULE,
      entityRef: ref(serviceTypeId),
      actorUserId: actor.user_id || null,
    });
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.UNPUBLISHED,
      moduleKey: events.MODULE,
      entityRef: ref(serviceTypeId),
      before,
      after: row,
    });
    return getTab(client, serviceTypeId);
  });
  announce(client, announced);
  return out;
}

/* ── MEDIA ───────────────────────────────────────────────────────────────── */

async function uploadMedia(client, { serviceTypeId, role, dataUrl, originalName, actor = {}, slug: tenantSlug }) {
  const exists = await repo.serviceTypeExists(client, serviceTypeId);
  if (!exists) throw new AppError("NOT_FOUND", "Service type not found", 404);
  const parsed = parseDataUrl(dataUrl);
  if (!parsed || !IMAGE_TYPES.includes(parsed.mimeType)) {
    throw new AppError("BAD_FILE_TYPE", "Service media must be PNG, JPEG or WebP", 422);
  }
  let created = null;
  try {
    return await atomically(client, async () => {
      const profile = await repo.lockProfile(client, serviceTypeId);
      if (!profile) {
        // A media upload before the first profile save is rejected — there
        // is no row to bind the doc to, and allowing it would orphan a
        // vault document. 404 NOT_FOUND is the right code: the resource
        // (the profile) the caller wants to act on does not exist.
        throw new AppError("NOT_FOUND", "Web profile not found — create one before uploading media", 404);
      }
      if (profile.is_published) {
        throw new AppError("LOCKED", "Unpublish before changing web profile media", 422);
      }
      created = await vault.createDocument(client, {
        entityRef: ref(serviceTypeId),
        docType: "SERVICE_TYPE_MEDIA",
        dataUrl,
        originalName,
        maxBytes: 10 * 1024 * 1024,
        allowedTypes: IMAGE_TYPES,
        sniff: true,
        slug: tenantSlug,
        actor,
      });
      await client.query(
        `UPDATE document_vault
            SET public_media_scope = 'SERVICE_TYPE', public_media_entity_ref = $2,
                public_media_role = $3, public_media_content_type = $4
          WHERE doc_id = $1`,
        [created.doc_id, ref(serviceTypeId), role, parsed.mimeType],
      );
      // Bind on the profile. COVER / ICON are scalars; GALLERY appends.
      const fields = {};
      let replacedId = null;
      if (role === "COVER") {
        replacedId = profile.cover_vault_id;
        fields.cover_vault_id = created.doc_id;
      } else if (role === "ICON") {
        replacedId = profile.icon_vault_id;
        fields.icon_vault_id = created.doc_id;
      } else {
        // GALLERY
        const seen = new Set(profile.gallery_vault_ids || []);
        seen.add(created.doc_id);
        fields.gallery_vault_ids = [...seen];
      }
      await repo.upsertProfile(client, serviceTypeId, fields);
      // Replace: archive + clear scope of the OLD cover/icon. The success
      // story pattern (`success_story.service.js:uploadMedia`) does the
      // same — no orphaned public bytes.
      if (replacedId && replacedId !== created.doc_id) {
        await client.query(
          `UPDATE document_vault
              SET status = 'ARCHIVED', public_media_scope = NULL,
                  public_media_entity_ref = NULL, public_media_role = NULL,
                  public_media_content_type = NULL
            WHERE doc_id = $1 AND public_media_scope = 'SERVICE_TYPE'
              AND public_media_entity_ref = $2`,
          [replacedId, ref(serviceTypeId)],
        );
      }
      await audit(client, {
        actorUserId: actor.user_id || null,
        action: events.MEDIA_ADDED,
        moduleKey: events.MODULE,
        entityRef: ref(serviceTypeId),
        before: profile,
        after: { doc_id: created.doc_id, role },
      });
      return getTab(client, serviceTypeId);
    });
  } catch (err) {
    if (created && created.storage_path) {
      try { await storage.delete(created.storage_path); } catch {
        /* @silent:storage|teardown */
        /* best-effort cleanup of an upload the surrounding transaction did not commit */
      }
    }
    throw err;
  }
}

async function removeMedia(client, { serviceTypeId, documentId, actor = {} }) {
  const exists = await repo.serviceTypeExists(client, serviceTypeId);
  if (!exists) throw new AppError("NOT_FOUND", "Service type not found", 404);
  return atomically(client, async () => {
    const profile = await repo.lockProfile(client, serviceTypeId);
    if (!profile) throw new AppError("NOT_FOUND", "No web profile to remove media from", 404);
    if (profile.is_published) {
      throw new AppError("LOCKED", "Unpublish before changing web profile media", 422);
    }
    const bound = await client.query(
      `SELECT public_media_role FROM document_vault
        WHERE doc_id = $1 AND public_media_scope = 'SERVICE_TYPE'
          AND public_media_entity_ref = $2 FOR UPDATE`,
      [documentId, ref(serviceTypeId)],
    );
    const role = bound.rows[0] && bound.rows[0].public_media_role;
    if (!role) throw new AppError("NOT_FOUND", "Web profile media not found", 404);
    const fields = {};
    if (role === "COVER" && profile.cover_vault_id === documentId) fields.cover_vault_id = null;
    if (role === "ICON" && profile.icon_vault_id === documentId) fields.icon_vault_id = null;
    if (role === "GALLERY") {
      fields.gallery_vault_ids = (profile.gallery_vault_ids || []).filter((id) => id !== documentId);
    }
    await client.query(
      `UPDATE document_vault
          SET status = 'ARCHIVED', public_media_scope = NULL,
              public_media_entity_ref = NULL, public_media_role = NULL,
              public_media_content_type = NULL
        WHERE doc_id = $1`,
      [documentId],
    );
    await repo.upsertProfile(client, serviceTypeId, fields);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.MEDIA_REMOVED,
      moduleKey: events.MODULE,
      entityRef: ref(serviceTypeId),
      before: profile,
      after: { doc_id: documentId, role },
    });
    return getTab(client, serviceTypeId);
  });
}

/* ── WEBSITE SERVICE: members and quote routing (14640) ──────────────────── */

/**
 * What the tab shows about the website service: the other types it quotes
 * for, the routing rules (its own and the generic ones), the engine's
 * warnings, and a preview of where each picked Incoterm lands, so the person
 * editing it sees the consequence before a visitor does.
 */
async function websiteSection(client, serviceType) {
  const serviceTypeId = serviceType.service_type_id;
  const [members, rules, listed] = await Promise.all([
    repo.membersOf(client, [serviceTypeId]),
    repo.routeRules(client, [serviceTypeId]),
    repo.listMembers(client, serviceTypeId),
  ]);
  const descriptor = websiteService.descriptorOf(serviceType, members || []);
  const forEngine = (rules || []).map(websiteService.ruleOut);
  const preview = [];
  for (const direction of quoteEngine.directionsOf(descriptor)) {
    for (const incoterm of quoteEngine.incotermsOf(descriptor)) {
      const r = quoteEngine.evaluate(descriptor, { direction, knows: "YES", incoterm }, forEngine);
      preview.push({
        direction,
        incoterm,
        span: r.span,
        outcome: r.next === "member" ? "CHOOSE" : r.outcome,
        reason: r.reason,
        service_type_id: r.service_type_id,
      });
    }
  }
  return {
    members: listed || [],
    routing: {
      kind: quoteEngine.kindOf(descriptor),
      own: (rules || []).filter((r) => r.website_service_id),
      generic: (rules || []).filter((r) => !r.website_service_id),
      preview,
    },
    engine_warnings: quoteEngine.validateService(descriptor, forEngine),
  };
}

/**
 * Set the other ERP types this website service quotes for (set-replace).
 *
 * A type belongs to one website service at most, and a type that is itself a
 * published website service cannot also stand under another: either would let
 * one request route two ways. Both are refused with the holder named.
 */
async function replaceMembers(client, { serviceTypeId, memberIds, actor = {} }) {
  const exists = await repo.serviceTypeExists(client, serviceTypeId);
  if (!exists) throw new AppError("NOT_FOUND", "Service type not found", 404);
  const ids = [...new Set(memberIds || [])];
  if (ids.includes(serviceTypeId)) {
    throw new AppError("MEMBER_IS_SELF", "A website service already quotes for its own service type", 422, {
      member_service_type_ids: ["its own service type is always included"],
    });
  }
  if (ids.length) {
    const { rows: found } = await client.query(
      "SELECT service_type_id FROM service_type WHERE service_type_id = ANY($1::uuid[]) AND is_active = true",
      [ids],
    );
    const ok = new Set(found.map((r) => r.service_type_id));
    const bad = ids.filter((id) => !ok.has(id));
    if (bad.length) {
      throw new AppError("MEMBER_INVALID", "Choose active service types only", 422, {
        member_service_type_ids: bad.map((id) => `${id} is not an active service type`),
      });
    }
    const held = await repo.memberHolders(client, ids, serviceTypeId);
    if (held.length) {
      throw new AppError("MEMBER_TAKEN", "A service type belongs to one website service only", 422, {
        member_service_type_ids: held.map((h) => (h.held_as === "MEMBER"
          ? `already quoted under ${h.holder_name_en}`
          : `${h.holder_name_en} is a published website service of its own`)),
      });
    }
  }
  return atomically(client, async () => {
    const profile = await repo.lockProfile(client, serviceTypeId);
    if (!profile) throw new AppError("NOT_FOUND", "Web profile not found: create one first", 404);
    const before = await repo.listMembers(client, serviceTypeId);
    const after = await repo.replaceMembers(client, serviceTypeId, ids);
    // A rule naming a type that is no longer a member would send quotes to
    // the desk with NO_MEMBER; drop it with the membership it depended on.
    await client.query(
      `DELETE FROM quote_route_rule
        WHERE website_service_id = $1 AND outcome = 'TYPE'
          AND service_type_id <> $1 AND NOT (service_type_id = ANY($2::uuid[]))`,
      [serviceTypeId, ids],
    );
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.MEMBERS_UPDATED,
      moduleKey: events.MODULE,
      entityRef: ref(serviceTypeId),
      before: { members: before.map((m) => m.service_type_id) },
      after: { members: after.map((m) => m.service_type_id) },
    });
    return getTab(client, serviceTypeId);
  });
}

/** 422 with each problem named by row, from the engine's own rule check. */
function assertRules(rows, { requireComplete }) {
  const issues = quoteEngine.validateRules(rows, { requireComplete });
  if (!issues.length) return;
  const fields = {};
  for (const i of issues) {
    const key = i.index === null ? "rows" : `rows.${i.index}.${i.field}`;
    fields[key] = [...(fields[key] || []), i.message];
  }
  throw new AppError("ROUTING_INVALID", issues[0].message, 422, fields);
}

/**
 * Set the routing rules for one website service (its overrides; empty means
 * "the generic rules decide every cell"), or, with no service, the generic set,
 * which must cover all twelve cells so no work is ever unrouted.
 */
async function replaceRules(client, { serviceTypeId = null, rows = [], actor = {} }) {
  const scoped = (rows || []).map((r) => ({
    website_service_id: serviceTypeId,
    direction: r.direction,
    span: r.span,
    outcome: r.outcome,
    service_type_id: r.outcome === "TYPE" ? r.service_type_id || null : null,
    note: r.note || null,
  }));
  assertRules(scoped, { requireComplete: !serviceTypeId });
  if (serviceTypeId) {
    const exists = await repo.serviceTypeExists(client, serviceTypeId);
    if (!exists) throw new AppError("NOT_FOUND", "Service type not found", 404);
    const members = await repo.membersOf(client, [serviceTypeId]);
    const ids = new Set(members.map((m) => m.service_type_id));
    const fields = {};
    scoped.forEach((r, i) => {
      if (r.outcome === "TYPE" && !ids.has(r.service_type_id)) {
        fields[`rows.${i}.service_type_id`] = ["not one of this website service's types"];
      }
    });
    if (Object.keys(fields).length) {
      throw new AppError("ROUTING_INVALID", "A rule can only name one of this website service's types", 422, fields);
    }
  }
  const actorId = await resolveActorId(client, actor.user_id);
  return atomically(client, async () => {
    if (serviceTypeId) {
      const profile = await repo.lockProfile(client, serviceTypeId);
      if (!profile) throw new AppError("NOT_FOUND", "Web profile not found: create one first", 404);
    }
    const mine = (r) => (serviceTypeId ? Boolean(r.website_service_id) : !r.website_service_id);
    const before = await repo.routeRules(client, serviceTypeId ? [serviceTypeId] : []);
    const after = await repo.replaceRules(client, serviceTypeId, scoped.map((r) => ({ ...r, updated_by: actorId })));
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.ROUTING_UPDATED,
      moduleKey: events.MODULE,
      entityRef: serviceTypeId ? ref(serviceTypeId) : "quote_route_rule:generic",
      before: { rules: before.filter(mine).map(websiteService.ruleOut) },
      after: { rules: after.filter(mine).map(websiteService.ruleOut) },
    });
    return serviceTypeId ? getTab(client, serviceTypeId) : genericRules(client);
  });
}

/** The generic rules, for the Master Data panel that edits them. */
async function genericRules(client) {
  const rows = await repo.routeRules(client, []);
  return { generic: rows.filter((r) => !r.website_service_id), defaults: quoteEngine.DEFAULT_RULES };
}

/* ── FAQ + RELATED ───────────────────────────────────────────────────────── */

async function replaceFaq(client, { serviceTypeId, rows, actor = {} }) {
  const exists = await repo.serviceTypeExists(client, serviceTypeId);
  if (!exists) throw new AppError("NOT_FOUND", "Service type not found", 404);
  // FAQ is copy, not slug/media — it stays live while published. The audit
  // called out the asymmetry with `/related` (deliberately live) and made
  // the FAQ lock look like an over-application. Guide §4.2 rule 4 is
  // "slug + media 422 LOCKED"; FAQ edits are a CMS typo fix that must
  // not require downtime (rule 4's own rationale).
  for (const [i, row] of (rows || []).entries()) {
    await assertLanguage(client, row, ["question", "answer"], {
      mustHave: ["question", "answer"],
      prefix: `rows.${i}.`,
    });
  }
  return atomically(client, async () => {
    const profile = await repo.lockProfile(client, serviceTypeId);
    if (!profile) throw new AppError("NOT_FOUND", "Web profile not found — create one before adding FAQ", 404);
    const list = await repo.replaceFaq(client, serviceTypeId, rows);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.FAQ_UPDATED,
      moduleKey: events.MODULE,
      entityRef: ref(serviceTypeId),
      after: { row_count: list.length },
    });
    return { faq: list, tab: await getTab(client, serviceTypeId) };
  });
}

async function replaceRelated(client, { serviceTypeId, relatedIds, actor = {} }) {
  const exists = await repo.serviceTypeExists(client, serviceTypeId);
  if (!exists) throw new AppError("NOT_FOUND", "Service type not found", 404);
  // Defence-in-depth against the table CHECK and the validator's no-self
  // rule. The service_type table's PK catches the FK case.
  for (const id of relatedIds) {
    if (id === serviceTypeId) {
      throw new AppError("RELATED_IS_SELF", "A service cannot be related to itself", 422);
    }
  }
  // Validate that every id resolves to an existing, ACTIVE service type —
  // showing an archived service on a live web page is the same kind of
  // error as the public-list filter is there to prevent.
  if (relatedIds.length) {
    const { rows: found } = await client.query(
      `SELECT service_type_id FROM service_type
        WHERE service_type_id = ANY($1::uuid[]) AND is_active = true`,
      [relatedIds],
    );
    if (found.length !== relatedIds.length) {
      throw new AppError("NOT_FOUND", "One or more related service ids are unknown or inactive", 404);
    }
  }
  return atomically(client, async () => {
    const profile = await repo.lockProfile(client, serviceTypeId);
    if (!profile) throw new AppError("NOT_FOUND", "Web profile not found — create one before adding related services", 404);
    // Related is a metadata tweak, not a slug/media change — stays live
    // while published. Same reasoning as copy edits.
    const list = await repo.replaceRelated(client, serviceTypeId, relatedIds);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.RELATED_UPDATED,
      moduleKey: events.MODULE,
      entityRef: ref(serviceTypeId),
      after: { related_service_type_ids: list },
    });
    return { related: list, tab: await getTab(client, serviceTypeId) };
  });
}

/* ── ARCHIVE AUTO-UNPUBLISH HOOK (guide §4.2 rule 2) ────────────────────── */

/**
 * Called by service_type.service.archive INSIDE the same transaction that
 * flips is_active = false. Returns the row that was unpublish-here, or
 * null. We do not throw on missing profile — archiving a service type
 * that has no web presence is a legitimate empty-state case.
 */
async function autoUnpublishForArchive(client, serviceTypeId) {
  return repo.autoUnpublishForServiceType(client, serviceTypeId);
}

/* ── Pillars (12755) ─────────────────────────────────────────────────────── */

const groupRef = (id) => `service_type_web_group:${id}`;

const listGroups = (client) => repo.listGroups(client);

/**
 * `key` is the anchor a shared link lands on (`/services#freight`), so a
 * collision is a 422 with the field named rather than a raw 23505.
 */
async function createGroup(client, { patch, actor = {} }) {
  await assertLanguage(client, patch, ["name"], { mustHave: ["name"] });
  if (await repo.groupKeyTaken(client, patch.key)) {
    throw new AppError("KEY_TAKEN", `A pillar already uses the key "${patch.key}"`, 422, {
      key: ["already in use"],
    });
  }
  return atomically(client, async () => {
    const row = await repo.createGroup(client, patch);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.GROUP_CREATED,
      moduleKey: events.MODULE,
      entityRef: groupRef(row.group_id),
      before: null,
      after: row,
    });
    return row;
  });
}

async function updateGroup(client, { groupId, patch, actor = {} }) {
  const before = await repo.getGroup(client, groupId);
  if (!before) throw new AppError("NOT_FOUND", "Pillar not found", 404);
  await assertLanguage(client, { ...before, ...patch }, ["name"], { mustHave: ["name"] });
  if (patch.key && patch.key !== before.key
      && await repo.groupKeyTaken(client, patch.key, groupId)) {
    throw new AppError("KEY_TAKEN", `A pillar already uses the key "${patch.key}"`, 422, {
      key: ["already in use"],
    });
  }
  return atomically(client, async () => {
    const row = await repo.updateGroup(client, groupId, patch);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.GROUP_UPDATED,
      moduleKey: events.MODULE,
      entityRef: groupRef(groupId),
      before,
      after: row,
    });
    return row;
  });
}

/**
 * Deleting a pillar never deletes its services — the FK is ON DELETE SET NULL,
 * so they fall back to the trailing unnamed group and keep rendering. The
 * count is returned so the caller can say what moved rather than leaving the
 * operator to discover it on the live page.
 */
async function deleteGroup(client, { groupId, actor = {} }) {
  const before = await repo.getGroup(client, groupId);
  if (!before) throw new AppError("NOT_FOUND", "Pillar not found", 404);
  return atomically(client, async () => {
    const { rows } = await client.query(
      "SELECT COUNT(*)::int AS n FROM service_type_web_profile WHERE group_id = $1",
      [groupId],
    );
    const released = rows[0] ? rows[0].n : 0;
    await repo.deleteGroup(client, groupId);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.GROUP_DELETED,
      moduleKey: events.MODULE,
      entityRef: groupRef(groupId),
      before,
      after: null,
    });
    return { deleted: true, released_services: released };
  });
}


/**
 * Draft website copy with the assistant. WRITES NOTHING.
 *
 * The proposal goes back to the tab and the author accepts it field by field.
 * A generator that saved its own output would be the same defect this screen
 * was just repaired for — an unattended write landing on top of authored copy —
 * and it would arrive with the author's own permission attached, which makes it
 * harder to argue with rather than safer.
 */
async function draftCopy(client, { serviceTypeId, input, actor = {}, env = "live" }) {
  const exists = await repo.serviceTypeExists(client, serviceTypeId);
  if (!exists) throw new AppError("NOT_FOUND", "Service type not found", 404);
  const [profile, serviceType] = await Promise.all([
    repo.getProfile(client, serviceTypeId),
    repo.serviceTypeForPublish(client, serviceTypeId),
  ]);
  return aiCopy.draft(client, { profile, serviceType, input, actor, env });
}

module.exports = {
  // admin
  getTab,
  // pillars (12755)
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  upsertProfile,
  publish,
  unpublish,
  uploadMedia,
  removeMedia,
  replaceFaq,
  replaceRelated,
  replaceMembers,
  replaceRules,
  genericRules,
  draftCopy,
  // hooks
  autoUnpublishForArchive,
  // exposed for tests
  computeReadiness,
  pickWritable,
  WRITABLE,
};
