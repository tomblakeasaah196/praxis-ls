"use strict";

/**
 * Insights — the tenant's own articles (WS5).
 *
 * The public shapes live here rather than in the routes because two callers
 * need them: the public read, and `shared/http/public-head.js`, which builds the
 * `<head>` and the `Article` JSON-LD for a crawler that never runs the app.
 */

const { atomically } = require("../../../shared/db/tx");
const { parseDataUrl } = require("../../../utils/data-url");
const vault = require("../../vault/document_vault/document_vault.service");
const { audit, emitEvent } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const events = require("./insight.events");
const repo = require("./insight.repo");
const indexNow = require("../../../shared/http/indexnow");

const ref = (id) => `insight_article:${id}`;

/* ── shapes ──────────────────────────────────────────────────────────────── */

/**
 * The author, as a visitor may see them.
 *
 * Built explicitly rather than by deleting from the row: `app_user` carries a
 * password hash, a TOTP secret and a login history, and a denylist on an
 * anonymous endpoint fails OPEN the next time that table grows a column.
 *
 * Null when nobody is attached. An article whose author has left is
 * unattributed rather than attributed to a blank — the FK is ON DELETE SET NULL
 * precisely so the piece outlives the colleague.
 */
function publicAuthor(row) {
  /* 14680. The byline WRITTEN on the article wins. It is what was signed, on
     the article's date, and several of a library's authors have left or never
     had a login. The role travels with it: a finance head who signed in 2023
     signed as what they were in 2023, not as whatever HR says today. */
  const bylineName = String(row.byline_name || "").trim();
  if (bylineName) {
    return {
      name: bylineName,
      title: String(row.byline_role || "").trim() || null,
      avatar_ref: null,
      photo_id: row.byline_photo_vault_id || null,
    };
  }
  if (!row.author_user_id || !row.author_name) return null;
  return {
    name: row.author_name,
    title: row.author_title || null,
    avatar_ref: row.author_avatar_ref || null,
    photo_id: row.byline_photo_vault_id || null,
  };
}

/**
 * Minutes to read (14680), from the longer of the two bodies at 220 words a
 * minute, which is a careful reader of a technical piece rather than a skimmer.
 * Markdown punctuation is not a word. Null when there is no body, so a card
 * never says "1 min read" over nothing.
 */
