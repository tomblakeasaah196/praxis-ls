"use strict";

/**
 * IndexNow: the per-host key, the key file, the ping's payload, and the
 * publish flows that send it. No network: `notify` takes its fetch, and the
 * publish tests mock the helper.
 */

const mockSurfaces = {
  "smartlsgroup.com": { tenant_id: "t1", surface: "public", public_base: null },
  "example-two.com": { tenant_id: "t2", surface: "public", public_base: null },
  "smartls.praxisls.com": { tenant_id: "t1", surface: "erp", public_base: "/public" },
};
let mockPublicHosts = [];

jest.mock("../../src/config/logger", () => ({
  logger: { warn() {}, info() {}, error() {} },
}));
jest.mock("../../src/services/tenant/registry.service", () => ({
  resolveByHost: async (host) => mockSurfaces[host] || null,
  withTenantConnection: async () => null,
  publicHosts: async () => mockPublicHosts,
  tenantIdOf: (c) => (c && c.tenantId) || null,
  ENV: Symbol.for("praxis.conn.env"),
}));

const indexNow = require("../../src/shared/http/indexnow");
const { seoRoutes, INDEXNOW_KEY_PATH } = require("../../src/shared/http/seo-routes");

describe("the key", () => {
  test("is 32 hex characters, stable per host, and different across hosts", () => {
    const a = indexNow.keyFor("smartlsgroup.com");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(indexNow.keyFor("smartlsgroup.com")).toBe(a);
    // The Host header's case and port do not make a second key.
    expect(indexNow.keyFor("SmartLSGroup.com:443")).toBe(a);
    expect(indexNow.keyFor("example-two.com")).not.toBe(a);
    expect(INDEXNOW_KEY_PATH.test("/" + a + ".txt")).toBe(true);
  });
});

describe("/<key>.txt", () => {
  function fakeRes() {
    const res = { headers: {} };
    res.type = (t) => ((res.contentType = t), res);
    res.set = (k, v) => ((res.headers[k] = v), res);
    res.send = (b) => ((res.body = b), res);
    return res;
  }
  async function ask(host, path) {
    const req = { protocol: "https", headers: { host }, path };
    const res = fakeRes();
    let fellThrough = false;
    await seoRoutes({ servePublicWeb: true }).indexNowKey(req, res, () => { fellThrough = true; });
    return { res, fellThrough };
  }

  test("answers the host's own key as plain text", async () => {
    const key = indexNow.keyFor("smartlsgroup.com");
    const { res, fellThrough } = await ask("smartlsgroup.com", "/" + key + ".txt");
    expect(fellThrough).toBe(false);
    expect(res.contentType).toBe("text/plain");
    expect(res.body).toBe(key);
  });

  test("another host's key, or any other 32-hex file, is not answered", async () => {
    const other = indexNow.keyFor("example-two.com");
    expect((await ask("smartlsgroup.com", "/" + other + ".txt")).fellThrough).toBe(true);
    expect((await ask("smartlsgroup.com", "/" + "0".repeat(32) + ".txt")).fellThrough).toBe(true);
  });

  test("a workspace host never answers one, even for its own key", async () => {
    const key = indexNow.keyFor("smartls.praxisls.com");
    expect((await ask("smartls.praxisls.com", "/" + key + ".txt")).fellThrough).toBe(true);
  });
});

describe("the ping", () => {
  test("builds one payload per public host, with absolute URLs at the root", async () => {
    mockPublicHosts = ["smartlsgroup.com", "www.smartlsgroup.com"];
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), init });
      return { status: 202 };
    };
    const out = await indexNow.notify("t1", ["/insights/a-piece", "/insights", "/", "/insights"], { fetchImpl });
    expect(out).toEqual([{ host: "smartlsgroup.com", status: 202 }, { host: "www.smartlsgroup.com", status: 202 }]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("https://api.indexnow.org/indexnow");
    expect(calls[0].init.method).toBe("POST");
    const key = indexNow.keyFor("smartlsgroup.com");
    expect(calls[0].body).toEqual({
      host: "smartlsgroup.com",
      key,
      keyLocation: "https://smartlsgroup.com/" + key + ".txt",
      urlList: [
        "https://smartlsgroup.com/insights/a-piece",
        "https://smartlsgroup.com/insights",
        "https://smartlsgroup.com/",
      ],
    });
    expect(calls[1].body.key).toBe(indexNow.keyFor("www.smartlsgroup.com"));
  });

  test("a rehearsal host is skipped", async () => {
    mockPublicHosts = ["staging.smartls.cm", "smartlsgroup.com"];
    const hosts = [];
    await indexNow.notify("t1", ["/"], { fetchImpl: async (_u, init) => (hosts.push(JSON.parse(init.body).host), { status: 200 }) });
    expect(hosts).toEqual(["smartlsgroup.com"]);
  });

  test("a failing search engine never throws into the caller", async () => {
    mockPublicHosts = ["smartlsgroup.com"];
    const out = await indexNow.notify("t1", ["/"], { fetchImpl: async () => { throw new Error("timeout"); } });
    expect(out).toEqual([{ host: "smartlsgroup.com", error: "timeout" }]);
  });

  test("outside production nothing is sent at all", () => {
    // jest runs with NODE_ENV=test; `ping` must return before any network.
    const spy = jest.spyOn(globalThis, "setImmediate");
    expect(() => indexNow.ping({ tenantId: "t1" }, ["/"])).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
