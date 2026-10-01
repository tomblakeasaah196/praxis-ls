"use strict";

/**
 * Where a service type sits in a quote request (tenant review, meeting 6, PR 2):
 * its card, its flow, and the Incoterms it offers.
 *
 * The card is decided in TWO places that must agree — `@praxis/shared`
 * rules/service-scope.js (the form's suggestion, the tracking glyph, the
 * public services payload) and migration 14300's `service_type_mode_from_key`
 * (the backfill and the insert trigger). The same is true of the Incoterm
 * defaults (data/incoterms.js vs `service_type_default_incoterms`). These tests
 * read the migration's SQL so a word added on one side and not the other
 * fails here, rather than as a service that is "Sea" on the form and "Road" in
 * the database.
 */

const fs = require("fs");
const path = require("path");
const { serviceScope, incoterms, emailDomain, quoteRequest } = require("@praxis/shared");

const MIGRATION = fs.readFileSync(
  path.join(__dirname, "../../migrations/tenant/14300_service_type_quote_card.sql"),
  "utf8",
);
const SEED = fs.readFileSync(path.join(__dirname, "../../migrations/seeds/9080_seed_dictionary.sql"), "utf8");

/** The body of one `CREATE OR REPLACE FUNCTION name(...) ... $$ … $$`. */
function fnBody(name) {
  const at = MIGRATION.indexOf(`FUNCTION ${name}(`);
  if (at < 0) throw new Error(`${name} not found in 14300`);
  const open = MIGRATION.indexOf("$$", at);
  const close = MIGRATION.indexOf("$$", open + 2);
  return MIGRATION.slice(open + 2, close);
}

/** The SQL ladder as `[mode, [words…]]`, in its WHEN order. */
function sqlLadder() {
  const out = [];
  const re = /WHEN\s+(.+?)\s+THEN\s+'([A-Z]+)'/g;
  const body = fnBody("service_type_mode_from_key");
  let m;
  while ((m = re.exec(body))) {
    const words = [...m[1].matchAll(/LIKE\s+'%([A-Z]+)%'/g)].map((w) => w[1]);
    out.push([m[2], words]);
  }
  return out;
}

/** The SQL defaults as `{ AIR: [...], STORAGE: [], ELSE: [...] }`. */
function sqlDefaults() {
  const body = fnBody("service_type_default_incoterms");
  const arr = (s) => [...s.matchAll(/'([A-Z]{3})'/g)].map((x) => x[1]);
  const anyMode = /IN \('AIR', 'ROAD', 'RAIL'\) THEN ARRAY\[([^\]]*)\]/.exec(body);
  const storage = /= 'STORAGE' THEN ARRAY\[([^\]]*)\]/.exec(body);
  const rest = /ELSE ARRAY\[([^\]]*)\]/.exec(body);
  return { anyMode: arr(anyMode[1]), storage: arr(storage[1]), rest: arr(rest[1]) };
}

/** The fifteen service types seed 9080 inserts, as rows. */
function seededServiceTypes() {
  const block = SEED.slice(SEED.indexOf("INSERT INTO service_type (key, name_fr, name_en, territory, is_system) VALUES"));
  const end = block.indexOf("ON CONFLICT");
  return [...block.slice(0, end).matchAll(/\('([A-Z_]+)','[^']*','[^']*','([A-Z_]+)',true\)/g)].map((m, i) => ({
    service_type_id: `st-${i}`,
    key: m[1],
    territory: m[2],
    is_active: true,
  }));
}

