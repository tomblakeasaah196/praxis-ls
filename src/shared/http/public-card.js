"use strict";

/**
 * The share card for one page: describe it (the same description its head
 * prints), fetch its photograph and the tenant's logo, draw, remember.
 *
 * ── THE PHOTOGRAPH IS FETCHED THROUGH THE SAME DOOR A VISITOR USES ─────────
 *
 * A page's `image` is a public URL. Its bytes are read here by the SAME
 * fail-closed lookups the public media routes run (`publicMediaForServe`:
 * the document must still be the one its owner points at, and the owner still
 * published), never by trusting an id. So a card can only ever print a
 * photograph the site would itself serve to a stranger. An address this file
 * does not recognise (another site's, say) prints no photograph at all: the
 * server fetching arbitrary URLs because a record named one is a door nobody
 * needs opened.
 *
 * ── CACHED BY WHAT IS DRAWN, NOT BY THE ADDRESS ASKED FOR ──────────────────
 *
 * The key is the description (headline, photograph, logo, colour, face), so
 * every path that falls through to the home card shares one render, and a
 * flood of invented paths costs one drawing rather than one each.
 */

const crypto = require("crypto");
const { isPublicMediaPath } = require("./media-guard");
const storage = require("../../services/storage.service");
const shareCard = require("../../services/share-card/share-card.service");
const head = require("./public-head");
const { logger } = require("../../config/logger");

const UUID = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";

/** Each public media address, and the lookup that re-checks it. */
const SOURCES = [
  {
    test: new RegExp(`^/api/tenant/public/site/media/${UUID}$`, "i"),
    read: (client, id) => require("../../modules/site/site_settings/site_settings.media").publicMediaForServe(client, id),
  },
  {
    test: new RegExp(`^/api/tenant/public/services/media/${UUID}$`, "i"),
    read: (client, id) => require("../../modules/operations/service_type_web/service_type_web.repo").publicMediaForServe(client, id),
  },
  {
    test: new RegExp(`^/api/tenant/public/insights/media/${UUID}$`, "i"),
    read: (client, id) => require("../../modules/content/insight/insight.repo").publicMediaForServe(client, id),
  },
];

/**
 * The bytes behind one of this tenant's public image addresses, or null.
 *
 * @param {object} client     a LIVE tenant connection
 * @param {string|null} url   a page's image, as its head names it
 * @param {string|null} slug  the tenant's slug, to keep `/media` keys its own
 */
async function imageBytes(client, url, slug) {
  if (!url || typeof url !== "string") return null;
  let pathOnly = url;
  if (/^https?:\/\//i.test(url)) {
    // Only this site's own addresses: the path is re-checked below exactly as
    // a relative one would be, and a foreign host prints nothing.
    try {
      pathOnly = new URL(url).pathname;
    } catch {
      return null;
    }
  }
  for (const s of SOURCES) {
    const m = s.test.exec(pathOnly);
    if (!m) continue;
    const doc = await s.read(client, m[1]);
    if (!doc || !doc.storage_path || String(doc.storage_path).startsWith("pending://")) return null;
    return storage.get(doc.storage_path);
  }
  const media = /^\/media\/(.+)$/.exec(pathOnly);
  if (media) {
    const rest = "/" + media[1];
    if (!isPublicMediaPath(rest)) return null;
    const key = decodeURIComponent(media[1]);
    if (slug && !key.startsWith(`tenant_${slug}/`)) return null;
    return storage.get(key);
  }
  return null;
}

const MAX_CARDS = 64;
const rendered = new Map();
const inFlight = new Map();

/**
 * The JPEG for one page of one host.
 *
 * @param {object} args
 * @param {string} args.host
 * @param {string} args.rel      base-relative path, as the head names it
 * @param {string|null} args.slug
 * @param {(fn: (client: object) => Promise<any>) => Promise<any>} args.withClient
 *        runs `fn` on a LIVE tenant connection (the route's `req.tenantDbIn`)
 * @returns {Promise<{ buffer: Buffer, etag: string }>}
 */
async function cardFor({ host, rel, slug, withClient }) {
  const view = await head.describeForCard(host, rel);
  const key = crypto
    .createHash("sha1")
    .update(JSON.stringify([host, view.headline, view.photo, view.logo, view.accent, view.font]))
    .digest("hex");
  const hit = rendered.get(key);
  if (hit) return hit;
  if (inFlight.has(key)) return inFlight.get(key);

  const job = (async () => {
    const [photo, logo] = await withClient((client) =>
      Promise.all([
        imageBytes(client, view.photo, slug).catch((err) => {
          logger.warn({ err, host, rel }, "share card photograph unreadable - drawing without it");
          return null;
        }),
        imageBytes(client, view.logo, slug).catch((err) => {
          logger.warn({ err, host }, "share card logo unreadable - drawing without it");
          return null;
        }),
      ]),
    );
    const buffer = await shareCard.renderCard({
      photo,
      logo,
      headline: view.headline,
      address: host,
      accent: view.accent,
      font: view.font,
    });
    const out = { buffer, etag: key.slice(0, 20) };
    if (rendered.size >= MAX_CARDS) rendered.delete(rendered.keys().next().value);
    rendered.set(key, out);
    return out;
  })();
  inFlight.set(key, job);
  try {
    return await job;
  } finally {
    inFlight.delete(key);
  }
}


module.exports = { cardFor, imageBytes, SOURCES };
