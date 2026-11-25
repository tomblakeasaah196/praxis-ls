"use strict";

/**
 * The quote engine (SmartLS website v2, PR 3): from a website service and what
 * a visitor answers, to exactly one ERP service type or to desk review.
 *
 * The owner's bar was "a very, very solid engine". So beyond the named cases,
 * this file walks EVERY answer the questions allow for every website service a
 * tenant can build from the system service types, and then every combination
 * of the raw vocabulary (including the ones the form never offers), and holds
 * each outcome to the same invariants:
 *
 *   - exactly one outcome: RESOLVED naming one of the service's own members,
 *     or DESK with a known reason and no type;
 *   - the Incoterm is one the service quotes for its mode (never FOB by air),
 *     or TBD, or N/A;
 *   - the work decides the type: door to door is end to end wherever the
 *     service has an end-to-end member;
 *   - the two paths agree: plain answers that describe the same work as a
 *     picked term land on the same type.
 */

const fs = require("fs");
const path = require("path");
const { serviceScope, incoterms } = require("@praxis/shared");
const engine = require("../../packages/shared/rules/quote-engine");

const MIGRATION = fs.readFileSync(
  path.join(__dirname, "../../migrations/tenant/14640_website_services_and_quote_routing.sql"),
  "utf8",
);

/* ── fixtures: ERP types exactly as a fresh tenant has them ─────────────── */

/** The fifteen system service types of seed 9080 (and 11743), by key and territory. */
const SYSTEM_TYPES = {
  SEA_FREIGHT_IMPORT: ["Sea Freight Import", "INTERNATIONAL_IMPORT"],
  SEA_FREIGHT_EXPORT: ["Sea Freight Export", "INTERNATIONAL_EXPORT"],
  AIR_FREIGHT_IMPORT: ["Air Freight Import", "INTERNATIONAL_IMPORT"],
  AIR_FREIGHT_EXPORT: ["Air Freight Export", "INTERNATIONAL_EXPORT"],
  HINTERLAND_TRANSIT: ["Hinterland Transit", "TRANSIT_HINTERLAND"],
  INLAND_TRANSPORTATION: ["Inland Transportation", "DOMESTIC_INLAND"],
  WAREHOUSING: ["Warehousing", "DOMESTIC_INLAND"],
  END_TO_END_AIR_FREIGHT: ["End-to-End Air Freight", "END_TO_END_INTERNATIONAL"],
  END_TO_END_SEA_FREIGHT: ["End-to-End Sea Freight", "END_TO_END_INTERNATIONAL"],
  BUSINESS_REPRESENTATION: ["Business Representation", "DOMESTIC_INLAND"],
  CUSTOMS_BROKERAGE: ["Customs Brokerage", "PORT_AIRPORT_ZONE"],
  PROJECT_CARGO: ["Project & Break-bulk", "END_TO_END_INTERNATIONAL"],
  RAIL_TRANSPORTATION: ["Rail Transportation", "DOMESTIC_INLAND"],
  RAIL_HINTERLAND_TRANSIT: ["Rail Hinterland Transit", "TRANSIT_HINTERLAND"],
  END_TO_END_RAIL_FREIGHT: ["End-to-End Rail Freight", "END_TO_END_INTERNATIONAL"],
  // Created in Master Data for the Europe family (not in any migration).
  EXPORT_CONSOLIDATION_AFRICA: ["Export Consolidation to Africa", "INTERNATIONAL_EXPORT"],
  SOURCING_SUPPLIER_COORDINATION: ["Sourcing and Supplier Coordination", "OTHER"],
  EUROPEAN_ROAD_FREIGHT: ["European Road Freight", "CROSS_BORDER"],
  EU_IMPORT_CLEARANCE: ["EU Import Clearance", "PORT_AIRPORT_ZONE"],
};

/** A member as the API sends it: card and flow read the way the product reads them. */
function member(key, overrides = {}) {
  const [name, territory] = SYSTEM_TYPES[key];
  const row = { key, territory };
  const card = overrides.card || serviceScope.modeOf(row);
  return {
    id: key,
    key,
    name,
    card,
    flow: serviceScope.flowOf(territory),
    incoterms: incoterms.defaultsForMode(card),
    ...overrides,
  };
}

