"use strict";

/**
 * A message's remote images, fetched by our server so the reader's browser is
 * never the one that asks (§5.6.3, owner decision 27 Nov 2026).
 *
 * ── WHY THIS EXISTS: "SHOW IMAGES" SHOWED A BROKEN IMAGE, EVERY TIME ────────
 *
 * The reading pane used to restore a blocked `<img src="https://…">` and let
 * the frame fetch it directly. It never arrived, from any sender. The frame is
 * a `srcdoc` document with `allow-same-origin`, so it belongs to the PWA's
 * service worker, and that worker's image route matched EVERY image whatever
 * its origin. It re-fetched the image with its own `fetch()`, and a worker's
 * own fetches are checked against the CSP served with `sw.js`: helmet's
 * defaults, with no `connect-src`, so `default-src 'self'`. The request was
 * refused inside the browser and the sender's server was never contacted. The
 * frame's `img-src https:` and the app's `img-src https:` were both correct;
 * neither was the policy that ran.
 *
 * ── WHY A PROXY RATHER THAN LETTING THE BROWSER FETCH ───────────────────────
 *
 * The obvious repair (keep the worker off other sites' images) makes the image
 * load, and makes the reader's browser contact the sender: their IP address,
 * their device and the moment they opened the message, delivered to whoever
 * put a pixel in it. Blocking images by default is the only privacy control the
 * inbound side has, and "Show images" was the reader agreeing to see a picture,
 * not agreeing to be located. So the server fetches, as Gmail's image proxy
 * does, and the browser gets the bytes as a `blob:` through an authenticated
 * call, exactly like an inline `cid:` part. The frame's policy no longer needs
 * `https:` at all.
 *
 * ── WHAT IT WILL FETCH, AND WHY THAT IS THE INTERESTING RULE ────────────────
 *
 * Only a URL that THIS message's stored body references as an image: a `src`,
 * `srcset`, `poster` or `background`, or a CSS `url()` in a `style` attribute or
 * a `<style>` block. The route is behind `requireVisibleMessage`, so the
 * message is one the caller can already read. The endpoint is therefore not a
 * general-purpose fetch of whatever a caller supplies; it is "the pictures in
 * mail you can open". Anybody can still mail the tenant a URL, so the fetch
 * itself goes through `guardedFetch`: private and metadata addresses refused at
 * the resolver, every redirect re-screened, and hard caps on time and bytes.
 *
 * ── WHAT IT WILL SERVE ──────────────────────────────────────────────────────
 *
 * Raster images, judged on the upstream's Content-Type and judged again here.
 * Never SVG: an `<svg>` is a document that can carry script, and these bytes
 * are served from OUR origin, where a copied proxy URL opened in a tab would
 * run it with the reader's session. A truncated body is refused rather than
 * served as half a picture.
 */

const { guardedFetch } = require("../../../shared/net/guarded-fetch");

/** A newsletter hero is rarely over 1 MB; 5 MB leaves room without becoming a
 *  download proxy. */
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 8000;
/** Longer than any real image URL, short enough that a query string is not a payload. */
const MAX_URL_LENGTH = 2048;

const RASTER = ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/avif", "image/bmp"];
const RASTER_RE = /^image\/(png|jpeg|jpg|gif|webp|avif|bmp)$/;

const USER_AGENT = "PraxisLSBot/1.0 (+https://praxisls.com; mail image proxy; read-only)";

/** The attributes that make a browser fetch something while rendering. Kept in
 *  step with `URL_ATTRS` in the client's `message-body.ts`. */
const URL_ATTRS = ["src", "poster", "background"];
const CSS_URL = /url\(([^)]*)\)/gi;
const DESCRIPTOR = /^\d+(?:\.\d+)?[wx]$/i;

/**
 * A reference as the proxy compares it: `//host/x` is `https://host/x`, and
 * anything that is not absolute http(s) is nothing. `cid:`, `data:` and `blob:`
 * never leave the building, and a relative URL in an email means nothing.
 */
function normalise(raw) {
  const v = String(raw ?? "").trim();
  if (!v || v.length > MAX_URL_LENGTH) return null;
  if (v.startsWith("//")) return `https:${v}`;
  return /^https?:\/\//i.test(v) ? v : null;
}

const unquote = (s) => String(s).trim().replace(/^['"]|['"]$/g, "").trim();

/**
 * The URLs in a srcset, read the way the HTML spec reads one: a candidate is a
 * run of non-space characters with its trailing commas removed, then optional
 * descriptors. Commas INSIDE a URL stay (an image CDN's `w_600,h_400` is one
 * URL, not two).
 */
function srcsetUrls(value) {
  const out = [];
  for (const token of String(value || "").split(/\s+/)) {
    const t = token.replace(/^,+|,+$/g, "");
    if (t && !DESCRIPTOR.test(t)) out.push(t);
  }
  return out;
}

/** Every remote image reference in a stored body, normalised. */
function remoteRefs(html) {
  const refs = new Set();
  if (!html) return refs;
  const add = (raw) => {
    const url = normalise(raw);
    if (url) refs.add(url);
  };
  const cssUrls = (css) => {
    for (const m of String(css || "").matchAll(CSS_URL)) add(unquote(m[1]));
  };

  // sanitize-html is already how this module reads HTML (`body-html.js`), and
  // its callbacks hand over attributes entity-decoded, which is what the
  // reader's DOM sees. Nothing is filtered: the output is thrown away.
  const sanitize = require("sanitize-html");
  sanitize(String(html), {
    allowedTags: false,
    allowedAttributes: false,
    allowVulnerableTags: true,
    transformTags: {
      "*": (tagName, attribs) => {
        for (const attr of URL_ATTRS) if (typeof attribs[attr] === "string") add(attribs[attr]);
        if (typeof attribs.srcset === "string") srcsetUrls(attribs.srcset).forEach(add);
        if (attribs.style) cssUrls(attribs.style);
        return { tagName, attribs };
      },
    },
    exclusiveFilter: (frame) => {
      if (frame.tag === "style") cssUrls(frame.text);
      return false;
    },
  });
  return refs;
}

/**
 * The bytes of one image in one message, or null for anything we will not
 * serve. Null is the only failure shape: the reader sees the image's empty box
 * either way, and the caller answers 404.
 *
 * `refsOf` is injectable for one reason: sanitize-html's parser is ESM-only and
 * Jest's CommonJS runtime cannot load it, so the reference rules are proven in
 * a real Node process and the fetch rules are proven here without it.
 */
async function imageFor(client, messageId, rawUrl, { fetchImpl = guardedFetch, refsOf = remoteRefs } = {}) {
  const url = normalise(rawUrl);
  if (!url) return null;

  const { rows } = await client.query(
    "SELECT body_html FROM email_message WHERE email_message_id = $1",
    [messageId],
  );
  if (!rows.length || !refsOf(rows[0].body_html).has(url)) return null;

  const response = await fetchImpl(url, {
    maxBytes: MAX_BYTES,
    timeoutMs: TIMEOUT_MS,
    accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8,*/*;q=0.1",
    allowContentTypes: RASTER,
    userAgent: USER_AGENT,
  });
  if (!response.ok || response.truncated) return null;

  // The transport refused on the upstream's word; the response is the last
  // place a second opinion belongs, because these bytes leave from our origin.
  const served = String(response.contentType || "").split(";")[0].trim().toLowerCase();
  if (!RASTER_RE.test(served)) return null;
  if (!response.body || !response.body.length) return null;
  return { contentType: served, buffer: response.body };
}

module.exports = { imageFor, remoteRefs, normalise, MAX_BYTES };
