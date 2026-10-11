"use strict";

/**
 * The careers link a recruiter is handed.
 *
 * The defect this guards: the vacancy screen built the link from
 * `window.location.origin`, which is the WORKSPACE host the staff app is served
 * on. A tenant whose careers page is on a domain they brought was therefore
 * told to advertise `smartls.praxisls.com/careers/<token>` — a working link, on
 * the company's internal ERP hostname, printed on a job advert.
 *
 * So the first case below is the whole point: when the registry has a
 * `surface='public'` host, nothing else may win, and the prefix that keeps the
 * marketing site out of the ERP's way on a shared origin must not appear.
 */

const mockTenantIdOf = jest.fn();
const mockPublicSiteBaseUrl = jest.fn();

jest.mock("../../src/services/tenant/registry.service", () => ({
  tenantIdOf: (...a) => mockTenantIdOf(...a),
  publicSiteBaseUrl: (...a) => mockPublicSiteBaseUrl(...a),
}));
jest.mock("../../src/config/logger", () => ({
  logger: { debug: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

const { careersBase, careersUrl, careersIndexUrl } = require("../../src/modules/hr/careers/careers.link");

const CLIENT = { query: jest.fn() };
const TENANT = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  jest.clearAllMocks();
  mockTenantIdOf.mockReturnValue(TENANT);
});

describe("careersBase", () => {
  test("a tenant's own domain wins over the host the request arrived on", async () => {
    mockPublicSiteBaseUrl.mockResolvedValue("https://smartls.cm");
    const base = await careersBase(CLIENT, { origin: "smartls.praxisls.com" });
    expect(base).toBe("https://smartls.cm");
    expect(careersUrl(base, "tok123")).toBe("https://smartls.cm/careers/tok123");
  });

  test("a workspace host keeps the marketing prefix the registry gives it", async () => {
    // publicSiteBaseUrl already applies `public_base` for workspace hosts, and
    // that prefix is a per-tenant setting — so this must be carried through
    // rather than re-derived or dropped.
    mockPublicSiteBaseUrl.mockResolvedValue("https://smartls.praxisls.com/site");
    expect(await careersUrl(await careersBase(CLIENT, { origin: "smartls.praxisls.com" }), "tok123"))
      .toBe("https://smartls.praxisls.com/site/careers/tok123");
  });

  test("trailing slashes never become a double slash in the path", async () => {
    mockPublicSiteBaseUrl.mockResolvedValue("https://smartls.cm///");
    expect(careersUrl(await careersBase(CLIENT), "tok")).toBe("https://smartls.cm/careers/tok");
  });

  test("a bare host from the registry is given a scheme", async () => {
    mockPublicSiteBaseUrl.mockResolvedValue("smartls.cm");
    expect(await careersBase(CLIENT)).toBe("https://smartls.cm");
  });

  test("no host on file falls back to the caller's origin under the default prefix", async () => {
    mockPublicSiteBaseUrl.mockResolvedValue(null);
    expect(await careersBase(CLIENT, { origin: "smartls.praxisls.com" }))
      .toBe("https://smartls.praxisls.com/public");
  });

  test("a registry failure degrades to the caller's origin rather than throwing", async () => {
    mockPublicSiteBaseUrl.mockRejectedValue(new Error("platform pool down"));
    await expect(careersBase(CLIENT, { origin: "smartls.praxisls.com" }))
      .resolves.toBe("https://smartls.praxisls.com/public");
  });

  test("nothing resolvable yields \"\", never the apex", async () => {
    mockTenantIdOf.mockReturnValue(null);
    expect(await careersBase(CLIENT)).toBe("");
    expect(careersUrl("", "tok")).toBeNull();
    expect(careersIndexUrl("")).toBeNull();
  });

  test("a token is URL-encoded on its way into the path", () => {
    // Tokens are minted base64url today, so this is insurance against the
    // generator changing under a link that is already printed on job boards.
    expect(careersUrl("https://smartls.cm", "a/b c")).toBe("https://smartls.cm/careers/a%2Fb%20c");
  });

  test("the index is the careers page itself", () => {
    expect(careersIndexUrl("https://smartls.cm")).toBe("https://smartls.cm/careers");
  });
});