const WORDS_PER_MINUTE = 220;
function readingMinutes(row) {
  const count = (s) =>
    String(s || "")
      .replace(/[#*_>`[\]()-]+/g, " ")
      .split(/\s+/)
      .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const words = Math.max(count(row.body_en), count(row.body_fr));
  return words ? Math.max(1, Math.round(words / WORDS_PER_MINUTE)) : null;
}

/**
 * A card in the index. Excerpt and date included, because their site has
 * neither and a knowledge hub that cannot show recency is not credible.
 */
function publicCard(row) {
  return {
    slug_fr: row.slug_fr,
    slug_en: row.slug_en,
    title_fr: row.title_fr,
    title_en: row.title_en,
    excerpt_fr: row.excerpt_fr,
    excerpt_en: row.excerpt_en,
    tags: row.tags || [],
    published_at: row.published_at,
    has_cover: !!row.cover_vault_id,
    cover_id: row.cover_vault_id || null,
    author: publicAuthor(row),
    reading_minutes: readingMinutes(row),
    // 13784. `kind` travels on the card because the renderer differs — an
    // announcement band and an article grid draw the same row two ways — and
    // `pinned_until` travels with it because the band SHOWS the expiry. A pin
    // whose date a visitor cannot see is a pin only the tenant knows is
    // temporary.
    kind: row.kind || "article",
    pinned_until: row.pinned_until || null,
  };
}

/** The article itself. The card, plus the body and the meta the head needs. */
function publicArticle(row) {
  return {
    ...publicCard(row),
    /* Ids, not URLs — same rule the cover follows. The client composes the one
       legal media URL from an id, so a payload that carried a built URL would
       be baking this deploy's hostname into content. Empty for an article with
       no images, which is most of them. */
    gallery_ids: Array.isArray(row.gallery_vault_ids) ? row.gallery_vault_ids : [],
    body_fr: row.body_fr,
    body_en: row.body_en,
    meta_title_fr: row.meta_title_fr,
    meta_title_en: row.meta_title_en,
    meta_description_fr: row.meta_description_fr,
    meta_description_en: row.meta_description_en,
  };
}

/* ── the public read ─────────────────────────────────────────────────────── */

const DEFAULT_PER_PAGE = 9;

/**
 * One page of published articles, plus the filter bar's own contents.
 *
 * The tag list ships WITH the page rather than from a second endpoint, and it is
 * derived from the tags in use. Their filter bar is four hardcoded buttons over
 * six tags in the data, so two articles cannot be reached by any filter — a bug
 * that is invisible until somebody counts. A derived list cannot have it.
 *
 * The list is deliberately NOT filtered down to the tag when computing the bar:
 * a visitor who has narrowed to "strategy" still needs the other tags in front
 * of them, or the only way back is the browser's Back button.
 */
async function listPublic(client, { tag = null, kind = null, year = null, page = 1, perPage = DEFAULT_PER_PAGE } = {}) {
  const offset = (page - 1) * perPage;
  const [rows, total, tags, years] = await Promise.all([
    repo.list(client, { publishedOnly: true, tag, kind, year, limit: perPage, offset }),
    repo.count(client, { publishedOnly: true, tag, kind, year }),
    repo.tagsInUse(client, { publishedOnly: true }),
    // 14680. The year archive ships with the page, derived, like the tags.
    repo.yearsInUse(client, { kind }),
  ]);
  return {
    articles: rows.map(publicCard),
    tags,
    years,
    page,
    per_page: perPage,
    total,
    // Sent rather than left to the browser to compute: the browser would have to
    // know `perPage`, and a rounding disagreement is a "next" button that leads
    // to an empty page.
    has_more: offset + rows.length < total,
  };
}

/* ── announcements (13784, guide §6.4) ────────────────────────────────────── */

/** Re-exported, not re-declared — `insight.kinds` is the one copy, and its
 *  header records why it is a file rather than a line in this one. */
const { KINDS, ANNOUNCEMENT } = require("./insight.kinds");

/**
 * THE CAP, AND WHY IT IS HERE RATHER THAN IN THE CLIENT.
 *
 * Q7 asked for the homepage band to carry "only the very important
 * announcements". A tenant who pins eleven things has not changed their mind
 * about that — they have simply pinned eleven things, which is what people do
 * with a flag that has no cost. The cap is what keeps the band a band.
 *
 * Five, server-side, applied as a `LIMIT` in `repo.listPinned`. A client-side
 * `.slice(0, 5)` would still have sent eleven rows to a phone on a metered
 * connection, and the next caller — the crawler head, an app, PR 4's list page
 * — would not have had the rule at all.
 */
const PINNED_MAX = 5;

/**
 * The homepage's read: the live pins, and the announcements list behind them.
 *
 * ONE ENDPOINT, TWO COLLECTIONS, because the band and its "view more" are one
 * screenful and two requests for them is a second round trip on the LCP path's
 * heels. `pinned` is capped and complete; `articles` is paginated and ordinary.
 *
 * `pinned` is NOT subtracted from `articles`. A pinned announcement is still an
 * announcement, and a visitor who follows "view more" looking for the thing
 * they just saw in the band should find it in the list rather than discover
 * that being important removed it.
 */
async function listPublicAnnouncements(client, { page = 1, perPage = DEFAULT_PER_PAGE } = {}) {
  const [pinnedRows, list] = await Promise.all([
    repo.listPinned(client, { limit: PINNED_MAX, kind: ANNOUNCEMENT }),
    listPublic(client, { kind: ANNOUNCEMENT, page, perPage }),
  ]);
  return { pinned: pinnedRows.map(publicCard), ...list };
}

/**
 * One article by slug, in either language.
 *
 * 404 for unknown AND for unpublished, which are the same fact to a visitor.
 * Distinguishing them would let anyone confirm that a draft exists at a guessed
 * URL, which is how an unannounced piece leaks before its date.
 */
async function getPublic(client, slug) {
  const row = await repo.getBySlug(client, slug, { publishedOnly: true });
  if (!row) throw new AppError("NOT_FOUND", "Article not found", 404);
  // 14680. Three to read next, as cards (no bodies), with the article itself.
  const related = await repo.related(client, {
    id: row.insight_article_id, tags: row.tags || [], limit: RELATED_MAX,
  });
  return { ...publicArticle(row), related: (related || []).map(publicCard) };
}

/** How many related articles close a piece. Three fit one row on a desktop and
 *  are a short scroll on a phone. */
const RELATED_MAX = 3;

/* ── admin ───────────────────────────────────────────────────────────────── */

async function list(client, { tag = null } = {}) {
  return repo.list(client, { publishedOnly: false, tag });
}

async function get(client, id) {
  const row = await repo.get(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Article not found", 404);
  return row;
}

/**
 * Both slugs are checked against BOTH columns.
 *
 * `getBySlug` matches either column, so a French slug colliding with another
 * article's English slug would make one of the two unreachable — the lookup
 * would return whichever the planner found first. The unique indexes are
 * per-column and cannot see that, so the check belongs here.
 */
async function assertSlugsFree(client, patch, exceptId = null) {
  for (const key of ["slug_fr", "slug_en"]) {
    const value = patch[key];
    if (!value) continue;
    if (await repo.slugTaken(client, value, exceptId)) {
      throw new AppError("SLUG_TAKEN", `The slug "${value}" is already in use`, 422, {
        [key]: ["already in use"],
      });
    }
  }
  if (patch.slug_fr && patch.slug_en && patch.slug_fr === patch.slug_en) {
    // Legal in the database (two different columns) and wrong: the two
    // languages would share a URL, which is the thing per-language URLs exist
    // to avoid.
    throw new AppError("SLUG_TAKEN", "The two languages need different slugs", 422, {
      slug_en: ["must differ from the French slug"],
    });
  }
}

async function create(client, { patch, actor = {} }) {
  await assertSlugsFree(client, patch);
  return atomically(client, async () => {
    const row = await repo.insert(client, patch);
    await emitEvent(client, {
      eventTypeKey: events.CREATED,
      moduleKey: events.MODULE,
      entityRef: ref(row.insight_article_id),
      actorUserId: actor.user_id || null,
    });
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.CREATED,
      moduleKey: events.MODULE,
      entityRef: ref(row.insight_article_id),
      before: null,
      after: row,
    });
    return row;
  });
}

async function update(client, { id, patch, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Article not found", 404);
  await assertSlugsFree(client, patch, id);
  // 14680. Either headline may be cleared, not both: the row that RESULTS must
  // still have one. This is the ONLY place that rule holds for an update: the
  // table predates 13791, so 14680 could not add it as a CHECK (see its header).
  const titleAfter = (key) => (Object.prototype.hasOwnProperty.call(patch, key) ? patch[key] : before[key]);
  if (!String(titleAfter("title_en") || "").trim() && !String(titleAfter("title_fr") || "").trim()) {
    throw new AppError("VALIDATION_ERROR", "Give the article a headline in English or French", 422, {
      title_en: ["a headline in English or French is required"],
    });
  }
  const row = await atomically(client, async () => {
    const updated = await repo.update(client, id, patch);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.UPDATED,
      moduleKey: events.MODULE,
      entityRef: ref(id),
      before,
      after: updated,
    });
    return updated;
  });
  // A live article changed: tell the search engines, at its old address too
  // when the slug moved, so the old one is recrawled into its 404.
  if (row && row.is_published) announce(client, [before, row]);
  return row;
}

