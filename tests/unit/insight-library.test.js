"use strict";

/**
 * The Insights library (PR 5, migration 14680): dated bylines, editable dates,
 * English or French, the year archive, related reading, and the Markdown
 * import.
 *
 * The cases worth reading first:
 *
 *   · **the byline on the article wins over the staff record.** A piece signed
 *     in 2023 by the then Head of Finance must not be re-titled by today's HR
 *     record, and must not lose its author when that person leaves.
 *   · **a future date is a schedule.** Every public read goes through one
 *     LIVE predicate that requires the date to have arrived; a read that used
 *     `is_published` alone would publish a scheduled piece early.
 *   · **an import is always a draft.** Whatever the file says.
 */

jest.mock("../../src/modules/content/insight/insight.repo", () => {
  const actual = jest.requireActual("../../src/modules/content/insight/insight.repo");
  const mocked = {};
  for (const [k, v] of Object.entries(actual)) mocked[k] = typeof v === "function" ? jest.fn() : v;
  return mocked;
});
jest.mock("../../src/shared/db/tx", () => ({ atomically: (_c, fn) => fn() }));
jest.mock("../../src/shared/events/emit", () => ({ audit: jest.fn(), emitEvent: jest.fn() }));

const repo = require("../../src/modules/content/insight/insight.repo");
const service = require("../../src/modules/content/insight/insight.service");
const { schemas } = require("../../src/modules/content/insight/insight.validator");
const importer = require("../../src/modules/content/insight/insight.import");
const head = require("../../src/shared/http/public-head");

const client = {};
const row = (over = {}) => ({
  insight_article_id: "a1",
  slug_fr: null,
  slug_en: "why-we-started-with-customs",
  title_fr: null,
  title_en: "Why We Started With Customs",
  excerpt_en: "Two sentences.",
  body_en: "word ".repeat(1100),
  body_fr: null,
  tags: ["company", "customs"],
  author_user_id: null,
  byline_name: null,
  byline_role: null,
  byline_photo_vault_id: null,
  is_published: true,
  published_at: "2021-03-15T12:00:00.000Z",
  kind: "article",
  ...over,
});

beforeEach(() => jest.clearAllMocks());

describe("the byline", () => {
  it("prints the name and the role written on the article", () => {
    const card = service.publicCard(row({ byline_name: "Tom Forghab", byline_role: "Head of Finance and Strategy" }));
    expect(card.author).toEqual({
      name: "Tom Forghab",
      title: "Head of Finance and Strategy",
      avatar_ref: null,
      photo_id: null,
    });
  });

  it("wins over the linked staff record, which may have moved on", () => {
    const card = service.publicCard(row({
      byline_name: "Tom Forghab",
      byline_role: "Head of Finance and Strategy",
      author_user_id: "u1",
      author_name: "Thomas Forghab",
      author_title: "Chief Executive",
    }));
    expect(card.author.name).toBe("Tom Forghab");
    expect(card.author.title).toBe("Head of Finance and Strategy");
  });

  it("falls back to the staff record when nothing is written", () => {
    const card = service.publicCard(row({ author_user_id: "u1", author_name: "Joseph Moukoko", author_title: "Operations Manager" }));
    expect(card.author.name).toBe("Joseph Moukoko");
  });

  it("carries the byline photo id, never a URL", () => {
    const card = service.publicCard(row({ byline_name: "Vanessa Mezakeu", byline_photo_vault_id: "p1" }));
    expect(card.author.photo_id).toBe("p1");
  });

  it("is writable on a PATCH, while the photo is not", () => {
    expect(schemas.update.safeParse({ byline_name: "A", byline_role: "B" }).success).toBe(true);
    expect(schemas.update.safeParse({ byline_photo_vault_id: "0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0" }).success).toBe(false);
  });
});

describe("the article's date", () => {
  it("accepts a bare day and stores it at noon UTC, so it prints as that day everywhere", () => {
    const out = schemas.update.parse({ published_at: "2021-03-15" });
    expect(out.published_at).toBe("2021-03-15T12:00:00.000Z");
  });

  it("accepts an instant, a past date and a future one", () => {
    expect(schemas.update.safeParse({ published_at: "2019-06-01T08:00:00+01:00" }).success).toBe(true);
    expect(schemas.update.safeParse({ published_at: "2031-01-01" }).success).toBe(true);
  });

  it("refuses a day that is not a day, and a year before 1990", () => {
    expect(schemas.update.safeParse({ published_at: "15/03/2021" }).success).toBe(false);
    expect(schemas.update.safeParse({ published_at: "2021-02-31" }).success).toBe(false);
    expect(schemas.update.safeParse({ published_at: "1021-03-15" }).success).toBe(false);
  });

  it("is in the repo's writable list, so an editor's date is stored", () => {
    expect(repo.WRITABLE).toEqual(expect.arrayContaining(["published_at", "byline_name", "byline_role"]));
  });

  it("schedules: every public read requires the date to have arrived", () => {
    expect(repo.LIVE).toMatch(/is_published = true/);
    expect(repo.LIVE).toMatch(/published_at <= now\(\)/);
  });
});