/** A website service: the anchor's card, the anchor and its members. */
function website(id, keys, overrides = {}) {
  const members = keys.map((k) => (typeof k === "string" ? member(k) : k));
  return { id, card: members[0] ? members[0].card : "OTHER", members, ...overrides };
}

const SERVICES = {
  sea: website("sea", ["SEA_FREIGHT_IMPORT", "SEA_FREIGHT_EXPORT", "END_TO_END_SEA_FREIGHT"]),
  air: website("air", ["AIR_FREIGHT_EXPORT", "AIR_FREIGHT_IMPORT", "END_TO_END_AIR_FREIGHT"]),
  project: website("project", ["PROJECT_CARGO"]),
  hinterland: website("hinterland", ["HINTERLAND_TRANSIT"]),
  road: website("road", ["INLAND_TRANSPORTATION"]),
  rail: website("rail", ["RAIL_TRANSPORTATION"]),
  warehousing: website("warehousing", ["WAREHOUSING"]),
  customs: website("customs", ["CUSTOMS_BROKERAGE"]),
  representation: website("representation", ["BUSINESS_REPRESENTATION"]),
  consolidation: website("consolidation", [member("EXPORT_CONSOLIDATION_AFRICA", { card: "SEA", incoterms: incoterms.defaultsForMode("SEA") })]),
  sourcing: website("sourcing", ["SOURCING_SUPPLIER_COORDINATION"]),
  euroad: website("euroad", ["EUROPEAN_ROAD_FREIGHT"]),
  euclearance: website("euclearance", [member("EU_IMPORT_CLEARANCE", { card: "CUSTOMS", incoterms: incoterms.defaultsForMode("CUSTOMS") })]),
  // Configurations a tenant can reach that the engine must still answer.
  hinterlandBoth: website("hinterlandBoth", ["HINTERLAND_TRANSIT", "RAIL_HINTERLAND_TRANSIT"]),
  airNoE2E: website("airNoE2E", ["AIR_FREIGHT_IMPORT", "AIR_FREIGHT_EXPORT"]),
  seaImportOnly: website("seaImportOnly", ["SEA_FREIGHT_IMPORT"]),
  railE2E: website("railE2E", ["END_TO_END_RAIL_FREIGHT", "RAIL_TRANSPORTATION"]),
  seaTwoImports: website("seaTwoImports", [
    "SEA_FREIGHT_IMPORT",
    member("SEA_FREIGHT_EXPORT", { id: "SEA_IMPORT_LCL", name: "Sea Freight Import LCL", flow: "IMPORT" }),
    "SEA_FREIGHT_EXPORT",
    "END_TO_END_SEA_FREIGHT",
  ]),
  seaNarrowTerms: website("seaNarrowTerms", [
    member("SEA_FREIGHT_IMPORT", { incoterms: ["FOB", "CFR", "CIF"] }),
    member("SEA_FREIGHT_EXPORT", { incoterms: ["FOB", "CIF"] }),
    member("END_TO_END_SEA_FREIGHT", { incoterms: ["EXW", "DAP", "DDP"] }),
  ]),
  empty: { id: "empty", card: "SEA", members: [] },
};

const run = (service, answers, rules) => engine.evaluate(service, answers, rules);
const memberIds = (service) => new Set((service.members || []).map((m) => String(m.id)));

/* ── the vocabulary holds to the product's ──────────────────────────────── */