/**
 * IndexNow (shared/http/indexnow.js): the article's page, the Insights index
 * and the home page, which lists the latest. Fire and forget. An article
 * dated in the future is not live yet, so it is announced on no date at all
 * rather than early; the sitemap carries it once it is.
 */
function announce(client, rows) {
  const live = rows.filter(Boolean);
  const future = live.some((r) => r.published_at && new Date(r.published_at).getTime() > Date.now());
  if (future) return;
  const slugs = [...new Set(live.flatMap((r) => [r.slug_en, r.slug_fr]).filter(Boolean))];
  indexNow.ping(client, [...slugs.map((s) => "/insights/" + encodeURIComponent(s)), "/insights", "/"]);
}

/**
 * Publishing refuses an article with nothing to read.
 *
 * A published row with no body is a URL in a sitemap that renders a title over
 * white space, and it is discovered by a reader rather than by the writer. FR is
 * the language checked because FR is the default and the one column that is NOT
 * NULL — an article written only in English still needs its French body before
 * it is a French-first site's article.
 */
async function setPublished(client, { id, published, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Article not found", 404);
  if (published) {
    if (!String(before.body_fr || "").trim() && !String(before.body_en || "").trim()) {
      throw new AppError("EMPTY_ARTICLE", "Write the article before publishing it", 422, {
        body_en: ["an article needs a body in English or French"],
      });
    }
    if (!before.slug_fr && !before.slug_en) {
      throw new AppError("NO_SLUG", "Give the article a slug before publishing it", 422, {
        slug_fr: ["a published article needs a URL"],
      });
    }
  }
  const row = await atomically(client, async () => {
    const saved = await repo.setPublished(client, id, actor.user_id || null, published);
    const action = published ? events.PUBLISHED : events.UNPUBLISHED;
    await emitEvent(client, {
      eventTypeKey: action,
      moduleKey: events.MODULE,
      entityRef: ref(id),
      actorUserId: actor.user_id || null,
    });
    await audit(client, {
      actorUserId: actor.user_id || null,
      action,
      moduleKey: events.MODULE,
      entityRef: ref(id),
      before,
      after: saved,
    });
    return saved;
  });
  // Published or withdrawn, the address changed state: announce it either
  // way, so a withdrawn piece is recrawled into its 404 rather than lingering.
  announce(client, [row]);
  return row;
}

/**
 * Pin an announcement to the homepage band until a date, or clear the pin.
 *
 * ── WHY IT REFUSES THREE THINGS ────────────────────────────────────────────
 *
 * All three refusals exist because the alternative is a control that appears to
 * work and changes nothing — the worst kind, because the tenant only finds out
 * by looking at their own homepage, which nobody does.
 *
 *   1. NOT AN ANNOUNCEMENT. The band reads `kind = 'announcement'`, so pinning
 *      an ordinary article writes a timestamp no renderer will ever read.
 *   2. NOT PUBLISHED. The band reads published rows, as every public read does.
 *      Pinning a draft is a pin that silently does nothing until somebody
 *      publishes, which may be never.
 *   3. A DATE IN THE PAST. `pinned_until > now()` is the whole mechanism, so an
 *      expiry already behind us is an unpin wearing a pin's clothes. Clearing a
 *      pin is a real thing to want and it has its own spelling: null.
 *
 * Clearing is always allowed, on any row, in any state — you must be able to
 * take something off the front page without first repairing it.
 */
async function setPinned(client, { id, pinnedUntil = null, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Article not found", 404);

  if (pinnedUntil !== null) {
    if ((before.kind || "article") !== ANNOUNCEMENT) {
      throw new AppError("NOT_AN_ANNOUNCEMENT", "Only an announcement can be pinned to the home page", 422, {
        kind: ["change the kind to announcement first"],
      });
    }
    if (!before.is_published) {
      throw new AppError("NOT_PUBLISHED", "Publish the announcement before pinning it", 422, {
        pinned_until: ["the band only shows published announcements"],
      });
    }
    if (new Date(pinnedUntil).getTime() <= Date.now()) {
      throw new AppError("PIN_EXPIRED", "Pin it until a date in the future", 422, {
        pinned_until: ["a date already past is not a pin"],
      });
    }
  }

  return atomically(client, async () => {
    const row = await repo.setPinned(client, id, pinnedUntil);
    const action = pinnedUntil ? events.PINNED : events.UNPINNED;
    await emitEvent(client, {
      eventTypeKey: action,
      moduleKey: events.MODULE,
      entityRef: ref(id),
      actorUserId: actor.user_id || null,
    });
    await audit(client, {
      actorUserId: actor.user_id || null,
      action,
      moduleKey: events.MODULE,
      entityRef: ref(id),
      before,
      after: row,
    });
    return row;
  });
}

/**
 * Deleting refuses a LIVE article, the same rule `site_content` applies to a
 * page: the URL is in search results and possibly linked from somewhere we do
 * not control. Unpublish first, deliberately, then delete.
 */
async function remove(client, { id, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Article not found", 404);
  if (before.is_published) {
    throw new AppError("PUBLISHED", "Unpublish the article before deleting it", 422);
  }
  return atomically(client, async () => {
    await repo.remove(client, id);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.DELETED,
      moduleKey: events.MODULE,
      entityRef: ref(id),
      before,
      after: null,
    });
    return { deleted: true };
  });
}

/* ── COVER ───────────────────────────────────────────────────────────────── */

/**
 * The article cover — the half of this feature that was never built.
 *
 * `insight_article.cover_vault_id` shipped with 12757, the public read serves
 * the bytes (`publicCoverForServe`), the marketing page draws the image, and
 * the vault CHECK was widened in that same migration to admit an `INSIGHT`
 * scope. What was missing was any way to PUT a document there: no upload route,
 * no service, so a cover could only be set by writing the column by hand.
 *
 * This is `service_type_web.uploadMedia` with the parts an article does not
 * have removed — one role instead of three, no gallery, no icon.
 *
 * ── WHY IT IS NOT LOCKED WHILE PUBLISHED ───────────────────────────────────
 *
 * The service profile refuses a media change while published, because its slug
 * and its media are what a shared link resolves to and swapping them under a
 * live page is how a customer's bookmark breaks. An article is different: the
 * URL is the slug alone, the cover is decoration inside it, and the media route
 * is keyed by the DOCUMENT id — replacing a cover mints a new id and therefore a
 * new URL, so nothing that was cached is invalidated and no link breaks. Making
 * a writer unpublish an article to fix a badly cropped photograph would take the
 * piece off the site to change something no link points at.
 */
async function setCover(client, { id, dataUrl, originalName, actor = {}, slug: tenantSlug }) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed || !repo.IMAGE_TYPES.includes(parsed.mimeType)) {
    throw new AppError("BAD_FILE_TYPE", "A cover must be PNG, JPEG or WebP", 422);
  }
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Article not found", 404);

  return atomically(client, async () => {
    const created = await vault.createDocument(client, {
      entityRef: ref(id),
      docType: "INSIGHT_MEDIA",
      dataUrl,
      originalName,
      maxBytes: 10 * 1024 * 1024,
      allowedTypes: repo.IMAGE_TYPES,
      // Sniffed, not trusted: the content type in a data URL is written by the
      // caller, and the public route serves these bytes to strangers with the
      // stored type in the header.
      sniff: true,
      slug: tenantSlug,
      actor,
    });
    await client.query(
      `UPDATE document_vault
          SET public_media_scope = 'INSIGHT', public_media_entity_ref = $2,
              public_media_role = 'COVER', public_media_content_type = $3
        WHERE doc_id = $1`,
      [created.doc_id, ref(id), parsed.mimeType],
    );
    const row = await repo.update(client, id, { cover_vault_id: created.doc_id });
    // Archive the one it replaced and clear its public scope, so the old bytes
    // stop being servable the moment they stop being the cover. Same shape as
    // `success_story.uploadMedia` and `service_type_web.uploadMedia` — an
    // un-scoped orphan in the vault is a public URL nobody remembers owning.
    if (before.cover_vault_id && before.cover_vault_id !== created.doc_id) {
      await archiveArticleMedia(client, before.cover_vault_id, ref(id));
    }
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.UPDATED,
      moduleKey: events.MODULE,
      entityRef: ref(id),
      before: { cover_vault_id: before.cover_vault_id },
      after: { cover_vault_id: created.doc_id },
    });
    await emitEvent(client, {
      eventTypeKey: events.UPDATED,
      moduleKey: events.MODULE,
      entityRef: ref(id),
      actorUserId: actor.user_id || null,
      payload: { insight_article_id: id, cover_vault_id: created.doc_id },
    });
    return row;
  });
}

