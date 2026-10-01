"use strict";
/**
 * Which part of an email address says WHO the sender works for — and when it
 * says nothing (tenant review, meeting 6, owner decision Q5).
 *
 * A quote request keyed in from an email is tied to a client by its
 * requester's address: an exact match on a client contact first, then the
 * DOMAIN — `logistique@goum-intl.cm` belongs with whichever client already
 * writes from `@goum-intl.cm`. That second rule is only safe for a company's
 * own domain. Two strangers on `gmail.com` are not colleagues, and suggesting
 * that every Gmail sender is the one client who happens to use Gmail is how a
 * prospect's request lands in somebody else's portal.
 *
 * So the public webmail providers are listed here, once: the API refuses to
 * match on them and the staff form says why it did not suggest anything. The
 * list is the providers seen in the CEMAC/West African corridor plus the
 * global ones; a provider missing from it costs a wrong SUGGESTION, which the
 * person still has to accept with a tap — never a silent link.
 */

const PUBLIC_WEBMAIL = [
  "gmail.com", "googlemail.com",
  "yahoo.com", "yahoo.fr", "yahoo.co.uk", "ymail.com", "rocketmail.com",
  "outlook.com", "outlook.fr", "hotmail.com", "hotmail.fr", "hotmail.co.uk",
  "live.com", "live.fr", "msn.com", "windowslive.com",
  "icloud.com", "me.com", "mac.com",
  "aol.com", "aol.fr",
  "gmx.com", "gmx.fr", "gmx.net", "gmx.de",
  "mail.com", "email.com",
  "proton.me", "protonmail.com", "pm.me",
  "zoho.com", "zohomail.com",
  "yandex.com", "yandex.ru",
  "orange.fr", "orange.cm", "wanadoo.fr", "free.fr", "laposte.net", "sfr.fr",
  "camtel.cm", "mtn.cm",
  "qq.com", "163.com", "126.com",
];
const WEBMAIL = new Set(PUBLIC_WEBMAIL);

/** The longest an address can be (RFC 5321 path limit, less the brackets). */
const MAX_ADDRESS = 254;

/**
 * `ada@Goum-Intl.cm ` → `goum-intl.cm`; anything without one `@` → null.
 *
 * The address is a requester's, typed by a stranger on the website or read off
 * an email, so nothing here may cost more than linear time on it: the length
 * is capped before any regular expression sees it, and the trailing dots are
 * stripped by a loop — `/\.+$/` re-scans a run of dots from every position it
 * starts at, which is quadratic on "a@b" followed by thousands of them.
 */
function domainOf(email) {
  const s = String(email || "").trim().toLowerCase();
  if (s.length > MAX_ADDRESS) return null;
  const at = s.lastIndexOf("@");
  if (at < 1 || at === s.length - 1) return null;
  let end = s.length;
  while (end > at + 1 && s[end - 1] === ".") end -= 1;
  const domain = s.slice(at + 1, end);
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : null;
}

/** True for a public mailbox provider, where the domain says nothing about the sender. */
const isPublicWebmail = (domain) => WEBMAIL.has(String(domain || "").trim().toLowerCase());

/** The domain a company can be matched on, or null when there is none to use. */
function companyDomainOf(email) {
  const d = domainOf(email);
  return d && !isPublicWebmail(d) ? d : null;
}

module.exports = { PUBLIC_WEBMAIL, domainOf, isPublicWebmail, companyDomainOf };