describe("quote engine vocabulary", () => {
  test("its Incoterm codes are data/incoterms.js, in ICC order, with the same four sea-only rules", () => {
    expect(engine.INCOTERM_CODES).toEqual(incoterms.CODES);
    expect(engine.SEA_ONLY_CODES).toEqual(incoterms.SEA_ONLY);
    expect(engine.TERM_TBD).toBe(incoterms.NOT_SURE);
    expect(engine.TERM_NONE).toBe(incoterms.NOT_APPLICABLE);
  });

  test("its sea-capable cards are the cards data/incoterms.js gives the four sea-only rules", () => {
    for (const card of serviceScope.MODES) {
      const allowsSea = incoterms.defaultsForMode(card).includes("FOB");
      if (card === "STORAGE") continue; // storage quotes no term at all
      expect([card, engine.SEA_TERM_CARDS.includes(card)]).toEqual([card, allowsSea]);
    }
  });

  test("for every term, the buyer's share and the seller's share are the whole journey, with no overlap", () => {
    for (const code of engine.INCOTERM_CODES) {
      const b = engine.BUYER_SHARE[code];
      const s = engine.SELLER_SHARE[code];
      expect(new Set([...b, ...s]).size).toBe(engine.SCOPE_FLAGS.length);
      expect(b.filter((f) => s.includes(f))).toEqual([]);
    }
  });

  test("the module requires nothing (the website reaches it by deep path)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../packages/shared/rules/quote-engine.js"), "utf8");
    expect(src).not.toMatch(/\brequire\s*\(/);
  });

  test("no sentence a visitor reads carries an em dash or a double dash", () => {
    const sentences = [];
    for (const side of Object.values(engine.EXPLAIN)) for (const t of Object.values(side)) sentences.push(t.en, t.fr);
    sentences.push(engine.EXPLAIN_TBD.en, engine.EXPLAIN_TBD.fr);
    for (const l of Object.values(engine.SCOPE_LABELS)) sentences.push(l.en, l.fr);
    for (const s of sentences) {
      expect(s).not.toMatch(/—|–|--/);
    }
  });

  test("every explanation names the term it explains", () => {
    for (const side of Object.values(engine.EXPLAIN)) {
      for (const [code, t] of Object.entries(side)) {
        expect(t.en.startsWith(`This is ${code}:`)).toBe(true);
        expect(t.fr).toContain(code);
      }
    }
  });
});

/* ── the routing rules ──────────────────────────────────────────────────── */

describe("routing rules", () => {
  test("the defaults are valid and cover all twelve cells", () => {
    expect(engine.validateRules(engine.DEFAULT_RULES)).toEqual([]);
    expect(engine.DEFAULT_RULES).toHaveLength(12);
  });

  test("migration 14640 seeds exactly the engine's DEFAULT_RULES", () => {
    const rows = [];
    const re = /\(NULL,\s*'([A-Z]+)',\s*'([A-Z]+)',\s*'([A-Z_]+)'\)/g;
    let m;
    while ((m = re.exec(MIGRATION))) rows.push({ direction: m[1], span: m[2], outcome: m[3] });
    expect(rows).toEqual(engine.DEFAULT_RULES.map(({ direction, span, outcome }) => ({ direction, span, outcome })));
  });

  test("the migration's CHECKs carry the engine's vocabulary", () => {
    for (const span of engine.SPANS) expect(MIGRATION).toContain(`'${span}'`);
    for (const o of engine.OUTCOMES) expect(MIGRATION).toContain(`'${o}'`);
  });

  test("validateRules refuses every broken shape and names the gap", () => {
    const bad = [
      ...engine.DEFAULT_RULES.slice(1),
      { website_service_id: null, direction: "IMPORT", span: "M", outcome: "IMPORT" },
      { website_service_id: null, direction: "EXPORT", span: "O", outcome: "IMPORT" },
      { website_service_id: null, direction: "IMPORT", span: "D", outcome: "EXPORT" },
      { website_service_id: null, direction: "SIDEWAYS", span: "Q", outcome: "SOMEWHERE" },
      { website_service_id: null, direction: "IMPORT", span: "O", outcome: "TYPE", service_type_id: "x" },
      { website_service_id: "sea", direction: "IMPORT", span: "O", outcome: "TYPE" },
    ];
    const issues = engine.validateRules(bad);
    const messages = issues.map((i) => i.message).join("\n");
    expect(messages).toMatch(/already has a rule/);
    expect(messages).toMatch(/exporting cell cannot route to an import/);
    expect(messages).toMatch(/importing cell cannot route to an export/);
    expect(messages).toMatch(/must be IMPORT or EXPORT/);
    expect(messages).toMatch(/belongs to one website service/);
    expect(messages).toMatch(/required when the outcome names a service type/);
    expect(messages).toMatch(/no generic rule for IMPORT O/);
  });

  test("a website service's own rule wins over the generic one, and may name a member or the desk", () => {
    const sea = SERVICES.sea;
    const asks = { direction: "IMPORT", knows: "YES", incoterm: "CIF" }; // span D
    expect(run(sea, asks).service_type_id).toBe("SEA_FREIGHT_IMPORT");
    const named = [...engine.DEFAULT_RULES, { website_service_id: "sea", direction: "IMPORT", span: "D", outcome: "TYPE", service_type_id: "END_TO_END_SEA_FREIGHT" }];
    expect(run(sea, asks, named).service_type_id).toBe("END_TO_END_SEA_FREIGHT");
    const desk = [...engine.DEFAULT_RULES, { website_service_id: "sea", direction: "IMPORT", span: "D", outcome: "DESK" }];
    expect(run(sea, asks, desk)).toMatchObject({ outcome: "DESK", reason: "RULE_DESK", service_type_id: null });
    // Another service's rule does not leak.
    const other = [...engine.DEFAULT_RULES, { website_service_id: "air", direction: "IMPORT", span: "D", outcome: "DESK" }];
    expect(run(sea, asks, other).service_type_id).toBe("SEA_FREIGHT_IMPORT");
    // A rule naming a type that is not a member is the desk, never that type.
    const foreign = [...engine.DEFAULT_RULES, { website_service_id: "sea", direction: "IMPORT", span: "D", outcome: "TYPE", service_type_id: "AIR_FREIGHT_IMPORT" }];
    expect(run(sea, asks, foreign)).toMatchObject({ outcome: "DESK", reason: "NO_MEMBER" });
  });

  test("with no rules at all, routed work goes to the desk rather than anywhere", () => {
    const r = run(SERVICES.sea, { direction: "IMPORT", knows: "YES", incoterm: "FOB" }, []);
    expect(r).toMatchObject({ outcome: "DESK", reason: "NO_RULE", incoterm: "FOB", service_type_id: null });
  });
});