/** Archive one of an article's images — cover or gallery — and strip what made
 *  it publicly servable. Scoped to the owning article in the WHERE clause, so a
 *  doc id belonging to another entity cannot be archived through this path.
 *  Role is deliberately not in the clause: both roles archive identically, and
 *  a role mismatch would silently leave a public document behind. */
function archiveArticleMedia(client, docId, entityRef) {
  return client.query(
    `UPDATE document_vault
        SET status = 'ARCHIVED', public_media_scope = NULL,
            public_media_entity_ref = NULL, public_media_role = NULL,
            public_media_content_type = NULL
      WHERE doc_id = $1 AND public_media_scope = 'INSIGHT'
        AND public_media_entity_ref = $2`,
    [docId, entityRef],
  );
}

/** Take the cover off. The article keeps everything else; the document is
 *  archived rather than deleted, because the bytes may be referenced by an
 *  audit entry and a hard delete would make that entry a dangling id. */
async function removeCover(client, { id, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Article not found", 404);
  if (!before.cover_vault_id) return before;
  return atomically(client, async () => {
    const row = await repo.update(client, id, { cover_vault_id: null });
    await archiveArticleMedia(client, before.cover_vault_id, ref(id));
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.UPDATED,
      moduleKey: events.MODULE,
      entityRef: ref(id),
      before: { cover_vault_id: before.cover_vault_id },
      after: { cover_vault_id: null },
    });
    return row;
  });
}

