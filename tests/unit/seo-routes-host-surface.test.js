"use strict";

/**
 * robots.txt and sitemap.xml answer for the HOST they are asked on.
 *
 * smartlsgroup.com went live on 25 Nov 2026 answering "Disallow: /" and with
 * sitemap.xml falling through to the HTML shell. Both routes are registered
 * ahead of the surface middleware in server.js, so they read a
 * `req.hostSurface` nobody had set and treated every tenant's own domain as a
 * workspace. They resolve the surface themselves now.
 *
 * And a staging host is noindex by its name, without being listed:
 * staging.smartls.cm served `index, follow` the same day.
 */

const mockHosts = {
  "smartlsgroup.com": { tenant_id: "t1", surface: "public", public_base: null },
  "smartls.praxisls.com": { tenant_id: "t1", surface: "erp", public_base: "/public" },
  "staging.smartls.cm": { tenant_id: "t1", surface: "public", public_base: null },
};

jest.mock("../../src/services/tenant/registry.service", () => ({
  resolveByHost: async (host) => mockHosts[host] || null,
  withTenantConnection: async () => null,
}));
jest.mock("../../src/config/logger", () => ({
  logger: { warn() {}, info() {}, error() {} },
}));

const publicHead = require("../../src/shared/http/public-head");
const { seoRoutes } = require("../../src/shared/http/seo-routes");

const SITEMAP = '<?xml version="1.0"?><urlset></urlset>';

function fakeRes() {
  const res = { headers: {}, body: undefined, contentType: undefined };
  res.type = (t) => ((res.contentType = t), res);
  res.set = (k, v) => ((res.headers[k] = v), res);
  res.send = (b) => ((res.body = b), res);
  return res;
}

async function ask(path, host, { servePublicWeb = false } = {}) {
  const seo = seoRoutes({ servePublicWeb });
  const req = { protocol: "https", headers: { host }, path };
  const res = fakeRes();
  let fellThrough = false;
  const next = () => {
    fellThrough = true;
  };
  await (path === "/robots.txt" ? seo.robotsTxt(req, res, next) : seo.sitemapXml(req, res, next));
  return { res, fellThrough };
}

beforeEach(() => {
  jest.spyOn(publicHead, "sitemap").mockResolvedValue(SITEMAP);
});
afterEach(() => jest.restoreAllMocks());

describe("a tenant's own public domain", () => {
  test("robots.txt allows the crawl and names its sitemap", async () => {
    const { res } = await ask("/robots.txt", "smartlsgroup.com");
    expect(res.body).toContain("Allow: /");
    expect(res.body).not.toMatch(/^Disallow: \/$/m);
    // Root base: the tokenised paths are at the root, not under /public.
    expect(res.body).toContain("Disallow: /q/");
    expect(res.body).toContain("Sitemap: https://smartlsgroup.com/sitemap.xml");
  });

  test("sitemap.xml is a real sitemap, built at the root base", async () => {
    const { res, fellThrough } = await ask("/sitemap.xml", "smartlsgroup.com");
    expect(fellThrough).toBe(false);
    expect(res.contentType).toBe("application/xml");
    expect(res.body).toBe(SITEMAP);
    expect(publicHead.sitemap).toHaveBeenCalledWith("smartlsgroup.com", "https://smartlsgroup.com", "/");
  });
});

describe("a staging host", () => {
  test("is noindex by its first label, without being listed", () => {
    for (const h of ["staging.smartls.cm", "dev.x.cm", "test.x.cm", "preview.x.cm", "sandbox.x.cm:8443"]) {
      expect(publicHead.isNoindexHost(h)).toBe(true);
    }
    // Only the FIRST label, and only a whole label.
    for (const h of ["smartlsgroup.com", "staging-notes.x.cm", "www.staging.cm", "staging"]) {
      expect(publicHead.isNoindexHost(h)).toBe(false);
    }
  });

  test("robots.txt refuses the whole crawl, even serving the public site", async () => {
    const { res } = await ask("/robots.txt", "staging.smartls.cm");
    expect(res.body).toBe("User-agent: *\nDisallow: /\n");
  });

  test("has no sitemap", async () => {
    const { fellThrough } = await ask("/sitemap.xml", "staging.smartls.cm");
    expect(fellThrough).toBe(true);
    expect(publicHead.sitemap).not.toHaveBeenCalled();
  });

  test("its pages carry the noindex meta, and production's do not", async () => {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-shell-"));
    fs.writeFileSync(path.join(dir, "index.html"), "<html><head><title>x</title></head><body></body></html>");
    const send = publicHead.makeHtmlSender(dir);
    const page = async (host) => {
      const res = fakeRes();
      await send({ protocol: "https", headers: { host }, path: "/", publicBase: "/" }, res, () => {});
      return String(res.body);
    };
    expect(await page("staging.smartls.cm")).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(await page("smartlsgroup.com")).not.toContain("noindex");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("a workspace host", () => {
  test("robots.txt refuses the crawl and has no sitemap", async () => {
    const robots = await ask("/robots.txt", "smartls.praxisls.com");
    expect(robots.res.body).toBe("User-agent: *\nDisallow: /\n");
    const sitemap = await ask("/sitemap.xml", "smartls.praxisls.com");
    expect(sitemap.fellThrough).toBe(true);
  });
});

describe("/llms.txt and /llms-full.txt", () => {
  const llms = require("../../src/shared/http/llms-txt");

  async function askLlms(full, host) {
    const seo = seoRoutes({ servePublicWeb: false });
    const req = { protocol: "https", headers: { host }, path: full ? "/llms-full.txt" : "/llms.txt" };
    const res = fakeRes();
    res.statusCode = 200;
    res.status = (c) => ((res.statusCode = c), res);
    let fellThrough = false;
    await (full ? seo.llmsFullTxt : seo.llmsTxt)(req, res, () => { fellThrough = true; });
    return { res, fellThrough };
  }

  test("serves the profile as Markdown on the public domain, at its base", async () => {
    jest.spyOn(llms, "build").mockResolvedValue("# Example\n\n> Summary.\n");
    const { res } = await askLlms(true, "smartlsgroup.com");
    expect(res.statusCode).toBe(200);
    expect(res.contentType).toBe("text/markdown");
    expect(res.body).toBe("# Example\n\n> Summary.\n");
    expect(llms.build).toHaveBeenCalledWith("smartlsgroup.com", "https://smartlsgroup.com", "/", { full: true });
  });

  test("answers 404 when there is no profile, never an empty or invented file", async () => {
    jest.spyOn(llms, "build").mockResolvedValue(null);
    const { res } = await askLlms(false, "smartlsgroup.com");
    expect(res.statusCode).toBe(404);
  });

  test("a workspace host that serves no public site leaves the path alone", async () => {
    jest.spyOn(llms, "build").mockResolvedValue("# x\n");
    const { fellThrough } = await askLlms(false, "smartls.praxisls.com");
    expect(fellThrough).toBe(true);
    expect(llms.build).not.toHaveBeenCalled();
  });
});
