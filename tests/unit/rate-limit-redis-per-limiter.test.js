"use strict";

/**
 * With Redis up, each limiter has its OWN store: its own key prefix and its
 * own window (SmartLS website v2, PR 2 follow-up).
 *
 * Found on staging on 25 Nov 2026: the website's first test message was
 * refused as "too many". Every IP-keyed limiter counted into one shared
 * `rl:<ip>` key, so reading pages, tracking and signing in spent the visitor's
 * ten-per-hour message allowance; and every limiter ran on the window of
 * whichever limiter touched the shared store first.
 */

const mockMade = [];
jest.mock("rate-limit-redis", () => {
  const { MemoryStore } = jest.requireActual("express-rate-limit");
  return {
    RedisStore: class {
      constructor(opts) {
        this.prefix = opts.prefix;
        this.m = new MemoryStore();
        mockMade.push(this);
      }
      init(o) {
        this.windowMs = o.windowMs;
        this.m.init(o);
      }
      increment(k) { return this.m.increment(k); }
      decrement(k) { return this.m.decrement(k); }
      resetKey(k) { return this.m.resetKey(k); }
    },
  };
});
jest.mock("../../src/config/redis", () => ({ getClient: () => ({ call: jest.fn() }) }));
jest.mock("../../src/config/logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const express = require("express");
const request = require("supertest");
const rl = require("../../src/shared/http/rate-limit");

const appWith = (limiter) => {
  const app = express();
  app.get("/x", limiter, (_req, res) => res.json({ ok: true }));
  return app;
};

describe("Redis-backed limiters", () => {
  beforeAll(() => expect(rl.initRateLimitStore()).toBe("redis"));

  it("each get their own prefix and their own window", async () => {
    await request(appWith(rl.makeLimiter({ name: "t-hourly", max: 5, windowMs: 60 * 60 * 1000 }))).get("/x");
    await request(appWith(rl.makeLimiter({ name: "t-quarter", max: 30, windowMs: 15 * 60 * 1000 }))).get("/x");
    const hourly = mockMade.find((s) => s.prefix === "rl:t-hourly:");
    const quarter = mockMade.find((s) => s.prefix === "rl:t-quarter:");
    expect(hourly.windowMs).toBe(60 * 60 * 1000);
    expect(quarter.windowMs).toBe(15 * 60 * 1000);
  });

  it("one limiter's traffic does not spend another's allowance", async () => {
    const pages = appWith(rl.makeLimiter({ name: "t-pages", max: 100, windowMs: 60_000 }));
    const messages = appWith(rl.makeLimiter({ name: "t-messages", max: 1, windowMs: 60_000 }));
    for (let i = 0; i < 5; i += 1) expect((await request(pages).get("/x")).status).toBe(200);
    expect((await request(messages).get("/x")).status).toBe(200);
    expect((await request(messages).get("/x")).status).toBe(429);
  });
});