/* ── GALLERY ─────────────────────────────────────────────────────────────── */

/** How many images an article may carry below its body. Twelve is past any
 *  honest article and short of a page that scrolls for a minute of thumbnails. */
const GALLERY_MAX = 12;

/**
 * Add one image to the gallery.
 *
 * The cover's twin, with the binding changed: a cover REPLACES and archives what
 * it displaced, a gallery image APPENDS. Order in the array is display order,
 * and a new image goes last because that is where a writer adding one expects
 * to find it.
 */
async function addGalleryImage(client, { id, dataUrl, originalName, actor = {}, slug: tenantSlug }) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed || !repo.IMAGE_TYPES.includes(parsed.mimeType)) {
    throw new AppError("BAD_FILE_TYPE", "An image must be PNG, JPEG or WebP", 422);
  }
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Article not found", 404);
  const current = Array.isArray(before.gallery_vault_ids) ? before.gallery_vault_ids : [];
  if (current.length >= GALLERY_MAX) {
    throw new AppError("LIMIT_REACHED", `An article may carry at most ${GALLERY_MAX} images`, 422);
  }

  return atomically(client, async () => {
    const created = await vault.createDocument(client, {
      entityRef: ref(id),
      docType: "INSIGHT_MEDIA",
      dataUrl,
      originalName,
      maxBytes: 10 * 1024 * 1024,
      allowedTypes: repo.IMAGE_TYPES,
      sniff: true,
      slug: tenantSlug,
      actor,
    });
    await client.query(
      `UPDATE document_vault
          SET public_media_scope = 'INSIGHT', public_media_entity_ref = $2,
              public_media_role = 'GALLERY', public_media_content_type = $3
        WHERE doc_id = $1`,
      [created.doc_id, ref(id), parsed.mimeType],
    );
    const row = await repo.update(client, id, {
      gallery_vault_ids: [...current, created.doc_id],
    });
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.UPDATED,
      moduleKey: events.MODULE,
      entityRef: ref(id),
      before: { gallery_vault_ids: current },
      after: { gallery_vault_ids: row.gallery_vault_ids },
    });
    return row;
  });
}

