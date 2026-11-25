"use strict";

/**
 * The visitor's real address behind Cloudflare, and the DNS check that accepts
 * a proxied record (SmartLS website v2, PR 2).
 *
 * The bug this pins: behind a proxied Cloudflare record every visitor reached
 * us from a Cloudflare edge, so `req.ip` was one shared address and a single
 * spammer used up the five-per-hour contact allowance for everyone. The fix is
 * only safe if `CF-Connecting-IP` is believed from Cloudflare and NOBODY else,
 * because anyone can send that header straight at the origin.
 */

const express = require("express");
const request = require("supertest");
const { resolveVisitorIp, visitorIp } = require("../../src/shared/http/visitor-ip");
const cf = require("../../src/shared/net/cloudflare-ranges");
const { STATES, classify } = require("../../src/shared/net/dns-target");

const EDGE_V4 = "172.68.10.20"; // 172.64.0.0/13
const EDGE_V6 = "2606:4700:10::ac43:1"; // 2606:4700::/32
const VISITOR = "102.244.33.7";
const ATTACKER = "203.0.113.50";

describe("Cloudflare's ranges", () => {
  it("knows its own edges, in both families and on a mapped socket", () => {
    expect(cf.isCloudflare(EDGE_V4)).toBe(true);
    expect(cf.isCloudflare(`::ffff:${EDGE_V4}`)).toBe(true);
    expect(cf.isCloudflare(EDGE_V6)).toBe(true);
    expect(cf.isCloudflare("104.16.0.1")).toBe(true);
  });

  it("does not mistake anybody else for Cloudflare", () => {
    for (const ip of [VISITOR, ATTACKER, "51.254.165.120", "10.0.0.1", "127.0.0.1", "::1", "", null, "not-an-ip"]) {
      expect(cf.isCloudflare(ip)).toBe(false);
    }
  });

  it("can be replaced from the environment without a deploy", () => {
    const before = process.env.CLOUDFLARE_IP_RANGES;
    process.env.CLOUDFLARE_IP_RANGES = "198.51.100.0/24";
    cf.resetForTests();
    try {
      expect(cf.isCloudflare("198.51.100.9")).toBe(true);
      expect(cf.isCloudflare(EDGE_V4)).toBe(false);
    } finally {
      if (before === undefined) delete process.env.CLOUDFLARE_IP_RANGES;
      else process.env.CLOUDFLARE_IP_RANGES = before;
      cf.resetForTests();
    }
  });
});

describe("resolveVisitorIp", () => {
  it("takes CF-Connecting-IP when the connection came from Cloudflare", () => {
    expect(resolveVisitorIp(EDGE_V4, { "cf-connecting-ip": VISITOR })).toBe(VISITOR);
    expect(resolveVisitorIp(EDGE_V6, { "cf-connecting-ip": "2a02:c7f:1::1" })).toBe("2a02:c7f:1::1");
  });

  it("ignores the header from anybody else, so it cannot be forged at the origin", () => {
    expect(resolveVisitorIp(ATTACKER, { "cf-connecting-ip": VISITOR })).toBe(ATTACKER);
  });

  it("keeps the edge when the header is missing or is not an address", () => {
    expect(resolveVisitorIp(EDGE_V4, {})).toBe(EDGE_V4);
    expect(resolveVisitorIp(EDGE_V4, { "cf-connecting-ip": "1.2.3.4, 5.6.7.8" })).toBe(EDGE_V4);
    expect(resolveVisitorIp(EDGE_V4, { "cf-connecting-ip": "<script>" })).toBe(EDGE_V4);
  });
});

describe("the middleware, behind one trusted proxy hop", () => {
  const app = express();
  app.set("trust proxy", 1);
  app.use(visitorIp);
  app.get("/ip", (req, res) => res.json({ ip: req.ip, edge: req.edgeIp || null }));

  it("re-keys req.ip on the visitor when nginx saw a Cloudflare edge", async () => {
    const r = await request(app).get("/ip").set("X-Forwarded-For", EDGE_V4).set("CF-Connecting-IP", VISITOR);
    expect(r.body).toEqual({ ip: VISITOR, edge: EDGE_V4 });
  });

  it("leaves req.ip alone when nginx saw a direct caller sending the header", async () => {
    const r = await request(app).get("/ip").set("X-Forwarded-For", ATTACKER).set("CF-Connecting-IP", VISITOR);
    expect(r.body).toEqual({ ip: ATTACKER, edge: null });
  });

  it("is mounted in server.js right after trust proxy, before the limiters", () => {
    const src = require("fs").readFileSync(require("path").join(__dirname, "../../src/server.js"), "utf8");
    const trust = src.indexOf('app.set("trust proxy"');
    const mount = src.indexOf("app.use(visitorIp);");
    const limiter = src.indexOf("app.use(buildAccessLog())");
    expect(trust).toBeGreaterThan(0);
    expect(mount).toBeGreaterThan(trust);
    expect(mount).toBeLessThan(limiter);
  });
});

describe("the platform DNS check accepts a proxied record", () => {
  const HERE = "51.254.165.120";
  it("reads Cloudflare-only records as proxied and correct", () => {
    expect(classify(["104.21.32.1", "172.67.150.2"], HERE)).toEqual({ state: STATES.PROXIED, ok: true });
  });
  it("still calls a record pointed at somebody else wrong", () => {
    expect(classify(["37.59.83.88"], HERE)).toEqual({ state: STATES.WRONG_TARGET, ok: false });
    expect(classify(["104.21.32.1", "37.59.83.88"], HERE).state).toBe(STATES.WRONG_TARGET);
  });
  it("prefers the direct answer when our address is there", () => {
    expect(classify([HERE, "104.21.32.1"], HERE).state).toBe(STATES.OK);
  });
});
