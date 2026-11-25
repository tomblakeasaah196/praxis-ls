"use strict";

/**
 * Cloudflare's published edge address ranges, and the one question this file
 * answers: did this connection come from Cloudflare?
 *
 * ── WHY IT MATTERS ─────────────────────────────────────────────────────────
 *
 * A tenant domain on a PROXIED Cloudflare record (the orange cloud) does not
 * resolve to us. It resolves to Cloudflare, and Cloudflare opens the connection
 * to our nginx. So the address nginx sees, and therefore `req.ip`, is a
 * Cloudflare edge address shared by every visitor routed through that edge.
 * Every IP-keyed limiter then puts the whole country in one bucket: one spammer
 * spends the five-per-hour contact allowance for everybody, and a genuine
 * client is told "too many messages" having sent none.
 *
 * Cloudflare puts the real visitor address in `CF-Connecting-IP`. That header
 * is only worth anything when CLOUDFLARE wrote it. Anybody can send the header
 * straight at our origin address, so it is believed only when the connection
 * itself came from one of the ranges below (`visitor-ip.js`).
 *
 * The same ranges answer the platform DNS check: a host whose A records are all
 * Cloudflare addresses is a proxied record, not a record pointed at the wrong
 * box (`dns-target.js`).
 *
 * ── THE LIST ───────────────────────────────────────────────────────────────
 *
 * Copied from https://www.cloudflare.com/ips-v4 and /ips-v6 on 25 Nov 2026.
 * Cloudflare changes it rarely and announces it in advance; the list has been
 * unchanged since 2023. `CLOUDFLARE_IP_RANGES` (comma separated CIDRs) replaces
 * it without a deploy if that ever happens before the code is updated.
 *
 * Built on `net.BlockList`, which Node ships, rather than a dependency: CIDR
 * membership is exactly what it is for, for both families.
 */

const net = require("net");

const CLOUDFLARE_IPV4 = Object.freeze([
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
]);

const CLOUDFLARE_IPV6 = Object.freeze([
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
]);

/** `::ffff:203.0.113.9` is an IPv4 address carried on an IPv6 socket. */
function unmapped(address) {
  const s = String(address || "").trim();
  const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(s);
  return m ? m[1] : s;
}

/** A BlockList holding these CIDRs. Bad entries are skipped, never fatal. */
function buildList(cidrs) {
  const blocks = new net.BlockList();
  for (const raw of cidrs) {
    const [addr, bits] = String(raw).trim().split("/");
    const family = net.isIPv6(addr) ? "ipv6" : net.isIPv4(addr) ? "ipv4" : null;
    const prefix = Number(bits);
    if (!family || !Number.isInteger(prefix)) continue;
    blocks.addSubnet(addr, prefix, family);
  }
  return blocks;
}

function rangesFromEnv() {
  const raw = String(process.env.CLOUDFLARE_IP_RANGES || "").trim();
  if (!raw) return null;
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : null;
}

let cached = null;
function list() {
  if (!cached) cached = buildList(rangesFromEnv() || [...CLOUDFLARE_IPV4, ...CLOUDFLARE_IPV6]);
  return cached;
}

/** True when `address` is one of Cloudflare's edge addresses. */
function isCloudflare(address) {
  const ip = unmapped(address);
  if (net.isIPv4(ip)) return list().check(ip, "ipv4");
  if (net.isIPv6(ip)) return list().check(ip, "ipv6");
  return false;
}

/** Tests change the environment; this forgets the built list. */
function resetForTests() {
  cached = null;
}

module.exports = { CLOUDFLARE_IPV4, CLOUDFLARE_IPV6, isCloudflare, unmapped, resetForTests };