/**
 * Remove one image, or reorder the whole list.
 *
 * One function because they are one write: the array IS the order, so moving an
 * image and dropping one are both "store this list". The caller sends the list
 * it wants; anything missing from it that was there before is archived, which
 * is what makes a removal stop serving without deleting bytes an audit row may
 * still reference.
 *
 * Ids that were never in the article's own list are ignored rather than stored.
 * Without that, this endpoint would let a caller bind any vault document — one
 * belonging to another tenant's entity, or an unrelated private document — to a
 * public article by naming its id.
 */
async function setGallery(client, { id, ids, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Article not found", 404);
  const current = Array.isArray(before.gallery_vault_ids) ? before.gallery_vault_ids : [];
  const allowed = new Set(current);
  const seen = new Set();
  const next = (Array.isArray(ids) ? ids : []).filter((d) => {
    if (!allowed.has(d) || seen.has(d)) return false;
    seen.add(d);
    return true;
  });
  const dropped = current.filter((d) => !seen.has(d));

  return atomically(client, async () => {
    const row = await repo.update(client, id, { gallery_vault_ids: next });
    for (const docId of dropped) {
      await archiveArticleMedia(client, docId, ref(id));
    }
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.UPDATED,
      moduleKey: events.MODULE,
      entityRef: ref(id),
      before: { gallery_vault_ids: current },
      after: { gallery_vault_ids: next },
    });
    return row;
  });
}

