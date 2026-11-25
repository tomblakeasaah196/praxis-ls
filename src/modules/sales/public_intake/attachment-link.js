"use strict";

/**
 * Expiring, signed links to a website visitor's attachments, for the inbox
 * email when the files are too large to travel inside it.
 *
 * A link is `<payload>.<signature>`, both base64url. The payload names the
 * tenant, the message, the file and the moment the link stops working; the
 * signature is an HMAC over the payload with a key derived from the server's
 * ENCRYPTION_KEY, so nobody can make a link we did not issue or stretch one we
 * did. The route that serves it (`GET /public/intake/attachments/:token`) also
 * checks that the file still belongs to that message in that tenant, and answers
 * every failure (forged, expired, wrong tenant, file gone) with the same 404.
 *
 * A link is a bearer credential for one file for `ATTACHMENT_LINK_DAYS` days:
 * whoever holds the email can open it, which is the same exposure as the file
 * being attached to that email, and the reason it expires.
 */

const crypto = require("crypto");
const { config } = require("../../../config/env");
const { websiteMessages } = require("@praxis/shared");

const VERSION = "v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const key = () =>
  crypto.createHash("sha256").update(`praxis.website-attachment-link.${VERSION}:${config.ENCRYPTION_KEY || ""}`).digest();

const b64 = (buf) => Buffer.from(buf).toString("base64url");
const mac = (payload) => b64(crypto.createHmac("sha256", key()).update(payload).digest());

/** A link token for one file of one message. */
function sign({ slug, enquiryId, docId, now = Date.now(), days = websiteMessages.ATTACHMENT_LINK_DAYS }) {
  const exp = Math.floor(now / 1000) + days * 24 * 3600;
  const payload = b64(JSON.stringify({ v: VERSION, s: slug, e: enquiryId, d: docId, x: exp }));
  return `${payload}.${mac(payload)}`;
}

/** The token's claims, or null for anything forged, expired or foreign. */
function verify(token, { slug, now = Date.now() } = {}) {
  const raw = String(token || "");
  if (raw.length > 1000) return null;
  const [payload, signature, extra] = raw.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = mac(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null; // @silent:parse a token that is not JSON is a forged token, answered as not found
  }
  if (!claims || claims.v !== VERSION || claims.s !== slug) return null;
  if (!Number.isFinite(claims.x) || claims.x * 1000 < now) return null;
  if (!UUID.test(String(claims.e)) || !UUID.test(String(claims.d))) return null;
  return { enquiryId: claims.e, docId: claims.d, expiresAt: new Date(claims.x * 1000) };
}

module.exports = { sign, verify };
