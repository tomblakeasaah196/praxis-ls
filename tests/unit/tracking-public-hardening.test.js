"use strict";

/**
 * Public tracking, hardened (SmartLS website v2, PR 2).
 *
 * The owner's words for the rule: "a reference must never be guessable". The
 * allocator already makes references random; these tests are the tripwire that
 * fails the build the day a sequential or `Math.random` reference appears
 * anywhere a dossier reference is made, and they pin the lookup's three rules:
 * Crockford folding, random references only, and one answer for "not found"
 * and "malformed".
 */

const fs = require("fs");
const path = require("path");

const svc = require("../../src/modules/operations/tracking_public/tracking_public.service");
const opRef = require("../../src/services/documents/operation-reference");
const msgRef = require("../../src/modules/sales/inbound_intake/inbound_intake.reference");

const ROOT = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
/** The code without its comments, so a comment that SAYS "never Math.random" is not a hit. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

describe("the reference a visitor types is folded the Crockford way", () => {
  it.each([
    ["sl-7z3k 9qw2-m4xb-sm", "S17Z3K9QW2M4XBSM"],
    ["SL7Z3K9QW2M4XBSM", "S17Z3K9QW2M4XBSM"],
    [" S L 7Z3K9QW2M4XB SM ", "S17Z3K9QW2M4XBSM"],
    ["sl.7z3k9qw2m4xb.sm", "S17Z3K9QW2M4XBSM"],
    ["SL7Z3K9QW2M4XBSM".replace("0", "O"), "S17Z3K9QW2M4XBSM"],
    ["SL6721864SM", "S16721864SM"],
  ])("%s reads as %s", (typed, key) => {
    expect(svc.lookupKey(typed)).toBe(key);
  });

  it("reads O as 0 and I or L as 1, on both sides", () => {
    expect(svc.foldReference("SLO1IL")).toBe("S10111");
    // The stored side is folded by the same rule in SQL (14621's index).
    const sql = read("src/modules/operations/tracking_public/tracking_public.service.js");
    expect(sql).toContain("translate(upper(d.ref), 'OIL', '011')");
    expect(read("migrations/tenant/14621_tracking_reference_fold.sql")).toContain("translate(upper(ref), 'OIL', '011')");
  });

  it("refuses a sequential reference before its dashes are stripped", () => {
    expect(svc.lookupKey("SLAS-OPS-2026-0142")).toBeNull();
    expect(svc.lookupKey("SLAS/OPS/2026/0142")).toBeNull();
    expect(svc.lookupKey("DRAFT-0f8c2b1e")).toBeNull();
  });

  it("refuses what cannot be a reference at all", () => {
    for (const bad of ["", "   ", "abc", "x".repeat(41), "SL<script>SM", "SL7Z3K9QW2M4XBSM'; DROP TABLE dossier; --"]) {
      expect(svc.lookupKey(bad)).toBeNull();
    }
  });
});

describe("not found and malformed are the same answer", () => {
  const fakeClient = (rows = []) => {
    const calls = [];
    return {
      calls,
      query: jest.fn(async (sql, params) => {
        calls.push({ sql, params });
        return { rows };
      }),
    };
  };

  it("runs the same single query for both, and throws the same error", async () => {
    const malformed = fakeClient();
    const unknown = fakeClient();
    const e1 = await svc.get(malformed, "%%%").catch((e) => e);
    const e2 = await svc.get(unknown, "SL7Z3K9QW2M4XBSM").catch((e) => e);
    expect(malformed.calls).toHaveLength(1);
    expect(unknown.calls).toHaveLength(1);
    expect(malformed.calls[0].sql).toBe(unknown.calls[0].sql);
    expect(malformed.calls[0].params).toEqual(["#"]);
    for (const e of [e1, e2]) {
      expect(e.status).toBe(404);
      expect(e.code).toBe("NOT_FOUND");
    }
    expect(e1.message).toBe(e2.message);
  });

  it("only ever looks up references made of letters and digits", () => {
    const text = read("src/modules/operations/tracking_public/tracking_public.service.js");
    expect(text).toContain("AND d.ref ~ '^[A-Za-z0-9]+$'");
  });

  it("answers two fold-alike references only for the one typed exactly", async () => {
    const rows = [{ dossier_id: "a", ref: "SL0AAAAAAAAAAASM" }, { dossier_id: "b", ref: "SLOAAAAAAAAAAASM" }];
    expect((await svc.findDossier(fakeClient(rows), "SL0AAAAAAAAAAASM")).dossier_id).toBe("a");
    expect(await svc.findDossier(fakeClient(rows), "SLQAAAAAAAAAAASM")).toBeNull();
  });
});

describe("no reference is ever sequential or Math.random", () => {
  it("the allocators draw from crypto.randomBytes and nothing predictable", () => {
    for (const rel of [
      "src/services/documents/operation-reference.js",
      "src/modules/sales/inbound_intake/inbound_intake.reference.js",
    ]) {
      const c = code(read(rel));
      expect(c).not.toMatch(/Math\.random/);
      expect(c).not.toMatch(/nextval\s*\(/i);
      expect(c).not.toMatch(/Date\.now\s*\(/);
    }
    expect(code(read("src/services/documents/operation-reference.js"))).toMatch(/crypto\.randomBytes/);
  });

  it("no file that touches dossiers calls Math.random", () => {
    const hits = walk(path.join(ROOT, "src"))
      .filter((f) => {
        const c = code(fs.readFileSync(f, "utf8"));
        return /\bdossier\b/i.test(c) && /Math\.random/.test(c);
      })
      .map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  it("every dossier reference the operations file writes comes from the random allocator", () => {
    const c = code(read("src/modules/operations/operations_file/operations_file.service.js"));
    // A field error (`ref: ["already allocated as …"]`) is a message, not a write.
    const writes = [...c.matchAll(/\bref\s*:\s*([^,}\n]+)/g)].map((m) => m[1].trim()).filter((w) => !w.startsWith("["));
    for (const w of writes) {
      // The allocator's callback hands the reference in as `ref`; the only other
      // value is a draft's placeholder, which is never public (tracking refuses
      // DRAFT- and the view hides drafts).
      expect([w, w === "ref" || /^"DRAFT-" \+ crypto\.randomUUID\(\)$/.test(w) || /^dossier\.ref$|^before\.ref$/.test(w)]).toEqual([w, true]);
    }
    expect(c).toMatch(/allocateOperationReference\(/);
  });

  it("the doc_sequence numbering is never asked for a dossier reference", () => {
    const hits = walk(path.join(ROOT, "src"))
      .filter((f) => /numbering\.allocate\([^)]*["'](OPS|DOSSIER|OPERATION)/.test(code(fs.readFileSync(f, "utf8"))))
      .map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  it("references drawn in a row are distinct and show no order", () => {
    const N = 2000;
    const cores = Array.from({ length: N }, () => opRef.randomCore());
    expect(new Set(cores).size).toBe(N);
    for (const c of cores) expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    let rising = 0;
    for (let i = 1; i < N; i += 1) if (cores[i] > cores[i - 1]) rising += 1;
    // A counter rises every time; random draws rise about half the time.
    expect(rising / (N - 1)).toBeGreaterThan(0.4);
    expect(rising / (N - 1)).toBeLessThan(0.6);
  });

  it("message references are MSG- and eight random characters, never a count", () => {
    const refs = Array.from({ length: 500 }, () => msgRef.newReference());
    expect(new Set(refs).size).toBe(500);
    for (const r of refs) expect(r).toMatch(/^MSG-[0-9A-HJKMNP-TV-Z]{8}$/);
  });
});