/* ── BYLINE PHOTO (14680) ─────────────────────────────────────────────────── */

/**
 * The byline's photograph. The cover's twin with one difference that matters:
 * the role is LEADER, the vault's existing role for a person's portrait, so
 * `ck_vault_public_media_role` is not widened again (a CHECK that two branches
 * both drop and re-add with their own lists is a CHECK one of them loses).
 *
 * Optional, and separate from the linked staff record on purpose: several
 * authors of a library that runs from 2021 have no login today, and the photo
 * printed beside a dated byline should not change when somebody updates their
 * HR avatar.
 */
async function setBylinePhoto(client, { id, dataUrl, originalName, actor = {}, slug: tenantSlug }) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed || !repo.IMAGE_TYPES.includes(parsed.mimeType)) {
    throw new AppError("BAD_FILE_TYPE", "A photo must be PNG, JPEG or WebP", 422);
  }
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Article not found", 404);

  return atomically(client, async () => {
    const created = await vault.createDocument(client, {
      entityRef: ref(id),
      docType: "INSIGHT_MEDIA",
      dataUrl,
      originalName,
      maxBytes: 10 * 1024 * 1024,
      allowedTypes: repo.IMAGE_TYPES,
      sniff: true,
      slug: tenantSlug,
      actor,
    });
    await client.query(
      `UPDATE document_vault
          SET public_media_scope = 'INSIGHT', public_media_entity_ref = $2,
              public_media_role = 'LEADER', public_media_content_type = $3
        WHERE doc_id = $1`,
      [created.doc_id, ref(id), parsed.mimeType],
    );
    const row = await repo.update(client, id, { byline_photo_vault_id: created.doc_id });
    if (before.byline_photo_vault_id && before.byline_photo_vault_id !== created.doc_id) {
      await archiveArticleMedia(client, before.byline_photo_vault_id, ref(id));
    }
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.UPDATED,
      moduleKey: events.MODULE,
      entityRef: ref(id),
      before: { byline_photo_vault_id: before.byline_photo_vault_id || null },
      after: { byline_photo_vault_id: created.doc_id },
    });
    return row;
  });
}