/* ── the cases the owner named ──────────────────────────────────────────── */

describe("named cases", () => {
  const sea = SERVICES.sea;

  test("Sea Freight, importing, DDP: End-to-End Sea Freight", () => {
    const r = run(sea, { direction: "IMPORT", knows: "YES", incoterm: "DDP" });
    expect(r).toMatchObject({ outcome: "RESOLVED", service_type_id: "END_TO_END_SEA_FREIGHT", incoterm: "DDP", incoterm_source: "PICKED", span: "OMD" });
  });

  test("Sea Freight, importing, EXW: End-to-End Sea Freight", () => {
    const r = run(sea, { direction: "IMPORT", knows: "YES", incoterm: "EXW" });
    expect(r).toMatchObject({ outcome: "RESOLVED", service_type_id: "END_TO_END_SEA_FREIGHT", incoterm: "EXW", span: "OMD" });
    expect(r.scope).toEqual({ origin_pickup: true, export_clearance: true, main_carriage: true, import_clearance: true, duties_taxes: true, final_delivery: true });
  });

  test("Sea Freight, importing, CIF: Sea Freight Import, because the seller paid the voyage", () => {
    const r = run(sea, { direction: "IMPORT", knows: "YES", incoterm: "CIF" });
    expect(r).toMatchObject({ outcome: "RESOLVED", service_type_id: "SEA_FREIGHT_IMPORT", incoterm: "CIF", span: "D" });
    expect(r.scope.main_carriage).toBe(false);
    expect(r.explanation.en).toBe("This is CIF: your supplier pays and insures the voyage to the port of arrival, and we take over when the vessel berths.");
  });

  test("Sea Freight, importing, not sure of the term, buying from the supplier's premises to my premises: EXW, end to end", () => {
    const r = run(sea, { direction: "IMPORT", knows: "NO", party: "BUYER", start: "SUPPLIER_PREMISES", end: "PREMISES" });
    expect(r).toMatchObject({ outcome: "RESOLVED", service_type_id: "END_TO_END_SEA_FREIGHT", incoterm: "EXW", incoterm_source: "DERIVED" });
    expect(r.explanation.en).toBe("This is EXW: your supplier makes the goods ready at their premises, and we collect them there.");
    expect(r.scope.duties_taxes).toBe(false); // "my premises", not "duties paid"
    expect(r.scope.import_clearance).toBe(true);
  });

  test("Air Freight, exporting, CIP: Air Freight Export", () => {
    const r = run(SERVICES.air, { direction: "EXPORT", knows: "YES", incoterm: "CIP" });
    expect(r).toMatchObject({ outcome: "RESOLVED", service_type_id: "AIR_FREIGHT_EXPORT", incoterm: "CIP", span: "OM" });
  });

  test("Hinterland Transit resolves to the hinterland service and records which way", () => {
    const into = run(SERVICES.hinterland, { direction: "IMPORT", knows: "YES", incoterm: "CPT" });
    expect(into).toMatchObject({ outcome: "RESOLVED", service_type_id: "HINTERLAND_TRANSIT", hinterland_direction: "INTO" });
    const out = run(SERVICES.hinterland, { direction: "EXPORT", knows: "NO", party: "SELLER", start: "SUPPLIER_PREMISES", end: "ORIGIN_PORT" });
    expect(out).toMatchObject({ outcome: "RESOLVED", service_type_id: "HINTERLAND_TRANSIT", hinterland_direction: "OUT_OF", incoterm: "FCA" });
    const unsure = run(SERVICES.hinterland, { direction: "IMPORT", knows: "YES", incoterm: "NOT_SURE" });
    expect(unsure).toMatchObject({ outcome: "RESOLVED", service_type_id: "HINTERLAND_TRANSIT", incoterm: "TBD", incoterm_source: "NOT_SURE" });
  });

  test("Air Freight never offers or derives a sea-only term", () => {
    const r = run(SERVICES.air, { direction: "IMPORT", knows: "YES" });
    const step = r.steps.find((s) => s.id === "incoterm");
    expect(step.options).toEqual(["EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP"]);
    expect(run(SERVICES.air, { direction: "IMPORT", knows: "YES", incoterm: "FOB" })).toMatchObject({ outcome: "DESK", reason: "INVALID" });
    expect(run(SERVICES.air, { direction: "IMPORT", knows: "NO", party: "BUYER", start: "ORIGIN_PORT", end: "PREMISES" }).incoterm).toBe("FCA");
    expect(run(SERVICES.sea, { direction: "IMPORT", knows: "NO", party: "BUYER", start: "ORIGIN_PORT", end: "PREMISES" }).incoterm).toBe("FOB");
  });

  test("a C term asks who insures, and an unknown insurer still routes on the known work", () => {
    const base = { direction: "IMPORT", knows: "NO", party: "BUYER", start: "DESTINATION_PORT", end: "PREMISES_DUTY_PAID" };
    expect(run(sea, base).next).toBe("insured");
    expect(run(sea, { ...base, insured: "YES" }).incoterm).toBe("CIF");
    expect(run(sea, { ...base, insured: "NO" }).incoterm).toBe("CFR");
    const unknown = run(sea, { ...base, insured: "NOT_SURE" });
    expect(unknown).toMatchObject({ outcome: "RESOLVED", service_type_id: "SEA_FREIGHT_IMPORT", incoterm: "TBD", incoterm_source: "NOT_SURE" });
    expect(unknown.explanation.en).toMatch(/^This is CFR or CIF:/);
    expect(run(SERVICES.air, { ...base, insured: "YES" }).incoterm).toBe("CIP");
  });

  test("a seller's term is where their work ends", () => {
    const seller = (end, insured) => run(sea, { direction: "EXPORT", knows: "NO", party: "SELLER", start: "SUPPLIER_PREMISES", end, insured }).incoterm;
    expect(seller("ORIGIN_PORT")).toBe("FOB");
    expect(seller("DESTINATION_PORT", "YES")).toBe("CIF");
    expect(seller("DESTINATION_PORT", "NO")).toBe("CFR");
    expect(seller("PREMISES")).toBe("DAP");
    expect(seller("PREMISES_DUTY_PAID")).toBe("DDP");
  });

  test("not sure where the type depends on it goes to the desk, with the term to be determined", () => {
    for (const answers of [
      { direction: "NOT_SURE" },
      { direction: "IMPORT", knows: "YES", incoterm: "NOT_SURE" },
      { direction: "IMPORT", knows: "NO", party: "NOT_SURE" },
      { direction: "EXPORT", knows: "NO", party: "SELLER", start: "NOT_SURE" },
      { direction: "EXPORT", knows: "NO", party: "SELLER", start: "ORIGIN_PORT", end: "NOT_SURE" },
    ]) {
      expect(run(sea, answers)).toMatchObject({ complete: true, outcome: "DESK", reason: "NOT_SURE", incoterm: "TBD", service_type_id: null });
    }
  });

  test("only ends after the start are offered, and a seller never starts at the port of arrival", () => {
    const ends = (party, start) => run(sea, { direction: "IMPORT", knows: "NO", party, start }).steps.find((s) => s.id === "end").options;
    expect(ends("BUYER", "SUPPLIER_PREMISES")).toEqual(["ORIGIN_PORT", "DESTINATION_PORT", "PREMISES", "PREMISES_DUTY_PAID"]);
    expect(ends("BUYER", "ORIGIN_PORT")).toEqual(["DESTINATION_PORT", "PREMISES", "PREMISES_DUTY_PAID"]);
    expect(ends("BUYER", "DESTINATION_PORT")).toEqual(["PREMISES", "PREMISES_DUTY_PAID"]);
    const starts = run(sea, { direction: "EXPORT", knows: "NO", party: "SELLER" }).steps.find((s) => s.id === "start").options;
    expect(starts).toEqual(["SUPPLIER_PREMISES", "ORIGIN_PORT"]);
    expect(run(sea, { direction: "EXPORT", knows: "NO", party: "SELLER", start: "DESTINATION_PORT", end: "PREMISES" }))
      .toMatchObject({ outcome: "DESK", reason: "INVALID" });
  });

  test("a single-direction service does not ask the direction", () => {
    const r = run(SERVICES.consolidation, {});
    expect(r.steps.map((s) => s.id)).toEqual(["knows"]);
    expect(run(SERVICES.consolidation, { knows: "YES", incoterm: "FCA" })).toMatchObject({ direction: "EXPORT", service_type_id: "EXPORT_CONSOLIDATION_AFRICA" });
  });

  test("services with no journey ask nothing and quote no term", () => {
    for (const key of ["road", "rail", "warehousing", "representation", "sourcing", "euroad"]) {
      const r = run(SERVICES[key], {});
      expect(r).toMatchObject({ complete: true, outcome: "RESOLVED", incoterm: "N/A", incoterm_source: "NOT_APPLICABLE", scope: null });
      expect(r.steps).toEqual([]);
    }
  });

  test("customs asks the direction and the term but never derives one", () => {
    expect(run(SERVICES.customs, { direction: "IMPORT", knows: "NO" })).toMatchObject({ outcome: "RESOLVED", service_type_id: "CUSTOMS_BROKERAGE", incoterm: "TBD", scope: { import_clearance: true, main_carriage: false } });
    expect(run(SERVICES.customs, { direction: "EXPORT", knows: "YES", incoterm: "FOB" })).toMatchObject({ outcome: "RESOLVED", incoterm: "FOB", scope: { export_clearance: true } });
  });

  test("two members on one flow are offered by name", () => {
    const r = run(SERVICES.seaTwoImports, { direction: "IMPORT", knows: "YES", incoterm: "FOB" });
    expect(r.next).toBe("member");
    expect(r.steps.at(-1).options.map((o) => o.id)).toEqual(["SEA_FREIGHT_IMPORT", "SEA_IMPORT_LCL"]);
    expect(run(SERVICES.seaTwoImports, { direction: "IMPORT", knows: "YES", incoterm: "FOB", member: "SEA_IMPORT_LCL" }).service_type_id).toBe("SEA_IMPORT_LCL");
    expect(run(SERVICES.seaTwoImports, { direction: "IMPORT", knows: "YES", incoterm: "FOB", member: "SEA_FREIGHT_EXPORT" })).toMatchObject({ outcome: "DESK", reason: "INVALID" });
  });

  test("door to door without an end-to-end member falls back to the direction's own service", () => {
    expect(run(SERVICES.airNoE2E, { direction: "IMPORT", knows: "YES", incoterm: "EXW" }).service_type_id).toBe("AIR_FREIGHT_IMPORT");
    expect(run(SERVICES.airNoE2E, { direction: "EXPORT", knows: "YES", incoterm: "DDP" }).service_type_id).toBe("AIR_FREIGHT_EXPORT");
  });

  test("a term the resolved service does not quote goes to the desk", () => {
    const r = run(SERVICES.seaNarrowTerms, { direction: "EXPORT", knows: "YES", incoterm: "CFR" });
    expect(r).toMatchObject({ outcome: "DESK", reason: "TERM_NOT_OFFERED", incoterm: "CFR" });
    // The picker never offers a term no member quotes.
    expect(run(SERVICES.seaNarrowTerms, { direction: "EXPORT", knows: "YES" }).steps.at(-1).options).toEqual(["EXW", "FOB", "CFR", "CIF", "DAP", "DDP"]);
  });

  test("a website service with no members goes to the desk on every path", () => {
    expect(run(SERVICES.empty, {})).toMatchObject({ complete: true, outcome: "DESK", reason: "NO_MEMBER" });
  });

  test("validateService names what a tenant must fix", () => {
    expect(engine.validateService(SERVICES.empty).map((w) => w.code)).toContain("NO_MEMBERS");
    expect(engine.validateService(SERVICES.railE2E).map((w) => w.code)).toContain("UNREACHABLE");
    expect(engine.validateService(SERVICES.seaTwoImports).map((w) => w.code)).toContain("SAME_FLOW");
    expect(engine.validateService(SERVICES.sea)).toEqual([]);
  });
});

