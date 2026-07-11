"use strict";
/** Tenant numbering (BUILD_CONVENTIONS §3/§6): pure format + allocation + scheme. */
const { formatNumber, allocate, schemeFor } = require("../../src/services/documents/numbering.service");

describe("formatNumber", () => {
  it("prefix-code-year-padded", () => {
    expect(formatNumber({ prefix: "SMLS", code: "INV", padding: 4 }, { year: 2026, seq: 7 })).toBe("SMLS-INV-2026-0007");
  });
  it("reset=never drops the year segment", () => {
    expect(formatNumber({ prefix: "DOC", reset: "never", padding: 4 }, { year: 0, seq: 42 })).toBe("DOC-0042");
  });
  it("honours a tenant separator + padding", () => {
    expect(formatNumber({ prefix: "P", code: "JE", separator: "/", padding: 6 }, { year: 2026, seq: 3 })).toBe("P/JE/2026/000003");
  });
});

describe("schemeFor", () => {
  it("merges tenant override over defaults; code defaults from module key", async () => {
    const c = { query: async () => ({ rows: [{ value: { prefix: "SMLS", padding: 5 } }] }) };
    const cfg = await schemeFor(c, "MOD-51");
    expect(cfg.prefix).toBe("SMLS");
    expect(cfg.padding).toBe(5);
    expect(cfg.code).toBe("51");
  });
  it("falls back to defaults when no setting row", async () => {
    const c = { query: async () => ({ rows: [] }) };
    const cfg = await schemeFor(c, "MOD-55");
    expect(cfg.prefix).toBe("DOC");
    expect(cfg.code).toBe("55");
  });
});

describe("allocate", () => {
  it("atomically increments and formats using the scheme", async () => {
    const calls = [];
    const c = { query: async (sql, params) => {
      calls.push(sql);
      if (/FROM setting/.test(sql)) return { rows: [{ value: { prefix: "SMLS", code: "INV" } }] };
      if (/INSERT INTO doc_sequence/.test(sql)) return { rows: [{ seq: 12 }] };
      return { rows: [] };
    } };
    const r = await allocate(c, { moduleKey: "MOD-51", entityId: "e1", date: "2026-02-05" });
    expect(r.seq).toBe(12);
    expect(r.year).toBe(2026);
    expect(r.number).toBe("SMLS-INV-2026-0012");
    expect(calls.some((s) => /ON CONFLICT/.test(s))).toBe(true);
  });
  it("requires an entity", async () => {
    const c = { query: async () => ({ rows: [] }) };
    await expect(allocate(c, { moduleKey: "MOD-51", date: "2026-02-05" })).rejects.toThrow(/entity/i);
  });
});
