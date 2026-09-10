"use strict";

/**
 * Insights (WS5) — the module built to fix a specific set of faults on
 * smartls.cm's Kaizen Hub, each of which has a wrong version that looks right.
 *
 * The two worth reading first:
 *
 *   · **the filter bar is derived, never listed.** Theirs hardcodes four buttons
 *     over six tags in the data, so two articles are unreachable by any filter.
 *     That bug is invisible until somebody counts, and a hardcoded list can only
 *     ever regain it.
 *   · **an unpublished article and an unknown slug are the same 404.**
 *     Distinguishing them lets anyone confirm a draft exists at a guessed URL,
 *     which is how an unannounced piece leaks before its date.
 */

jest.mock("../../src/modules/content/insight/insight.repo");
jest.mock("../../src/shared/db/tx", () => ({ atomically: (_c, fn) => fn() }));
jest.mock("../../src/shared/events/emit", () => ({ audit: jest.fn(), emitEvent: jest.fn() }));

const repo = require("../../src/modules/content/insight/insight.repo");
const service = require("../../src/modules/content/insight/insight.service");
const { schemas } = require("../../src/modules/content/insight/insight.validator");

const client = {};
const row = (over = {}) => ({
  insight_article_id: "a1",
  slug_fr: "la-douane-en-2026",
  slug_en: "customs-in-2026",
  title_fr: "La douane en 2026",
  title_en: "Customs in 2026",
  excerpt_fr: "Ce qui change.",
  excerpt_en: "What changes.",
  body_fr: "<p>Texte</p>",
  body_en: "<p>Text</p>",
  tags: ["strategy", "operations"],
  cover_vault_id: "c1",
  author_user_id: "u1",
  author_name: "Joseph Moukoko",
  author_title: "Head of Operations",
  author_avatar_ref: "avatars/jm.png",
  is_published: true,
  published_at: "2026-02-01T09:00:00.000Z",
  ...over,
});

beforeEach(() => jest.clearAllMocks());

describe("the public card", () => {
  it("carries the excerpt and the date their cards do not", () => {
    // Theirs shows title + author only, and no date anywhere on the site. A
    // knowledge hub that cannot show recency is not credible.
    const card = service.publicCard(row());
    expect(card.excerpt_fr).toBe("Ce qui change.");
    expect(card.published_at).toBe("2026-02-01T09:00:00.000Z");
    expect(card.tags).toEqual(["strategy", "operations"]);
  });

  it("names the author from the ERP, with their job title", () => {
    // Their author names live inside translation keys — a name is not
    // translatable content, and these five people are staff we already hold.
    expect(service.publicCard(row()).author).toEqual({
      name: "Joseph Moukoko",
      title: "Head of Operations",
      avatar_ref: "avatars/jm.png",
    });
  });

  it("is unattributed rather than blank when the author has left", () => {
    // ON DELETE SET NULL: the article outlives the colleague. A byline of ""
    // would read as a name nobody typed.
    expect(service.publicCard(row({ author_user_id: null, author_name: null })).author).toBeNull();
  });

  it("never leaks a column from app_user", () => {
    // Built explicitly rather than by deleting: app_user carries a password
    // hash and a TOTP secret, and a denylist fails OPEN when that table grows.
    const json = JSON.stringify(service.publicCard(row({
      password_hash: "$argon2id$x", totp_secret_enc: "s3cret",
    })));
    expect(json).not.toContain("argon2");
    expect(json).not.toContain("totp");
    expect(json).not.toContain("s3cret");
  });

  it("keeps no body on a card", () => {
    // Nine cards carrying nine article bodies is an index page that weighs more
    // than every article on it.
    expect(service.publicCard(row())).not.toHaveProperty("body_fr");
  });
});