/* ── exhaustive ─────────────────────────────────────────────────────────── */

/** The invariants every complete evaluation must hold. */
function holds(service, answers, r) {
  const where = `${service.id} ${JSON.stringify(answers)}`;
  const fail = (msg) => {
    throw new Error(`${where}: ${msg}\n${JSON.stringify({ outcome: r.outcome, reason: r.reason, type: r.service_type_id, incoterm: r.incoterm, span: r.span })}`);
  };
  if (!r.complete) fail("did not complete");
  if (r.outcome === "RESOLVED") {
    if (!r.service_type_id || !memberIds(service).has(r.service_type_id)) fail("resolved to a type that is not a member");
    if (r.reason !== null) fail("resolved with a desk reason");
  } else if (r.outcome === "DESK") {
    if (r.service_type_id !== null) fail("desk review carries a type");
    if (!engine.DESK_REASONS.includes(r.reason)) fail(`unknown desk reason ${r.reason}`);
  } else {
    fail("no outcome");
  }
  const offered = engine.incotermsOf(service);
  if (![engine.TERM_TBD, engine.TERM_NONE].includes(r.incoterm)) {
    if (!engine.INCOTERM_CODES.includes(r.incoterm)) fail(`not an Incoterm: ${r.incoterm}`);
    if (!offered.includes(r.incoterm) && r.reason !== "TERM_NOT_OFFERED") fail(`term not offered: ${r.incoterm}`);
    if (engine.SEA_ONLY_CODES.includes(r.incoterm) && !engine.SEA_TERM_CARDS.includes(service.card)) fail("sea-only term on a non-sea service");
    if (!["PICKED", "DERIVED"].includes(r.incoterm_source)) fail("a real term must be picked or derived");
  } else if (r.incoterm === engine.TERM_NONE && r.incoterm_source !== "NOT_APPLICABLE") {
    fail("N/A must be not applicable");
  } else if (r.incoterm === engine.TERM_TBD && r.incoterm_source !== "NOT_SURE") {
    fail("TBD must be not sure");
  }
  if (r.scope) {
    if (Object.keys(r.scope).sort().join() !== [...engine.SCOPE_FLAGS].sort().join()) fail("scope is not the six flags");
    if (r.span !== engine.spanOf(r.scope)) fail("span does not match the scope");
  }
  if (r.outcome === "RESOLVED" && r.span === "OMD") {
    const e2e = service.members.find((m) => m.flow === "END_TO_END");
    if (e2e && r.service_type_id !== String(e2e.id)) fail("door to door did not land on the end-to-end member");
  }
  if (r.outcome === "RESOLVED" && r.direction) {
    const flow = service.members.find((m) => String(m.id) === r.service_type_id).flow;
    if (["IMPORT", "EXPORT"].includes(flow) && flow !== r.direction) fail(`an ${r.direction} request landed on an ${flow} service`);
  }
  if (r.explanation && (typeof r.explanation.en !== "string" || typeof r.explanation.fr !== "string")) fail("explanation is not bilingual");
  if (r.issues.length && r.reason !== "INVALID") fail("issues without INVALID");
}

