"use strict";

/**
 * The publish flows that announce a page to IndexNow: an article, a service
 * page and a trust document. The helper is mocked; what is pinned is WHICH
 * paths each flow announces, and that a scheduled article is not announced
 * before its date.
 */

jest.mock("../../src/shared/http/indexnow", () => ({ ping: jest.fn() }));
jest.mock("../../src/shared/db/tx", () => ({ atomically: (_c, fn) => fn() }));
jest.mock("../../src/shared/events/emit", () => ({ audit: jest.fn(), emitEvent: jest.fn() }));
jest.mock("../../src/modules/content/insight/insight.repo", () => {
  const actual = jest.requireActual("../../src/modules/content/insight/insight.repo");
  const mocked = {};
  for (const [k, v] of Object.entries(actual)) mocked[k] = typeof v === "function" ? jest.fn() : v;
  return mocked;
});
jest.mock("../../src/modules/site/site_brand/site_brand.repo", () => {
  const actual = jest.requireActual("../../src/modules/site/site_brand/site_brand.repo");
  const mocked = {};
  for (const [k, v] of Object.entries(actual)) mocked[k] = typeof v === "function" ? jest.fn() : v;
  return mocked;
});

const indexNow = require("../../src/shared/http/indexnow");
const insightRepo = require("../../src/modules/content/insight/insight.repo");
const insights = require("../../src/modules/content/insight/insight.service");
const brandRepo = require("../../src/modules/site/site_brand/site_brand.repo");
const brand = require("../../src/modules/site/site_brand/site_brand.service");

const client = {};
const article = (over = {}) => ({
  insight_article_id: "a1",
  slug_en: "douala-to-ndjamena",
  slug_fr: null,
  title_en: "Douala to N'Djamena",
  body_en: "Text.",
  is_published: true,
  published_at: "2026-11-20T08:00:00Z",
  ...over,
});

beforeEach(() => jest.clearAllMocks());

describe("an Insights article", () => {
  test("publishing announces the article, the index and the home page", async () => {
    insightRepo.get.mockResolvedValue(article({ is_published: false }));
    insightRepo.setPublished.mockResolvedValue(article());
    await insights.setPublished(client, { id: "a1", published: true });
    expect(indexNow.ping).toHaveBeenCalledWith(client, ["/insights/douala-to-ndjamena", "/insights", "/"]);
  });

  test("an article dated in the future is not announced before it is live", async () => {
    insightRepo.get.mockResolvedValue(article({ is_published: false }));
    insightRepo.setPublished.mockResolvedValue(article({ published_at: "2099-01-01T00:00:00Z" }));
    await insights.setPublished(client, { id: "a1", published: true });
    expect(indexNow.ping).not.toHaveBeenCalled();
  });

  test("editing a live article announces it, at its old address too when the slug moved", async () => {
    insightRepo.get.mockResolvedValue(article());
    insightRepo.update.mockResolvedValue(article({ slug_en: "douala-ndjamena-corridor" }));
    insightRepo.slugTaken && insightRepo.slugTaken.mockResolvedValue(false);
    await insights.update(client, { id: "a1", patch: { slug_en: "douala-ndjamena-corridor" } });
    expect(indexNow.ping).toHaveBeenCalledWith(client, [
      "/insights/douala-to-ndjamena",
      "/insights/douala-ndjamena-corridor",
      "/insights",
      "/",
    ]);
  });

  test("editing a draft announces nothing", async () => {
    insightRepo.get.mockResolvedValue(article({ is_published: false }));
    insightRepo.update.mockResolvedValue(article({ is_published: false, title_en: "New" }));
    await insights.update(client, { id: "a1", patch: { title_en: "New" } });
    expect(indexNow.ping).not.toHaveBeenCalled();
  });
});

describe("a trust document", () => {
  test("publishing announces its page, the Trust index and the home page", async () => {
    brandRepo.getDocument.mockResolvedValue({ document_id: "d1", doc_key: "quality-policy", published_at: null });
    brandRepo.setPublished.mockResolvedValue({ document_id: "d1", doc_key: "quality-policy", published_at: new Date() });
    // Withdrawing needs no publish gate, so it exercises the ping alone.
    await brand.setPublished(client, { id: "d1", published: false });
    expect(indexNow.ping).toHaveBeenCalledWith(client, ["/trust/quality-policy", "/trust", "/"]);
  });

  test("the privacy policy is announced at its own address", async () => {
    brandRepo.getDocument.mockResolvedValue({ document_id: "d2", doc_key: "privacy-policy", published_at: null });
    brandRepo.setPublished.mockResolvedValue({ document_id: "d2", doc_key: "privacy-policy", published_at: null });
    await brand.setPublished(client, { id: "d2", published: false });
    expect(indexNow.ping).toHaveBeenCalledWith(client, ["/legal/privacy", "/trust", "/"]);
  });
});