describe("the index", () => {
  beforeEach(() => {
    repo.list.mockResolvedValue([row()]);
    repo.count.mockResolvedValue(1);
    repo.tagsInUse.mockResolvedValue([
      { tag: "strategy", count: 3 },
      { tag: "sustainability", count: 1 },
    ]);
  });

  it("ships the filter bar WITH the page, derived from the tags in use", async () => {
    // The fix for their bug: a tag cannot exist in the data without a way to
    // reach it, and a tag nobody uses cannot linger in the bar.
    const out = await service.listPublic(client);
    expect(out.tags).toEqual([
      { tag: "strategy", count: 3 },
      { tag: "sustainability", count: 1 },
    ]);
  });

  it("computes the tag bar over EVERY published article, not the filtered set", async () => {
    // A visitor narrowed to "strategy" still needs the other tags in front of
    // them, or the only way back is the browser's Back button.
    await service.listPublic(client, { tag: "strategy" });
    expect(repo.tagsInUse).toHaveBeenCalledWith(client, { publishedOnly: true });
    expect(repo.list).toHaveBeenCalledWith(client, expect.objectContaining({ tag: "strategy" }));
  });

  it("asks only for published articles", async () => {
    await service.listPublic(client);
    expect(repo.list).toHaveBeenCalledWith(client, expect.objectContaining({ publishedOnly: true }));
    expect(repo.count).toHaveBeenCalledWith(client, expect.objectContaining({ publishedOnly: true }));
  });

  it("reports has_more rather than leaving the browser to derive it", async () => {
    // The browser would have to know perPage, and a rounding disagreement is a
    // "next" button that leads to an empty page.
    repo.count.mockResolvedValue(30);
    const out = await service.listPublic(client, { page: 1, perPage: 9 });
    expect(out.has_more).toBe(true);
    expect(out.total).toBe(30);
  });

  it("knows when it has reached the end", async () => {
    repo.count.mockResolvedValue(1);
    expect((await service.listPublic(client, { page: 1, perPage: 9 })).has_more).toBe(false);
  });

  it("offsets by the page it was asked for", async () => {
    await service.listPublic(client, { page: 3, perPage: 9 });
    expect(repo.list).toHaveBeenCalledWith(client, expect.objectContaining({ limit: 9, offset: 18 }));
  });
});

describe("the article read", () => {
  it("404s an unpublished slug exactly as it 404s an unknown one", async () => {
    // Distinguishing them confirms a draft exists at a guessed URL.
    repo.getBySlug.mockResolvedValue(null);
    await expect(service.getPublic(client, "secret-piece")).rejects.toMatchObject({ status: 404 });
    expect(repo.getBySlug).toHaveBeenCalledWith(client, "secret-piece", { publishedOnly: true });
  });

  it("returns the body a reader came for", async () => {
    repo.getBySlug.mockResolvedValue(row());
    const out = await service.getPublic(client, "la-douane-en-2026");
    expect(out.body_fr).toBe("<p>Texte</p>");
    expect(out.title_en).toBe("Customs in 2026");
  });
});