describe("exhaustive: every answer the questions allow, for every website service", () => {
  for (const service of Object.values(SERVICES)) {
    test(`${service.id}: each path ends in exactly one type or the desk`, () => {
      const paths = engine.enumerate(service);
      expect(paths.length).toBeGreaterThan(0);
      for (const { answers, result } of paths) {
        holds(service, answers, result);
        expect(result.issues).toEqual([]);
        // Deterministic, and the normalised answers replay to the same result.
        const again = run(service, result.answers);
        expect([again.outcome, again.service_type_id, again.incoterm, again.span]).toEqual([result.outcome, result.service_type_id, result.incoterm, result.span]);
      }
    });
  }

  test("the paths a fresh sea service offers, counted", () => {
    // 2 directions x (YES: 11 terms + not sure; NO: the plain tree) + direction not sure.
    const paths = engine.enumerate(SERVICES.sea);
    const outcomes = paths.reduce((acc, p) => ({ ...acc, [p.result.service_type_id || "DESK"]: (acc[p.result.service_type_id || "DESK"] || 0) + 1 }), {});
    expect(Object.keys(outcomes).sort()).toEqual(["DESK", "END_TO_END_SEA_FREIGHT", "SEA_FREIGHT_EXPORT", "SEA_FREIGHT_IMPORT"]);
  });
});

