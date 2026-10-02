"use strict";
/**
 * Search that finds everything (tenant review, meeting 6, PR 4 — G5).
 *
 * What is pinned, in the order a request meets it:
 *
 *   · the fold is ONE table — the shared one the palette uses and the one
 *     migration 14382 builds `search_fold()` and its indexes from;
 *   · the synonym list never puts one word in two groups, and a group word at
 *     either end of a term is read as a type hint ("facture 0042");
 *   · the service queries ONLY the providers whose module the person may view
 *     (the same `can_read` grant requirePermission checks; the CEO bypass and
 *     nothing else), on the connection it is handed — the request's LIVE or
 *     TEST schema — bounded, and with one failing provider costing only its
 *     own group;
 *   · every provider's SQL names columns that exist (the query-columns
 *     catalogue), folds what it matches, and is LIMITed;
 *   · the route is authenticated, validated by the shared schema and rate
 *     limited;
 *   · the gate (scripts/check-search-registry.js) passes on this tree and
 *     fails on each thing it exists to catch.
 */
const fs = require("fs");
const path = require("path");

const mockGetGrants = jest.fn();
jest.mock("../../src/shared/cache/identity-cache", () => ({ getGrants: (...a) => mockGetGrants(...a) }));

const { search: shared } = require("@praxis/shared");
const service = require("../../src/services/search/search.service");
const registry = require("../../src/services/search/registry");
const { recordProvider } = require("../../src/services/search/provider");
const gate = require("../../scripts/check-search-registry");
const { buildCatalogue, checkSql, checkTables } = require("../../scripts/db/check-query-columns");

const ROOT = path.resolve(__dirname, "../..");

/** A connection that records every statement, answering with `rowsFor(sql)`. */
function fakeClient(rowsFor = () => [], { trigram = true, failOn = null } = {}) {
  const sql = [];
  return {
    sql,
    async query(text, params) {
      // Not already in a transaction: the tx helper's probe fails, as on a real pooled client.
      if (/SAVEPOINT praxis_tx_probe/.test(text)) throw new Error("SAVEPOINT can only be used in transaction blocks");
      sql.push({ text, params });
      if (/pg_extension/.test(text)) return { rows: [{ ok: trigram }] };
      if (failOn && failOn.test(text)) throw new Error("column does not exist");
      return { rows: /\bFROM\b/.test(text) && /LIMIT \$4/.test(text) ? rowsFor(text, params) : [] };
    },
  };
}