describe("English or French", () => {
  it("creates an English-only article", () => {
    expect(schemas.create.safeParse({ title_en: "Shipping From Germany" }).success).toBe(true);
  });

  it("still creates a French-only one", () => {
    expect(schemas.create.safeParse({ title_fr: "La douane" }).success).toBe(true);
  });

  it("refuses an article with no headline in either", () => {
    expect(schemas.create.safeParse({ title_en: "  ", title_fr: "" }).success).toBe(false);
    expect(schemas.create.safeParse({ tags: ["x"] }).success).toBe(false);
  });

  it("refuses an update that would leave no headline at all", async () => {
    repo.get.mockResolvedValue(row({ title_fr: null }));
    repo.slugTaken.mockResolvedValue(false);
    await expect(service.update(client, { id: "a1", patch: { title_en: null } }))
      .rejects.toMatchObject({ status: 422 });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("allows clearing one language while the other remains", async () => {
    repo.get.mockResolvedValue(row({ title_fr: "Pourquoi la douane" }));
    repo.slugTaken.mockResolvedValue(false);
    repo.update.mockResolvedValue(row({ title_en: null, title_fr: "Pourquoi la douane" }));
    await service.update(client, { id: "a1", patch: { title_en: null } });
    expect(repo.update).toHaveBeenCalled();
  });
});

describe("reading time", () => {
  it("is the longer body at 220 words a minute", () => {
    expect(service.readingMinutes(row())).toBe(5);
  });

  it("is null with no body, so no card says 1 min over nothing", () => {
    expect(service.readingMinutes(row({ body_en: null }))).toBeNull();
  });

  it("does not count Markdown punctuation as words", () => {
    expect(service.readingMinutes(row({ body_en: "## - * > ``" }))).toBeNull();
  });

  it("is on every card", () => {
    expect(service.publicCard(row()).reading_minutes).toBe(5);
  });
});

describe("the year archive and the index", () => {
  it("passes the year through to the list and the count, and ships the years", async () => {
    repo.list.mockResolvedValue([row()]);
    repo.count.mockResolvedValue(1);
    repo.tagsInUse.mockResolvedValue([]);
    repo.yearsInUse.mockResolvedValue([{ year: 2021, count: 1 }]);
    const out = await service.listPublic(client, { year: 2021 });
    expect(repo.list).toHaveBeenCalledWith(client, expect.objectContaining({ year: 2021, publishedOnly: true }));
    expect(repo.count).toHaveBeenCalledWith(client, expect.objectContaining({ year: 2021 }));
    expect(out.years).toEqual([{ year: 2021, count: 1 }]);
  });

  it("validates the year on the public query", () => {
    expect(schemas.listQuery.safeParse({ year: "2023" }).data.year).toBe(2023);
    expect(schemas.listQuery.safeParse({ year: "23" }).success).toBe(false);
  });
});

describe("related reading", () => {
  it("closes an article with three cards, asked for by its tags, never its own", async () => {
    repo.getBySlug.mockResolvedValue(row());
    repo.related.mockResolvedValue([row({ insight_article_id: "b", slug_en: "b" })]);
    const out = await service.getPublic(client, "why-we-started-with-customs");
    expect(repo.related).toHaveBeenCalledWith(client, { id: "a1", tags: ["company", "customs"], limit: 3 });
    expect(out.related).toHaveLength(1);
    expect(out.related[0]).not.toHaveProperty("body_en");
  });
});

describe("the import", () => {
  const FILE = [
    "---",
    'title: "Douala or Kribi: Choose the Port Before You Choose the Vessel"',
    "slug: douala-or-kribi",
    "date: 2021-11-18",
    "kind: article",
    "tags: [ports, hinterland]",
    "byline: Joseph Moukoko",
    "role: Operations Manager",
    "excerpt: Two ports, two different questions.",
    "meta:",
    "  title: Douala or Kribi",
    "  description: How to choose a Cameroonian port.",
    "sources:",
    "  - https://example.org/a",
    "note: house byline until the role is confirmed",
    "---",
    "",
    "## The question",
    "",
    "Body text.",
  ].join("\r\n");

  it("reads the front matter and the body", () => {
    const { data, body } = importer.parseFrontMatter(FILE);
    expect(data.title).toBe("Douala or Kribi: Choose the Port Before You Choose the Vessel");
    expect(data.tags).toEqual(["ports", "hinterland"]);
    expect(data.meta_title).toBe("Douala or Kribi");
    expect(data.sources).toEqual(["https://example.org/a"]);
    expect(body).toBe("## The question\n\nBody text.");
  });

  it("maps it onto the English half by default, and reports what it ignored", () => {
    const { patch, ignored } = importer.toPatch(importer.parseFrontMatter(FILE));
    expect(patch).toMatchObject({
      title_en: "Douala or Kribi: Choose the Port Before You Choose the Vessel",
      slug_en: "douala-or-kribi",
      published_at: "2021-11-18",
      byline_name: "Joseph Moukoko",
      byline_role: "Operations Manager",
      meta_title_en: "Douala or Kribi",
      meta_description_en: "How to choose a Cameroonian port.",
      tags: ["ports", "hinterland"],
      kind: "article",
    });
    expect(patch).not.toHaveProperty("title_fr");
    expect(ignored.sort()).toEqual(["note", "sources"]);
  });

  it("fills the French half when the file says it is French", () => {
    const { patch } = importer.toPatch(importer.parseFrontMatter("---\nlanguage: fr\ntitle: La douane\nslug: la-douane\n---\nTexte"));
    expect(patch).toMatchObject({ title_fr: "La douane", slug_fr: "la-douane", body_fr: "Texte" });
  });

  it("says plainly when a file has no front matter", () => {
    expect(() => importer.parseFrontMatter("# Just a heading")).toThrow(/front matter/);
    expect(() => importer.parseFrontMatter("---\ntitle: x\n")).toThrow(/never closed/);
  });

  it("creates a DRAFT, dated, through the editor's own rules", async () => {
    repo.slugTaken.mockResolvedValue(false);
    repo.insert.mockImplementation(async (_c, patch) => ({ insight_article_id: "n1", is_published: false, ...patch }));
    const out = await service.importMarkdown(client, { name: "03.md", text: FILE, actor: { user_id: "u9" } });
    const inserted = repo.insert.mock.calls[0][1];
    expect(inserted.published_at).toBe("2021-11-18T12:00:00.000Z");
    expect(inserted).not.toHaveProperty("is_published");
    expect(repo.setPublished).not.toHaveBeenCalled();
    expect(out.article.is_published).toBe(false);
    expect(out.ignored).toContain("sources");
  });

  it("refuses a file whose slug is already in use, so importing twice is harmless", async () => {
    repo.slugTaken.mockResolvedValue(true);
    await expect(service.importMarkdown(client, { name: "03.md", text: FILE }))
      .rejects.toMatchObject({ status: 422 });
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("refuses a file with no slug, naming the file", async () => {
    await expect(service.importMarkdown(client, { name: "x.md", text: "---\ntitle: X\n---\nBody" }))
      .rejects.toMatchObject({ status: 422, message: expect.stringContaining("x.md") });
  });

  it("refuses a date the editor would refuse", async () => {
    repo.slugTaken.mockResolvedValue(false);
    await expect(service.importMarkdown(client, { name: "d.md", text: "---\ntitle: X\nslug: x\ndate: 15/03/2021\n---\nBody" }))
      .rejects.toMatchObject({ status: 422 });
  });
});

describe("the article head", () => {
  const routeFor = (rel) => head.ROUTES.find((r) => r.test.test(rel));

  it("is English first, and uses the writer's search title and description", () => {
    const r = routeFor("/insights/x");
    const page = r.shape({
      title_fr: "Pourquoi la douane", title_en: "Why We Started With Customs",
      meta_title_en: "Why customs first", meta_description_en: "The search line.",
      excerpt_en: "The excerpt.", tags: [], cover_id: "c1", published_at: "2021-03-15T12:00:00.000Z",
    });
    expect(page.title).toBe("Why customs first");
    expect(page.description).toBe("The search line.");
    expect(page.image).toBe("/api/tenant/public/insights/media/c1");
    expect(page.ogType).toBe("article");
  });

  it("falls back to the headline and excerpt, then to French", () => {
    const r = routeFor("/insights/x");
    expect(r.shape({ title_en: "Headline", excerpt_en: "Excerpt", tags: [] }).title).toBe("Headline");
    expect(r.shape({ title_fr: "Titre", excerpt_fr: "Extrait", tags: [] }).description).toBe("Extrait");
  });

  it("gives the index its own title rather than the bare tenant name", () => {
    const r = routeFor("/insights");
    expect(r).toBeTruthy();
    expect(r.shape({ articles: [{ title_en: "Latest piece" }], total: 1 })).toMatchObject({
      title: "Insights",
      description: "Latest: Latest piece",
    });
  });
});
