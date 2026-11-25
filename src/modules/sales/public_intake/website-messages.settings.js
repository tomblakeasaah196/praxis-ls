"use strict";

/**
 * Reading Settings › Website › Messages on the server.
 *
 * Three settings, all in the tenant's LIVE schema (public routes are pinned to
 * live, and so is everything they read):
 *
 *   website_messages.delivery      inbox + sender mailbox (no password)
 *   website_messages.turnstile     the Turnstile site key (public by design)
 *   integration_secret.*           the two secrets, encrypted at rest:
 *     website_smtp_pass              the sender mailbox password
 *     turnstile_secret               the Turnstile secret key
 *
 * The secrets are decrypted here, in-process, for the one call that needs them
 * and are never put in a response. `publicConfig` is the only thing a browser
 * ever receives, and it carries the site key and nothing else.
 */

const { getSetting } = require("../../../shared/config/settings");
const settingService = require("../../security/setting/setting.service");

const SECTION = "website_messages";
const SMTP_SECRET = "website_smtp_pass";
const TURNSTILE_SECRET = "turnstile_secret";

const clean = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The delivery setting, normalised. Never null. */
async function delivery(client) {
  const v = (await getSetting(client, SECTION, "delivery", {})) || {};
  return {
    inbox: clean(v.inbox),
    from_address: clean(v.from_address),
    from_name: clean(v.from_name),
    smtp_host: clean(v.smtp_host),
    smtp_port: Number.isInteger(Number(v.smtp_port)) && Number(v.smtp_port) > 0 ? Number(v.smtp_port) : null,
    smtp_user: clean(v.smtp_user),
  };
}

/**
 * The sender mailbox, complete, or null.
 *
 * Complete means host, From and password: a mailbox missing any of the three
 * cannot send, and handing a half-configured one to nodemailer produces a 535
 * nobody can act on. Null makes the caller use the tenant's ordinary sender.
 */
async function senderMailbox(client) {
  const d = await delivery(client);
  if (!d.smtp_host || !d.from_address) return null;
  const pass = await settingService.readSecret(client, SMTP_SECRET);
  if (!pass) return null;
  const port = d.smtp_port || 465;
  return {
    host: d.smtp_host,
    port,
    secure: port === 465,
    user: d.smtp_user || d.from_address,
    pass,
    from_address: d.from_address,
    from_name: d.from_name,
  };
}

/** Both Turnstile keys, or null when either is missing (the check is then off). */
async function turnstileKeys(client) {
  const t = (await getSetting(client, SECTION, "turnstile", {})) || {};
  const siteKey = clean(t.site_key);
  if (!siteKey) return null;
  const secret = await settingService.readSecret(client, TURNSTILE_SECRET);
  if (!secret) return null;
  return { siteKey, secret };
}

/** What the website is told: the site key when the check is on, else null. */
async function publicConfig(client) {
  const keys = await turnstileKeys(client);
  return { turnstile_site_key: keys ? keys.siteKey : null };
}

module.exports = { delivery, senderMailbox, turnstileKeys, publicConfig, SECTION, SMTP_SECRET, TURNSTILE_SECRET };