describe("the key ladder — one reading in JS and SQL", () => {
  test("migration 14300 mirrors MODE_LADDER term for term, in the same precedence", () => {
    const sql = sqlLadder();
    expect(sql).toEqual(serviceScope.MODE_LADDER.map(([mode, words]) => [mode, [...words]]));
  });

  test("anything the ladder misses is OTHER on both sides", () => {
    expect(serviceScope.modeFromKey("BUSINESS_REPRESENTATION")).toBe("OTHER");
    expect(fnBody("service_type_mode_from_key")).toMatch(/ELSE 'OTHER'/);
  });

  test.each([
    ["SEA_FREIGHT_IMPORT", "SEA"],
    ["AIR_FREIGHT_EXPORT", "AIR"],
    ["SEA_AIR_COMBINED", "AIR"], // AIR before SEA: drawn as the tracking page always has
    ["RAIL_HINTERLAND_TRANSIT", "RAIL"], // RAIL before ROAD
    ["HINTERLAND_TRANSIT", "ROAD"],
    ["INLAND_TRANSPORTATION", "ROAD"],
    ["WAREHOUSING", "STORAGE"],
    ["CUSTOMS_BROKERAGE", "CUSTOMS"],
    ["PROJECT_CARGO", "OTHER"],
    [null, "OTHER"],
    ["sea_freight_import", "SEA"],
  ])("modeFromKey(%s) is %s", (key, mode) => {
    expect(serviceScope.modeFromKey(key)).toBe(mode);
  });

  test("the tracking glyph keeps its vocabulary — storage is WAREHOUSE", () => {
    expect(serviceScope.glyphOf("STORAGE")).toBe("WAREHOUSE");
    expect(serviceScope.glyphOf("SEA")).toBe("SEA");
    expect(serviceScope.glyphOf("nonsense")).toBe("OTHER");
  });

  test("an explicit transport_mode wins over the key", () => {
    expect(serviceScope.modeOf({ key: "SEA_FREIGHT_IMPORT", transport_mode: "road" })).toBe("ROAD");
    expect(serviceScope.modeOf({ key: "SEA_FREIGHT_IMPORT", transport_mode: "SUBMARINE" })).toBe("SEA");
    expect(serviceScope.modeOf({ key: "SEA_FREIGHT_IMPORT", transport_mode: null })).toBe("SEA");
  });
});

describe("Incoterm defaults — ICC 2020, the same table in JS and SQL", () => {
  test("eleven terms, four of them sea-only", () => {
    expect(incoterms.CODES).toHaveLength(11);
    expect(incoterms.SEA_ONLY).toEqual(["FAS", "FOB", "CFR", "CIF"]);
    expect(incoterms.ANY_MODE).toHaveLength(7);
  });

  test("migration 14300's defaults are data/incoterms.js's, in order", () => {
    const sql = sqlDefaults();
    expect(sql.anyMode).toEqual(incoterms.defaultsForMode("AIR"));
    expect(sql.storage).toEqual(incoterms.defaultsForMode("STORAGE"));
    expect(sql.rest).toEqual(incoterms.defaultsForMode("SEA"));
  });

  test.each([
    ["SEA", 11],
    ["AIR", 7],
    ["ROAD", 7],
    ["RAIL", 7],
    ["STORAGE", 0],
    ["CUSTOMS", 11],
    ["OTHER", 11],
  ])("a %s service offers %i terms", (mode, n) => {
    const terms = incoterms.defaultsForMode(mode);
    expect(terms).toHaveLength(n);
    if (n === 7) for (const c of incoterms.SEA_ONLY) expect(terms).not.toContain(c);
  });

  test("normalise keeps only real codes, uppercased, in ICC order, once each", () => {
    expect(incoterms.normalise(["cif", "EXW", "XYZ", "exw", null])).toEqual(["EXW", "CIF"]);
    expect(incoterms.normalise("FOB")).toEqual([]);
  });

  test("labels: a term names itself; Not sure reads To be determined", () => {
    expect(incoterms.label("fob")).toBe("FOB — Free On Board");
    expect(incoterms.label("FOB", "fr")).toBe("FOB — Franco à bord");
    expect(incoterms.label("TBD")).toBe("To be determined");
    expect(incoterms.label("TBD", "fr")).toBe("À déterminer");
    expect(incoterms.label("N/A")).toBe("Not applicable");
  });
});