describe("exhaustive: every combination of the raw vocabulary", () => {
  const V = (list) => [undefined, "NOT_SURE", "NONSENSE", ...list];
  const DIM = {
    direction: V(engine.DIRECTIONS),
    knows: V(engine.KNOWS),
    incoterm: V(engine.INCOTERM_CODES),
    party: V(engine.PARTIES),
    start: V(engine.STARTS),
    end: V(engine.ENDS),
    insured: V(engine.INSURED),
  };

  function* combos() {
    for (const direction of DIM.direction)
      for (const knows of DIM.knows)
        for (const incoterm of knows === "YES" ? DIM.incoterm : [undefined, "FOB"])
          for (const party of knows === "NO" ? DIM.party : [undefined])
            for (const start of knows === "NO" ? DIM.start : [undefined])
              for (const end of knows === "NO" ? DIM.end : [undefined])
                for (const insured of knows === "NO" ? DIM.insured : [undefined])
                  yield { direction, knows, incoterm, party, start, end, insured };
  }

  for (const service of Object.values(SERVICES)) {
    test(`${service.id}: never throws, and every complete answer set has exactly one outcome`, () => {
      let complete = 0;
      for (const answers of combos()) {
        let r = run(service, answers);
        // A member pick is the last question; answer it with each choice in turn.
        if (r.next === "member") {
          for (const o of r.steps.at(-1).options) holds(service, answers, run(service, { ...answers, member: o.id }));
          r = run(service, { ...answers, member: r.steps.at(-1).options[0].id });
        }
        if (!r.complete) {
          // Incomplete only by leaving the next question unanswered.
          expect(answers[r.next]).toBeUndefined();
          continue;
        }
        complete += 1;
        holds(service, answers, r);
        if (Object.values(answers).includes("NONSENSE") && r.outcome === "DESK" && r.reason === "INVALID") {
          expect(r.issues.length).toBeGreaterThan(0);
        }
      }
      expect(complete).toBeGreaterThan(0);
    });
  }
});