async function removeBylinePhoto(client, { id, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Article not found", 404);
  if (!before.byline_photo_vault_id) return before;
  return atomically(client, async () => {
    const row = await repo.update(client, id, { byline_photo_vault_id: null });
    await archiveArticleMedia(client, before.byline_photo_vault_id, ref(id));
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.UPDATED,
      moduleKey: events.MODULE,
      entityRef: ref(id),
      before: { byline_photo_vault_id: before.byline_photo_vault_id },
      after: { byline_photo_vault_id: null },
    });
    return row;
  });
}

/* ── IMPORT (14680) ───────────────────────────────────────────────────────── */

/**
 * One Markdown file with front matter → one DRAFT.
 *
 * ── ALWAYS A DRAFT ─────────────────────────────────────────────────────────
 * An import is a batch of somebody else's writing arriving at once, and the
 * guide's rule is that it is read before it goes out. So the import never
 * publishes, whatever the file says; the date it carries is the date the
 * article WILL show once a person presses Publish.
 *
 * ── THE SAME RULES AS THE EDITOR ───────────────────────────────────────────
 * The patch goes through the editor's own create schema and `create`, so the
 * slug rules, the lengths, the headline rule and the audit trail are the ones
 * an article typed by hand meets. A slug already in use is refused per file,
 * which is also what makes importing the same folder twice harmless.
 *
 * Returns the draft plus what was ignored, so the screen can say "imported;
 * `sources` and `note` were not imported" rather than dropping them silently.
 */
async function importMarkdown(client, { name, text, actor = {} }) {
  let parsed;
  try {
    parsed = importer.parseFrontMatter(text);
  } catch (err) {
    throw new AppError("IMPORT_UNREADABLE", `${name}: ${err.message}`, 422);
  }
  const { patch, ignored, cover } = importer.toPatch(parsed);
  if (!patch.slug_en && !patch.slug_fr) {
    throw new AppError("IMPORT_UNREADABLE", `${name}: the front matter has no slug`, 422, {
      slug_en: ["the file needs a slug"],
    });
  }
  const checked = createSchema().safeParse(patch);
  if (!checked.success) {
    throw new AppError(
      "VALIDATION_ERROR",
      `${name}: ${Object.entries(checked.error.flatten().fieldErrors)
        .map(([k, v]) => `${k} ${(v || []).join(", ")}`)
        .join("; ") || "the front matter is not valid"}`,
      422,
      checked.error.flatten().fieldErrors,
    );
  }
  const row = await create(client, { patch: checked.data, actor });
  // `cover` is the image file the front matter names; the import screen
  // attaches it through the cover endpoint, so an import is one selection.
  return { article: row, ignored, cover };
}

/** Required lazily: the validator requires `insight.kinds`, never this file,
 *  and keeping it that way is what lets the validator be tested without Redis. */
const createSchema = () => require("./insight.validator").schemas.create;
const importer = require("./insight.import");

module.exports = {
  DEFAULT_PER_PAGE, GALLERY_MAX, RELATED_MAX, WORDS_PER_MINUTE,
  readingMinutes, importMarkdown, setBylinePhoto, removeBylinePhoto,
  KINDS, ANNOUNCEMENT, PINNED_MAX,
  listPublicAnnouncements, setPinned,
  publicAuthor, publicCard, publicArticle,
  listPublic, getPublic,
  list, get, create, update, setPublished, remove,
  setCover, removeCover,
  addGalleryImage, setGallery,
};