describe("cards and flows", () => {
  test("a territory places a service in a flow, or in none", () => {
    expect(serviceScope.flowOf("INTERNATIONAL_IMPORT")).toBe("IMPORT");
    expect(serviceScope.flowOf("TRANSIT_HINTERLAND")).toBe("HINTERLAND");
    expect(serviceScope.flowOf("PORT_AIRPORT_ZONE")).toBeNull();
    expect(serviceScope.flowOf(null)).toBeNull();
  });

  test("only a hinterland transit asks which way it runs", () => {
    expect(serviceScope.needsHinterlandDirection({ key: "HINTERLAND_TRANSIT", territory: "TRANSIT_HINTERLAND" })).toBe(true);
    expect(serviceScope.needsHinterlandDirection({ key: "INLAND_TRANSPORTATION", territory: "DOMESTIC_INLAND" })).toBe(false);
    expect(serviceScope.needsHinterlandDirection(null)).toBe(false);
  });

  test("two active services on one card and one flow collide; a flowless or archived one never does", () => {
    const rows = [
      { service_type_id: "a", key: "SEA_FREIGHT_IMPORT", territory: "INTERNATIONAL_IMPORT" },
      { service_type_id: "b", key: "SEA_LCL_IMPORT", territory: "INTERNATIONAL_IMPORT" },
      { service_type_id: "c", key: "SEA_FREIGHT_EXPORT", territory: "INTERNATIONAL_EXPORT" },
      { service_type_id: "d", key: "CUSTOMS_BROKERAGE", territory: "PORT_AIRPORT_ZONE" },
      { service_type_id: "e", key: "CUSTOMS_ADVISORY", territory: "PORT_AIRPORT_ZONE" },
      { service_type_id: "f", key: "SEA_OLD_IMPORT", territory: "INTERNATIONAL_IMPORT", is_active: false },
    ];
    expect(serviceScope.collisions(rows)).toEqual([{ mode: "SEA", flow: "IMPORT", ids: ["a", "b"] }]);
  });

  test("moving one service to another card resolves the clash", () => {
    const rows = [
      { service_type_id: "a", key: "SEA_FREIGHT_IMPORT", territory: "INTERNATIONAL_IMPORT" },
      { service_type_id: "b", key: "SEA_LCL_IMPORT", territory: "INTERNATIONAL_IMPORT", transport_mode: "AIR" },
    ];
    expect(serviceScope.collisions(rows)).toEqual([]);
  });

  test("the fifteen seeded service types land on distinct places — a fresh tenant starts with no clash", () => {
    const seeded = seededServiceTypes();
    expect(seeded).toHaveLength(15);
    expect(serviceScope.collisions(seeded)).toEqual([]);
    const cards = new Set(seeded.map((r) => serviceScope.modeOf(r)));
    for (const c of serviceScope.CARD_ORDER) expect(cards.has(c)).toBe(true);
  });
});

describe("email domains — never suggest a client from public webmail", () => {
  test.each([
    ["ops@tema-shipping.com", "tema-shipping.com"],
    ["  Ops@Tema-Shipping.COM ", "tema-shipping.com"],
    ["someone@gmail.com", null],
    ["someone@yahoo.fr", null],
    ["not-an-address", null],
    [null, null],
  ])("companyDomainOf(%s) is %s", (email, domain) => {
    expect(emailDomain.companyDomainOf(email)).toBe(domain);
  });
});

describe("the shared quote-request rules", () => {
  test("a converted or closed request cannot be re-linked to another client", () => {
    expect(quoteRequest.canRelink("RECEIVED")).toBe(true);
    expect(quoteRequest.canRelink("UNDER_REVIEW")).toBe(true);
    expect(quoteRequest.canRelink("CONVERTED_TO_OPPORTUNITY")).toBe(false);
    expect(quoteRequest.canRelink("CLOSED_NO_ACTION")).toBe(false);
  });

  test("the desk must name an Incoterm — TBD is a valid answer", () => {
    const base = { requester_name: "Ada", service_type_id: "6b0a1f2e-1c1d-4b8e-9d55-0a0b0c0d0e0f" };
    expect(quoteRequest.staffCreate.safeParse(base).success).toBe(false);
    const tbd = quoteRequest.staffCreate.safeParse({ ...base, incoterm: "tbd" });
    expect(tbd.success).toBe(true);
    expect(tbd.data.incoterm).toBe("TBD");
  });

  test("the portal requires at least one document and a service type", () => {
    const docs = [{ doc_id: "6b0a1f2e-1c1d-4b8e-9d55-0a0b0c0d0e0f", document_kind: "COMMERCIAL_INVOICE" }];
    const base = {
      service_type_id: "6b0a1f2e-1c1d-4b8e-9d55-0a0b0c0d0e0f",
      cargo_description: "Two pallets of spare parts",
      incoterm: "TBD",
    };
    expect(quoteRequest.portalCreate.safeParse({ ...base, documents: [] }).success).toBe(false);
    expect(quoteRequest.portalCreate.safeParse({ ...base, documents: docs }).success).toBe(true);
    expect(quoteRequest.portalCreate.safeParse({ ...base, service_type_id: undefined, documents: docs }).success).toBe(false);
  });

  test("the intake channels include the portal and email", () => {
    expect(quoteRequest.INTAKE_CHANNELS).toEqual(expect.arrayContaining(["WEBSITE", "PORTAL", "EMAIL", "MANUAL"]));
  });
});