describe("the two paths agree", () => {
  test("plain answers that describe a picked term's work land on the picked term's type", () => {
    let compared = 0;
    for (const service of [SERVICES.sea, SERVICES.air, SERVICES.project, SERVICES.hinterland, SERVICES.airNoE2E, SERVICES.consolidation]) {
      for (const { result } of engine.enumerate(service)) {
        if (result.incoterm_source !== "DERIVED" || result.outcome !== "RESOLVED") continue;
        const natural = result.direction === "EXPORT" ? "SELLER" : "BUYER";
        if (result.party !== natural) continue;
        const picked = engine.scopeForTerm(result.direction, result.incoterm);
        if (JSON.stringify(picked.scope) !== JSON.stringify(result.scope)) continue;
        const yes = run(service, { direction: result.direction, knows: "YES", incoterm: result.incoterm });
        expect([service.id, result.incoterm, yes.service_type_id]).toEqual([service.id, result.incoterm, result.service_type_id]);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(10);
  });

  test("a picked term reads the visitor's side unless it carries no transport", () => {
    expect(engine.scopeForTerm("IMPORT", "FOB")).toMatchObject({ visitor: "BUYER", job: "BUYER" });
    expect(engine.scopeForTerm("IMPORT", "DAP")).toMatchObject({ visitor: "BUYER", job: "SELLER" });
    expect(engine.scopeForTerm("IMPORT", "DDP")).toMatchObject({ visitor: "BUYER", job: "SELLER" });
    expect(engine.scopeForTerm("EXPORT", "EXW")).toMatchObject({ visitor: "SELLER", job: "BUYER" });
    expect(engine.scopeForTerm("EXPORT", "CIF")).toMatchObject({ visitor: "SELLER", job: "SELLER" });
  });
});
