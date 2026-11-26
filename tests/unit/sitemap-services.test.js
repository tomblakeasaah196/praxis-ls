/**
 * The sitemap offers every published service page.
 *
 * From the service families (website v2, PR 3) until 26 Nov 2026 it offered
 * none: the services section called a `list` that had been removed, the call
 * threw, the section's catch logged it, and smartlsgroup.com's thirteen service
 * pages were never offered to a crawler. Nothing failed, because nothing ran
 * the real `sitemap()` against the real module it reads. This does.
 */
"use strict";

jest.mock("../../src/services/tenant/registry.service", () => ({
  resolveByHost: async () => ({ status: "LIVE", slug: "acme" }),
  withTenantConnection: async (_meta, _env, fn) => fn({ query: async () => ({ rows: [] }) }),
}));
jest.mock("../../src/config/logger", () => ({
  logger: { warn: jest.fn(), info() {}, error() {} },
}));
jest.mock("../../src/modules/site/site_settings/site_switches", () => ({
  load: async () => ({ portfolio: false }),
}));
jest.mock("../../src/modules/operations/service_type_web/service_type_web.repo", () => ({
  // One row per service AND family: a service in two families comes twice.
  publicList: async () => [
    { slug_en: "sea-freight", group_key: "freight" },
    { slug_en: "air-freight", group_key: "freight" },
    { slug_en: "sea-freight", group_key: "europe" },
    { slug_en: "customs-brokerage", group_key: "value-added" },
  ],
}));
jest.mock("../../src/modules/hr/careers/careers.service", () => ({ list: async () => [] }));
jest.mock("../../src/modules/content/insight/insight.service", () => ({
  listPublic: async () => ({ articles: [{ slug_en: "douala-or-kribi" }] }),
}));
jest.mock("../../src/modules/site/site_brand/site_brand.service", () => ({
  publicDocuments: async () => [{ kind: "POLICY", key: "quality-policy" }],
}));

const head = require("../../src/shared/http/public-head");
const { logger } = require("../../src/config/logger");

test("every published service page is in the sitemap, once, and no section failed", async () => {
  const xml = await head.sitemap("acme.test", "https://acme.test", "/");
  const services = [...xml.matchAll(/<loc>https:\/\/acme\.test(\/services\/[^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(services).toEqual(["/services/sea-freight", "/services/air-freight", "/services/customs-brokerage"]);
  expect(xml).toContain("<loc>https://acme.test/insights/douala-or-kribi</loc>");
  expect(xml).toContain("<loc>https://acme.test/trust/quality-policy</loc>");
  // A section that throws is logged and omitted; none may have.
  expect(logger.warn).not.toHaveBeenCalled();
});
