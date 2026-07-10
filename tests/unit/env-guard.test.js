"use strict";

/**
 * Regression guard for doc/PHASE0_PRODUCTION_AUDIT.md §2.
 *
 * The Zod schema ships dev-safe defaults for the JWT/ENCRYPTION secrets so the
 * app boots without a .env. In production those published defaults are a full
 * auth-bypass, so env.js must refuse to boot when they are left in place. These
 * tests re-load env.js in isolation with a crafted process.env.
 */

const REAL_ACCESS = "a".repeat(48);
const REAL_REFRESH = "b".repeat(48);
const REAL_ENCKEY = "0".repeat(63) + "1"; // 64 hex, not the default constant

function loadEnv(overrides) {
  let mod;
  jest.isolateModules(() => {
    const saved = { ...process.env };
    Object.assign(process.env, overrides);
    try {
      mod = require("../../src/config/env");
    } finally {
      // restore so other tests are unaffected
      for (const k of Object.keys(overrides)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });
  return mod;
}

describe("production secret guard", () => {
  it("refuses to boot in production with the default JWT/encryption secrets", () => {
    // JWT/ENCRYPTION intentionally NOT provided → the Zod schema fills the
    // published insecure defaults, which the production guard must reject.
    expect(() =>
      loadEnv({
        NODE_ENV: "production",
        DB_PASSWORD: "realpw",
      }),
    ).toThrow(/[Ii]nsecure/);
  });

  it("refuses to boot in production when DB_PASSWORD is empty", () => {
    expect(() =>
      loadEnv({
        NODE_ENV: "production",
        JWT_ACCESS_SECRET: REAL_ACCESS,
        JWT_REFRESH_SECRET: REAL_REFRESH,
        ENCRYPTION_KEY: REAL_ENCKEY,
        DB_PASSWORD: "",
      }),
    ).toThrow(/[Ii]nsecure/);
  });

  it("boots in production when real secrets are provided", () => {
    const mod = loadEnv({
      NODE_ENV: "production",
      JWT_ACCESS_SECRET: REAL_ACCESS,
      JWT_REFRESH_SECRET: REAL_REFRESH,
      ENCRYPTION_KEY: REAL_ENCKEY,
      DB_PASSWORD: "realpw",
    });
    expect(mod.config.NODE_ENV).toBe("production");
    expect(mod.config.JWT_ACCESS_SECRET).toBe(REAL_ACCESS);
  });

  it("still boots in development with defaults (dev ergonomics preserved)", () => {
    const mod = loadEnv({ NODE_ENV: "development" });
    expect(mod.config.NODE_ENV).toBe("development");
  });
});
