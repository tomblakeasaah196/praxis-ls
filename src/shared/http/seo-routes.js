"use strict";

/**
 * /robots.txt and /sitemap.xml, per host.
 *
 * Registered in server.js AHEAD of the public-web mounts, because on a
 * WORKSPACE host neither mount claims `/robots.txt`, and a workspace host is
 * precisely the one that needs to say "do not index me".
 *
 * Being ahead of the mounts also puts them ahead of the surface middleware, so
 * each handler resolves the host's surface itself (host-surface.js). Reading
 * `req.hostSurface` here without that is the bug that shipped: every tenant's
 * own domain answered "Disallow: /" and had no sitemap.
 */

const publicHead = require("./public-head");
const paths = require("./public-web-paths");
const { resolveHostSurface, hostOf } = require("./host-surface");
const { logger } = require("../../config/logger");

/**
 * @param {{ servePublicWeb: boolean }} opts  SERVE_PUBLIC_WEB: whether a
 *   workspace host also answers the marketing prefix.
 */
function seoRoutes({ servePublicWeb }) {
  const servesPublic = async (req) => (await resolveHostSurface(req)) === "public" || Boolean(servePublicWeb);
  const baseOf = (req) => req.publicBase || paths.DEFAULT_BASE;

  async function robotsTxt(req, res) {
    const origin = `${req.protocol}://${req.headers.host}`;
    const pub = await servesPublic(req);
    res
      .type("text/plain")
      .set("Cache-Control", "public, max-age=3600")
      // A noindex host (SEO_NOINDEX_HOSTS, or a staging-style first label)
      // refuses the whole crawl, whatever surface it serves.
      .send(publicHead.robots(origin, pub, baseOf(req), hostOf(req)));
  }

  async function sitemapXml(req, res, next) {
    const host = hostOf(req);
    if (!(await servesPublic(req)) || publicHead.isNoindexHost(host)) return next();
    const origin = `${req.protocol}://${req.headers.host}`;
    try {
      const xml = await publicHead.sitemap(host, origin, baseOf(req));
      res.type("application/xml").set("Cache-Control", "public, max-age=3600").send(xml);
    } catch (err) {
      // A sitemap that 500s is worse than one that is briefly absent: a crawler
      // retries a 404 and gives up on repeated errors.
      logger.warn({ err, host }, "sitemap failed");
      next();
    }
  }

  return { robotsTxt, sitemapXml };
}

module.exports = { seoRoutes };
