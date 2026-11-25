"use strict";

/**
 * Removing a tenant's domain from the platform console.
 *
 * The console could add a domain and never remove one, so staging.smartls.cm
 * stayed registered after SmartLS moved to smartlsgroup.com (25 Nov 2026).
 * Pinned: the primary (sign-in) host and a tenant's last host are refused, a
 * removal writes the platform audit trail inside the same transaction, and both
 * host caches are cleared so the domain stops resolving at once.
 */

const mockState = { rows: [], queries: [] };

jest.mock("../../src/services/platform/migrator", () => ({
  client: () => ({
    connect: async () => {},
    end: async () => {},
    query: async (sql, params = []) => {
      mockState.queries.push({ sql: String(sql), params });
      if (/FROM platform\.tenant WHERE slug/.test(sql)) {
        return { rows: params[0] === "smartls" ? [{ tenant_id: "t-1" }] : [] };
      }
      if (/FROM platform\.subdomain WHERE tenant_id=\$1 FOR UPDATE/.test(sql)) {
        return { rows: mockState.rows.map((r) => ({ ...r })) };
      }
      return { rows: [] };
    },
  }),
}));
jest.mock("../../src/services/platform/provisioning.service", () => ({}));
jest.mock("../../src/services/tenant/registry.service", () => ({ invalidateHost: jest.fn() }));
jest.mock("../../src/shared/http/public-head", () => ({ invalidateHost: jest.fn() }));

const tenants = require("../../src/services/platform/tenants.service");
const registry = require("../../src/services/tenant/registry.service");
const publicHead = require("../../src/shared/http/public-head");

const ROWS = [
  { host: "smartls.praxisls.com", is_primary: true, surface: "erp" },
  { host: "smartlsgroup.com", is_primary: false, surface: "public" },
  { host: "staging.smartls.cm", is_primary: false, surface: "public" },
];

const ran = (re) => mockState.queries.some((q) => re.test(q.sql));

beforeEach(() => {
  mockState.rows = ROWS.map((r) => ({ ...r }));
  mockState.queries = [];
  jest.clearAllMocks();
});

describe("removeDomain", () => {
  it("removes a non-primary host, audits it, commits, and clears both caches", async () => {
    const out = await tenants.removeDomain("smartls", { host: "Staging.SmartLS.cm." }, "actor-1");
    expect(out).toEqual({ host: "staging.smartls.cm", removed: true });
    const del = mockState.queries.find((q) => /DELETE FROM platform\.subdomain/.test(q.sql));
    expect(del.params).toEqual(["t-1", "staging.smartls.cm"]);
    const audit = mockState.queries.find((q) => /platform_audit/.test(q.sql));
    expect(audit.params).toEqual(["actor-1", "t-1", "tenant.domain_removed", "smartls", { host: "staging.smartls.cm", surface: "public" }]);
    // The audit row is written before COMMIT, so a removal is never unaudited.
    const idx = (re) => mockState.queries.findIndex((q) => re.test(q.sql));
    expect(idx(/platform_audit/)).toBeLessThan(idx(/^COMMIT$/));
    expect(registry.invalidateHost).toHaveBeenCalledWith("staging.smartls.cm");
    expect(publicHead.invalidateHost).toHaveBeenCalledWith("staging.smartls.cm");
  });

  it("refuses the primary host, where staff sign in", async () => {
    await expect(tenants.removeDomain("smartls", { host: "smartls.praxisls.com" }, "a")).rejects.toMatchObject({
      code: "PRIMARY_HOST",
      status: 409,
    });
    expect(ran(/DELETE FROM platform\.subdomain/)).toBe(false);
    expect(ran(/^ROLLBACK$/)).toBe(true);
    expect(registry.invalidateHost).not.toHaveBeenCalled();
  });

  it("refuses a tenant's last host, whatever its flags say", async () => {
    mockState.rows = [{ host: "smartlsgroup.com", is_primary: false, surface: "public" }];
    await expect(tenants.removeDomain("smartls", { host: "smartlsgroup.com" }, "a")).rejects.toMatchObject({
      code: "LAST_HOST",
      status: 409,
    });
    expect(ran(/DELETE FROM platform\.subdomain/)).toBe(false);
  });

  it("refuses a host that is not this tenant's, without saying whose it is", async () => {
    await expect(tenants.removeDomain("smartls", { host: "other.example.com" }, "a")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(ran(/DELETE FROM platform\.subdomain/)).toBe(false);
  });

  it("refuses an empty host before touching the database", () => {
    expect(() => tenants.removeDomain("smartls", { host: "  " }, "a")).toThrow(expect.objectContaining({ code: "BAD_HOST" }));
    expect(mockState.queries).toHaveLength(0);
  });
});

describe("the route", () => {
  it("is a DELETE behind tenants.write", () => {
    const src = require("fs").readFileSync(require("path").join(__dirname, "../../src/modules/platform/platform.routes.js"), "utf8");
    // The host travels in the body, like add and flip: see platform-console/src/lib/api.ts.
    expect(src).toMatch(
      /router\.delete\("\/tenants\/:slug\/domains", requireCap\("tenants\.write"\), validate\("domainRemove"\), c\.removeDomain\)/,
    );
  });
});