describe("slugs", () => {
  it("refuses one already in use by another article", async () => {
    repo.slugTaken.mockResolvedValue(true);
    await expect(service.create(client, { patch: { title_fr: "T", slug_fr: "taken" } }))
      .rejects.toMatchObject({ status: 422, code: "SLUG_TAKEN" });
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("checks a French slug against BOTH columns", async () => {
    // getBySlug matches either, so a French slug colliding with another
    // article's English slug makes one of the two unreachable — and the unique
    // indexes are per-column and cannot see it.
    repo.slugTaken.mockResolvedValue(false);
    repo.insert.mockResolvedValue(row());
    await service.create(client, { patch: { title_fr: "T", slug_fr: "a", slug_en: "b" } });
    expect(repo.slugTaken).toHaveBeenCalledWith(client, "a", null);
    expect(repo.slugTaken).toHaveBeenCalledWith(client, "b", null);
  });

  it("refuses one article using the same slug for both languages", async () => {
    // Legal in the database — two different columns — and it would give the two
    // languages one URL, which is the thing per-language URLs exist to avoid.
    repo.slugTaken.mockResolvedValue(false);
    await expect(service.create(client, { patch: { title_fr: "T", slug_fr: "same", slug_en: "same" } }))
      .rejects.toMatchObject({ code: "SLUG_TAKEN" });
  });

  it("accepts lowercase hyphenated slugs and refuses everything else", () => {
    const ok = (v) => schemas.create.safeParse({ title_fr: "T", slug_fr: v }).success;
    expect(ok("la-douane-en-2026")).toBe(true);
    expect(ok("La-Douane")).toBe(false);
    expect(ok("la douane")).toBe(false);
    expect(ok("la--douane")).toBe(false);
    expect(ok("-douane")).toBe(false);
  });
});

describe("tags are normalised on the way in", () => {
  it("lowercases and de-duplicates, so the derived bar has one entry each", () => {
    // Otherwise "Strategy" and "strategy" appear as two filters in a bar that
    // is built from the tags in use.
    const parsed = schemas.create.parse({ title_fr: "T", tags: ["Strategy", "strategy", " Operations "] });
    expect(parsed.tags).toEqual(["strategy", "operations"]);
  });
});

describe("publishing", () => {
  it("refuses an article with no body", async () => {
    // A published row with no body is a URL in the sitemap that renders a title
    // over white space, found by a reader rather than by the writer.
    repo.get.mockResolvedValue(row({ body_fr: "", body_en: null, is_published: false }));
    await expect(service.setPublished(client, { id: "a1", published: true }))
      .rejects.toMatchObject({ status: 422, code: "EMPTY_ARTICLE" });
    expect(repo.setPublished).not.toHaveBeenCalled();
  });

  it("refuses an article with no slug", async () => {
    repo.get.mockResolvedValue(row({ slug_fr: null, slug_en: null, is_published: false }));
    await expect(service.setPublished(client, { id: "a1", published: true }))
      .rejects.toMatchObject({ code: "NO_SLUG" });
  });

  it("publishes one that has both", async () => {
    repo.get.mockResolvedValue(row({ is_published: false }));
    repo.setPublished.mockResolvedValue(row());
    await service.setPublished(client, { id: "a1", published: true, actor: { user_id: "u9" } });
    expect(repo.setPublished).toHaveBeenCalledWith(client, "a1", "u9", true);
  });

  it("never blocks an unpublish", async () => {
    // Taking something down is always allowed, whatever state it is in.
    repo.get.mockResolvedValue(row({ body_fr: "", slug_fr: null, slug_en: null }));
    repo.setPublished.mockResolvedValue(row({ is_published: false }));
    await expect(service.setPublished(client, { id: "a1", published: false })).resolves.toBeTruthy();
  });

  it("refuses to delete an article while it is live", async () => {
    // The URL is in search results and possibly linked from somewhere we do not
    // control.
    repo.get.mockResolvedValue(row({ is_published: true }));
    await expect(service.remove(client, { id: "a1" }))
      .rejects.toMatchObject({ status: 422, code: "PUBLISHED" });
    expect(repo.remove).not.toHaveBeenCalled();
  });
});

/**
 * Announcements (13784, guide §6.4) — the homepage band's read, and the pin
 * that fills it.
 *
 * ── WHY THE REFUSALS ARE THE INTERESTING TESTS ─────────────────────────────
 *
 * A pin that is accepted and then never rendered is the failure mode this
 * feature has, and it is silent: `pinned_until` is written, the settings screen
 * shows a pin, and the band stays empty because the row is a draft, or an
 * ordinary article, or its date is already past. The tenant finds out by
 * looking at their own homepage, which is the one page nobody looks at.
 *
 * So each refusal below is asserted for its own code, not merely for throwing.
 */
describe("announcements", () => {
  const ann = (over = {}) => row({ kind: "announcement", ...over });
  const future = new Date(Date.now() + 86400e3 * 30).toISOString();
  const past = new Date(Date.now() - 86400e3).toISOString();

  beforeEach(() => {
    repo.tagsInUse.mockResolvedValue([]);
    repo.count.mockResolvedValue(0);
    repo.list.mockResolvedValue([]);
    repo.listPinned.mockResolvedValue([]);
  });

  it("puts the kind and the expiry on the public card", () => {
    // The band SHOWS the expiry. A pin whose date a visitor cannot see is a pin
    // only the tenant knows is temporary.
    const card = service.publicCard(ann({ pinned_until: future }));
    expect(card.kind).toBe("announcement");
    expect(card.pinned_until).toBe(future);
  });

  it("calls an article an article even on a row written before 13784", () => {
    // The column has a DEFAULT, but a row read through a stub, a fixture or an
    // older cache may not carry it. Undefined must not reach a renderer that
    // switches on it.
    expect(service.publicCard(row({ kind: undefined })).kind).toBe("article");
  });

  it("asks the repo for the pins capped at five, and only announcements", async () => {
    // The cap is the requirement (§6.4) and it is applied in SQL. Asserting the
    // ARGUMENT is what catches a later refactor that moves the slice into JS,
    // where it stops protecting the payload.
    await service.listPublicAnnouncements(client);
    expect(repo.listPinned).toHaveBeenCalledWith(client, { limit: 5, kind: "announcement" });
    expect(service.PINNED_MAX).toBe(5);
  });

  it("does not let per_page raise the pinned cap", async () => {
    // `per_page` narrows the LIST. A caller who asks for fifty gets fifty
    // announcements and five pins.
    await service.listPublicAnnouncements(client, { perPage: 50 });
    expect(repo.listPinned).toHaveBeenCalledWith(client, { limit: 5, kind: "announcement" });
    expect(repo.list).toHaveBeenCalledWith(client, expect.objectContaining({ limit: 50 }));
  });

  it("narrows the list to announcements, so the band's 'view more' is not the blog", async () => {
    await service.listPublicAnnouncements(client);
    expect(repo.list).toHaveBeenCalledWith(client, expect.objectContaining({ kind: "announcement" }));
    expect(repo.count).toHaveBeenCalledWith(client, expect.objectContaining({ kind: "announcement" }));
  });

  it("keeps a pinned announcement in the list as well as in the band", async () => {
    // A visitor who follows "view more" looking for the thing they just saw
    // should find it, rather than discover that being important removed it.
    repo.listPinned.mockResolvedValue([ann({ pinned_until: future })]);
    repo.list.mockResolvedValue([ann({ pinned_until: future })]);
    repo.count.mockResolvedValue(1);
    const out = await service.listPublicAnnouncements(client);
    expect(out.pinned).toHaveLength(1);
    expect(out.articles).toHaveLength(1);
  });

  it("carries no body into the band", async () => {
    repo.listPinned.mockResolvedValue([ann({ pinned_until: future })]);
    const out = await service.listPublicAnnouncements(client);
    expect(out.pinned[0]).not.toHaveProperty("body_fr");
  });
});

describe("pinning", () => {
  const ann = (over = {}) => row({ kind: "announcement", ...over });
  const future = new Date(Date.now() + 86400e3 * 30).toISOString();
  const past = new Date(Date.now() - 86400e3).toISOString();

  it("refuses to pin an ordinary article", async () => {
    // The band reads kind='announcement'. Pinning an article writes a timestamp
    // no renderer will ever read.
    repo.get.mockResolvedValue(row({ kind: "article" }));
    await expect(service.setPinned(client, { id: "a1", pinnedUntil: future }))
      .rejects.toMatchObject({ status: 422, code: "NOT_AN_ANNOUNCEMENT" });
    expect(repo.setPinned).not.toHaveBeenCalled();
  });

  it("refuses to pin a draft", async () => {
    repo.get.mockResolvedValue(ann({ is_published: false }));
    await expect(service.setPinned(client, { id: "a1", pinnedUntil: future }))
      .rejects.toMatchObject({ status: 422, code: "NOT_PUBLISHED" });
    expect(repo.setPinned).not.toHaveBeenCalled();
  });

  it("refuses an expiry that has already passed", async () => {
    // `pinned_until > now()` is the whole mechanism, so a date behind us is an
    // unpin wearing a pin's clothes — and it would look pinned in the settings
    // list while showing nowhere.
    repo.get.mockResolvedValue(ann());
    await expect(service.setPinned(client, { id: "a1", pinnedUntil: past }))
      .rejects.toMatchObject({ status: 422, code: "PIN_EXPIRED" });
    expect(repo.setPinned).not.toHaveBeenCalled();
  });

  it("pins a published announcement until a future date", async () => {
    repo.get.mockResolvedValue(ann());
    repo.setPinned.mockResolvedValue(ann({ pinned_until: future }));
    await service.setPinned(client, { id: "a1", pinnedUntil: future, actor: { user_id: "u9" } });
    expect(repo.setPinned).toHaveBeenCalledWith(client, "a1", future);
  });

  it("always allows a pin to be cleared, whatever state the row is in", async () => {
    // You must be able to take something off the front page without first
    // repairing it — an unpublished, wrong-kind row still unpins.
    repo.get.mockResolvedValue(row({ kind: "article", is_published: false }));
    repo.setPinned.mockResolvedValue(row({ pinned_until: null }));
    await expect(service.setPinned(client, { id: "a1", pinnedUntil: null })).resolves.toBeTruthy();
    expect(repo.setPinned).toHaveBeenCalledWith(client, "a1", null);
  });

  it("refuses an unknown article before it refuses anything else", async () => {
    repo.get.mockResolvedValue(null);
    await expect(service.setPinned(client, { id: "nope", pinnedUntil: future }))
      .rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("will not accept a pin through an ordinary field edit", () => {
    // `pinned_until` is absent from WRITABLE and from the update schema, so the
    // only way onto the homepage is the endpoint that stamps who and when.
    expect(repo.WRITABLE).not.toContain("pinned_until");
    expect(schemas.update.safeParse({ pinned_until: future }).success).toBe(false);
  });
});