describe("one fold, everywhere", () => {
  it("is the same table as migration 14382's search_fold()", () => {
    const mig = fs.readFileSync(path.join(ROOT, "migrations/tenant/14382_search_fold_trigram.sql"), "utf8");
    const m = mig.match(/translate\(\s*lower\(COALESCE\(t, ''\)\),\s*'([^']+)',\s*'([^']+)'/);
    expect(m).toBeTruthy();
    expect(m[1]).toBe(shared.FOLD_FROM);
    expect(m[2]).toBe(shared.FOLD_TO);
    expect([...shared.FOLD_FROM].length).toBe([...shared.FOLD_TO].length);
  });

  it("folds case, accents and spacing", () => {
    expect(shared.fold("  Société   GÉNÉRALE ")).toBe("societe generale");
    expect(shared.fold("Débours")).toBe("debours");
  });
});

describe("the synonym list", () => {
  it("never puts one word in two groups", () => {
    const owner = new Map();
    const clash = [];
    for (const g of shared.SYNONYMS) {
      for (const w of g.words) {
        const k = shared.fold(w);
        if (owner.has(k) && owner.get(k) !== g.key) clash.push(`${w}: ${owner.get(k)} and ${g.key}`);
        owner.set(k, g.key);
      }
    }
    expect(clash).toEqual([]);
  });

  it("maps the owner's words to Quotations", () => {
    for (const w of ["quote", "devis", "cotation", "offer", "Devis", "COTATION"]) expect(shared.conceptOf(w)).toBe("quotation");
    expect(shared.conceptOf("facture")).toBe("invoice");
    expect(shared.conceptOf("dossier")).toBe("file");
    expect(shared.conceptOf("customer")).toBe("client");
  });
});

describe("type hints", () => {
  const known = new Set(["invoice", "client", "purchase_order", "quotation", "file"]);
  it.each([
    ["facture 0042", { type: "invoice", term: "0042" }],
    ["0042 facture", { type: "invoice", term: "0042" }],
    ["client acme", { type: "client", term: "acme" }],
    ["bon de commande 12", { type: "purchase_order", term: "12" }],
    ["devis QUO-7", { type: "quotation", term: "QUO-7" }],
  ])("reads %s", (q, want) => {
    expect(service.typeHint(q, known)).toEqual(want);
  });
  it("is not a hint when the type is the whole term, or has no provider", () => {
    expect(service.typeHint("factures", known)).toBeNull();
    expect(service.typeHint("vehicule AB-123", known)).toBeNull();
    expect(service.typeHint("facture x", known)).toBeNull(); // the rest is under two letters
  });
});

describe("who may see what", () => {
  beforeEach(() => mockGetGrants.mockReset());

  it("asks the same can_read grant requirePermission does, module by module", async () => {
    mockGetGrants.mockImplementation(async (_c, { module }) => (module === "MOD-03" ? [{ can_read: true }] : module === "MOD-51" ? [{ can_read: false }] : []));
    const allowed = await service.allowedModules({}, { role_ids: ["r1"], is_ceo: false }, ["MOD-03", "MOD-51", "MOD-27", "MOD-03"]);
    expect([...allowed]).toEqual(["MOD-03"]);
    expect(mockGetGrants).toHaveBeenCalledWith({}, { role_ids: ["r1"], module: "MOD-51" });
  });

  it("lets the CEO through exactly as rbac.js does — and only an `=== true` CEO", async () => {
    expect([...(await service.allowedModules({}, { is_ceo: true }, ["MOD-03", "MOD-51"]))]).toEqual(["MOD-03", "MOD-51"]);
    mockGetGrants.mockResolvedValue([]);
    expect([...(await service.allowedModules({}, { is_ceo: "yes", role_ids: ["r"] }, ["MOD-03"]))]).toEqual([]);
    expect([...(await service.allowedModules({}, null, ["MOD-03"]))]).toEqual([]);
  });
});

describe("the search", () => {
  it("queries only the providers whose module is allowed, on the connection it is given", async () => {
    const c = fakeClient((text) => (/FROM client_master c\b/.test(text) ? [{ id: "c1", ref: "CL-1", title: "Acme Trading" }] : []));
    const out = await service.search(c, { q: "acme", allowed: new Set(["MOD-03"]) });
    const reads = c.sql.filter((s) => /LIMIT \$4/.test(s.text));
    // Clients and client contacts — both MOD-03 — and nothing else.
    expect(reads).toHaveLength(2);
    for (const r of reads) expect(r.text).toMatch(/client_(master|contact)/);
    expect(out.groups.map((g) => g.type)).toEqual(["client"]);
    expect(out.groups[0].items[0]).toMatchObject({ id: "c1", title: "Acme Trading", url: "/master/clients?focus=c1" });
  });

  it("answers nothing — and reads nothing — for someone with no grants", async () => {
    const c = fakeClient();
    const out = await service.search(c, { q: "acme", allowed: new Set() });
    expect(out.groups).toEqual([]);
    expect(c.sql).toEqual([]);
  });

  it("runs bounded: a timeout, a typo threshold, the limit capped at 10", async () => {
    const c = fakeClient();
    await service.search(c, { q: "acme", limit: 500, allowed: new Set(["MOD-03"]) });
    expect(c.sql.some((s) => /statement_timeout/.test(s.text) && /word_similarity_threshold/.test(s.text))).toBe(true);
    for (const s of c.sql.filter((x) => /LIMIT \$4/.test(x.text))) expect(s.params[3]).toBe(10);
  });

  it("isolates a failing provider in its own savepoint — the other groups still answer", async () => {
    const c = fakeClient((text) => (/FROM client_master c\b/.test(text) ? [{ id: "c1", title: "Acme" }] : []), { failOn: /client_contact/ });
    const out = await service.search(c, { q: "acme", allowed: new Set(["MOD-03"]) });
    expect(out.groups.map((g) => g.type)).toEqual(["client"]);
    expect(c.sql.some((s) => /ROLLBACK TO SAVEPOINT praxis_search/.test(s.text))).toBe(true);
    expect(c.sql.map((x) => x.text)).toContain("BEGIN");
    expect(c.sql[c.sql.length - 1].text).toBe("COMMIT");
  });

  it("reads a type hint and searches the rest in that type only", async () => {
    const c = fakeClient();
    const out = await service.search(c, { q: "facture 0042", allowed: new Set(["MOD-51", "MOD-03"]) });
    expect(out.hint).toBe("invoice");
    expect(out.q).toBe("0042");
    const reads = c.sql.filter((s) => /LIMIT \$4/.test(s.text));
    expect(reads).toHaveLength(1);
    expect(reads[0].text).toMatch(/i\.type = 'FINAL'/);
    expect(reads[0].params[2]).toBe("0042");
  });

  it("matches folded, and skips the typo pass without pg_trgm or for a short term", async () => {
    const c = fakeClient(() => [], { trigram: false });
    await service.search(c, { q: "Société", allowed: new Set(["MOD-03"]) });
    const read = c.sql.find((s) => /LIMIT \$4/.test(s.text));
    expect(read.params[0]).toBe("%societe%");
    expect(read.text).toMatch(/search_fold\(c\.name::text\) LIKE \$1/);
    expect(read.text).not.toMatch(/<%/);

    const c2 = fakeClient();
    await service.search(c2, { q: "nguema", allowed: new Set(["MOD-02"]) });
    expect(c2.sql.find((s) => /LIMIT \$4/.test(s.text)).text).toMatch(/\$3 <% search_fold\(e\.full_name::text\)/);
    const c3 = fakeClient();
    await service.search(c3, { q: "ab", allowed: new Set(["MOD-02"]) });
    expect(c3.sql.find((s) => /LIMIT \$4/.test(s.text)).text).not.toMatch(/<%/);
  });

  it("treats a typed % or _ as a letter, not a wildcard", async () => {
    const c = fakeClient();
    await service.search(c, { q: "50%_off", allowed: new Set(["MOD-03"]) });
    expect(c.sql.find((s) => /LIMIT \$4/.test(s.text)).params[0]).toBe("%50\\%\\_off%");
  });

  it("asks nothing for a term under two letters", async () => {
    const c = fakeClient();
    expect((await service.search(c, { q: " a ", allowed: new Set(["MOD-03"]) })).groups).toEqual([]);
    expect(c.sql).toEqual([]);
  });
});

describe("the providers", () => {
  const providers = registry.providers();
  const cat = buildCatalogue();

  it("cover every record type the owner named (G5)", () => {
    const types = new Set(providers.map((p) => p.type));
    for (const t of ["client", "supplier", "contact", "file", "quote_request", "proposal", "quotation", "costing", "invoice", "proforma", "receipt", "purchase_order", "employee", "treasury_account", "dictionary_item", "service_type", "document"]) {
      expect(types.has(t)).toBe(true);
    }
  });

  it.each(registry.providers().map((p) => [p.type, p]))("%s: real columns, folded, limited, gated by a module", async (_t, p) => {
    expect(p.module).toMatch(/^MOD-/);
    const c = fakeClient(() => [{ id: "x1", ref: "R-1", title: "T" }]);
    const items = await p.search(c, { term: "acme", folded: "acme", limit: 5, fuzzy: true });
    const { text, params } = c.sql[0];
    expect([...checkSql(text, cat), ...checkTables(text, cat)]).toEqual([]);
    expect(text).toMatch(/search_fold\(/);
    expect(text).toMatch(/LIMIT \$4/);
    expect(params[3]).toBe(5);
    expect(items[0].url.startsWith("/")).toBe(true);
    expect(items[0].type).toBe(p.type);
  });

  it("refuses a provider without a module key", () => {
    expect(() => recordProvider({ type: "x", label: { en: "X", fr: "X" }, route: "/x", from: "x", columns: ["x.a"], select: "1", url: () => "/" })).toThrow(/module/);
  });
});

describe("GET /search", () => {
  const { router, basePath } = require("../../src/modules/search/search.routes");
  const { isRateLimiter } = require("../../src/shared/http/rate-limit");
  const layer = router.stack.find((l) => l.route && l.route.path === "/");

  it("is mounted at /search, authenticated, rate limited and validated", () => {
    expect(basePath).toBe("/search");
    expect(router.stack[0].name).toMatch(/auth/i);
    const handles = layer.route.stack.map((s) => s.handle);
    expect(handles.some(isRateLimiter)).toBe(true);
  });

  it("refuses a term the palette would not send", () => {
    const v = require("../../src/modules/search/search.validator");
    const next = jest.fn();
    v.query({ query: { q: "a" } }, {}, next);
    expect(next.mock.calls[0][0]).toMatchObject({ code: "VALIDATION_ERROR" });
    const ok = jest.fn();
    const req = { query: { q: "  acme ", types: "client,quotation", limit: "3" } };
    v.query(req, {}, ok);
    expect(ok).toHaveBeenCalledWith();
    expect(req.searchQuery).toEqual({ q: "acme", types: "client,quotation", limit: 3 });
  });
});

describe("the gate", () => {
  const reg = () => JSON.parse(fs.readFileSync(path.join(ROOT, "client/src/app/screen-registry.json"), "utf8"));
  const rules = (over) => gate.check(over).problems.map((p) => p.rule);

  it("passes on this tree", () => {
    expect(gate.check().problems).toEqual([]);
  });

  it("fails on a routed screen with no entry", () => {
    const r = reg();
    r.screens = r.screens.filter((s) => s.route !== "/settings/commercial");
    expect(rules({ registry: r })).toContain("route");
  });

  it("fails on a hub section with no screen", () => {
    const r = reg();
    r.screens = r.screens.filter((s) => s.route !== "/sales/quotations");
    expect(rules({ registry: r })).toContain("section");
  });

  it("fails on a URL-addressable tab with no entry, and on a tab the file no longer has", () => {
    const r = reg();
    r.tabs = r.tabs.filter((t) => t.id !== "file_360_money");
    expect(rules({ registry: r })).toContain("tab");
    const r2 = reg();
    r2.tabs.push({ ...r2.tabs[0], id: "ghost", value: "Ghost" });
    expect(rules({ registry: r2 })).toContain("stale");
  });

  it("fails on an entry whose route is gone, and on a redirect to nowhere", () => {
    const r = reg();
    r.screens.push({ ...r.screens[1], id: "ghost", route: "/nowhere/at-all", title_fr: "Nulle part" });
    expect(rules({ registry: r })).toContain("stale");
    const r2 = reg();
    r2.redirects[0].to = "/not/registered";
    expect(rules({ registry: r2 })).toContain("stale");
  });

  it("fails on a module with records and neither a provider nor a reasoned opt-out", () => {
    expect(rules({ modules: [{ dir: "x/thing", provider: null, optOut: null }] })).toContain("records");
    expect(rules({ modules: [{ dir: "x/thing", provider: null, optOut: { file: "thing.controller.js", reason: "-" } }] })).toContain("records");
    expect(rules({ modules: [{ dir: "x/thing", provider: null, optOut: { file: "thing.controller.js", reason: "configuration, not records" } }] })).not.toContain("records");
  });

  it("fails on a page with no French title", () => {
    const r = reg();
    delete r.screens.find((s) => s.route === "/sales/quotations").title_fr;
    expect(rules({ registry: r })).toContain("french");
  });

  it("is wired into npm run ci and CI", () => {
    expect(fs.readFileSync(path.join(ROOT, "scripts/ci-local.js"), "utf8")).toMatch(/check-search-registry\.js/);
    expect(fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yaml"), "utf8")).toMatch(/node scripts\/check-search-registry\.js/);
  });
});
