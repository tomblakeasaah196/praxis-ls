/**
 * The share card's photograph comes through the same door a visitor uses.
 *
 * `public-card.imageBytes` turns a page's image address into bytes. It must
 * re-run the public media routes' own fail-closed lookups rather than trust an
 * id, refuse another tenant's `/media` key, and fetch nothing from another
 * host: a server that downloads whatever URL a record names is a door.
 */
"use strict";

jest.mock("../../src/services/tenant/registry.service", () => ({
  resolveByHost: async () => null,
  withTenantConnection: async () => null,
}));
jest.mock("../../src/config/logger", () => ({
  logger: { warn() {}, info() {}, error() {} },
}));
jest.mock("../../src/services/storage.service", () => ({
  get: jest.fn(async (key) => Buffer.from("bytes:" + key)),
}));
jest.mock("../../src/modules/site/site_settings/site_settings.media", () => ({
  publicMediaForServe: jest.fn(async (_c, id) =>
    id === "11111111-1111-1111-1111-111111111111" ? { storage_path: "tenant_acme/site/hero.jpg" } : null),
}));
jest.mock("../../src/modules/operations/service_type_web/service_type_web.repo", () => ({
  publicMediaForServe: jest.fn(async () => ({ storage_path: "pending://upload" })),
}));
jest.mock("../../src/modules/content/insight/insight.repo", () => ({
  publicMediaForServe: jest.fn(async () => ({ storage_path: "tenant_acme/insights/cover.jpg" })),
}));

const { imageBytes } = require("../../src/shared/http/public-card");
const storage = require("../../src/services/storage.service");

const ID = "11111111-1111-1111-1111-111111111111";

describe("a card's photograph", () => {
  beforeEach(() => storage.get.mockClear());

  test("a site photograph is read only when its public lookup still serves it", async () => {
    await expect(imageBytes({}, `/api/tenant/public/site/media/${ID}`, "acme")).resolves.toEqual(Buffer.from("bytes:tenant_acme/site/hero.jpg"));
    await expect(imageBytes({}, "/api/tenant/public/site/media/22222222-2222-2222-2222-222222222222", "acme")).resolves.toBeNull();
  });

  test("an article cover goes through the insights lookup; an upload still pending prints nothing", async () => {
    await expect(imageBytes({}, `/api/tenant/public/insights/media/${ID}`, "acme")).resolves.toEqual(Buffer.from("bytes:tenant_acme/insights/cover.jpg"));
    await expect(imageBytes({}, `/api/tenant/public/services/media/${ID}`, "acme")).resolves.toBeNull();
  });

  test("a branding image must be this tenant's and a public kind", async () => {
    await expect(imageBytes({}, "/media/tenant_acme/branding/logo_ab12.webp", "acme")).resolves.toEqual(Buffer.from("bytes:tenant_acme/branding/logo_ab12.webp"));
    await expect(imageBytes({}, "/media/tenant_other/branding/logo_ab12.webp", "acme")).resolves.toBeNull();
    await expect(imageBytes({}, "/media/tenant_acme/vault/contract.pdf", "acme")).resolves.toBeNull();
  });

  test("another host's address is never fetched, and an unknown path prints nothing", async () => {
    await expect(imageBytes({}, `https://elsewhere.test/api/tenant/public/insights/media/${ID}`, "acme"))
      // The PATH is re-checked like a relative one, but nothing is downloaded
      // from elsewhere.test: the bytes come from this tenant's own storage.
      .resolves.toEqual(Buffer.from("bytes:tenant_acme/insights/cover.jpg"));
    await expect(imageBytes({}, "https://elsewhere.test/picture.jpg", "acme")).resolves.toBeNull();
    await expect(imageBytes({}, "/etc/passwd", "acme")).resolves.toBeNull();
    await expect(imageBytes({}, null, "acme")).resolves.toBeNull();
  });
});
