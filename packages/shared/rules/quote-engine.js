"use strict";
/**
 * The quote engine: from what a visitor can answer to the exact service type
 * the desk quotes, with the Incoterm and the scope of work, and why.
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────
 *
 * The ERP keeps import, export and end to end as SEPARATE service types
 * (Sea Freight Import, Sea Freight Export, End-to-End Sea Freight), because the
 * operations file, the milestones, the charge dictionary, the numbering and the
 * quotation all hang off that choice. A visitor does not think in those types.
 * They think "I need sea freight", and they may or may not know their Incoterm.
 *
 * So the website offers WEBSITE SERVICES ("Sea Freight"), each standing over
 * one or more ERP service types (its MEMBERS), and this engine turns the
 * visitor's answers into exactly one member, or into "desk review" when the
 * answers do not decide it. The wizard runs it to draw the next question and
 * the plain-words result; the API runs it again on submit and stores what it
 * says. Nothing the browser sends about the outcome is trusted.
 *
 * ── THE QUESTIONS ───────────────────────────────────────────────────────────
 *
 *   direction   Importing or exporting. Asked only when the service runs both
 *               ways; implied when its members run one way only.
 *   knows       "Do you know your Incoterm?"
 *   incoterm    Yes: one of the Incoterms 2020 this service offers, filtered by
 *               mode (FAS, FOB, CFR and CIF are for sea and inland waterway
 *               only), or "not sure".
 *   party       No: "Are you buying or selling?"
 *   start       "Where should our work begin?" supplier's premises, port or
 *               airport of loading, port or airport of arrival.
 *   end         "Where should it end?" port or airport of loading, port or
 *               airport of arrival, the buyer's premises, the buyer's premises
 *               with duties paid. Only ends AFTER the start are offered.
 *   insured     Only when the answers point at a C term, because CFR and CIF
 *               (CPT and CIP) differ by one fact the other answers cannot
 *               carry: whether the seller insures the voyage.
 *   member      Only when two members are equally right (two services on the
 *               same flow): the visitor picks one by name.
 *
 * "Not sure" is accepted at every question. It removes exactly what it does
 * not know and nothing more: the type is still resolved when the remaining
 * answers decide it (a service with one member; a C term whose insurer is
 * unknown still has a known scope), and goes to the desk when they do not.
 *
 * ── HOW THE TYPE IS CHOSEN: BY THE WORK, NOT BY THE WORD ────────────────────
 *
 * The Incoterm and the plain answers are both turned into a SCOPE: six facts
 * about the work (collection at origin, export clearance, main carriage,
 * import clearance, duties and taxes, final delivery). The scope reduces to a
 * SPAN, which sides of the journey the work touches: O (origin), M (main
 * carriage), D (destination), or a run of them (OM, MD, OMD). The ROUTING
 * RULES map (direction, span) to a flow, and the flow picks the member:
 *
 *   OMD, either way                     END_TO_END  (door to door)
 *   importing, M / D / MD / OM          IMPORT
 *   exporting, O / M / OM / MD          EXPORT
 *   importing O, exporting D            desk review (the work is all on the
 *                                       far side of the visitor's own trade)
 *
 * The rules are DATA (`quote_route_rule`, seeded with `DEFAULT_RULES`, edited
 * in Master Data), and a website service may override any cell for itself,
 * including naming one member outright or sending a cell to the desk.
 *
 * Choosing by scope is what makes the two paths agree: a visitor who picks
 * EXW and one who answers "buying, from my supplier's premises to my premises"
 * describe the same work, and land on the same type.
 *
 * ── WHOSE SIDE A PICKED INCOTERM DESCRIBES ──────────────────────────────────
 *
 * A picked term says how a contract splits the journey; it does not say who is
 * asking. The visitor's own side is the natural reading (an importer is the
 * buyer, an exporter the seller). But when that side carries no transport at
 * all (importing on DAP, DPU or DDP; exporting on EXW) there is no freight to
 * quote on it, and a visitor who chose a FREIGHT service is asking about the
 * other side: the whole delivered journey. That is why importing on DDP or EXW
 * is end to end, and importing on CIF is the import service: the seller has
 * paid the voyage, so the work starts at the port of arrival.
 *
 * ── RULES FOR THIS FILE ─────────────────────────────────────────────────────
 *
 * It requires NOTHING. public-web reaches it by deep path
 * (`public-web/config/shared-deep.ts`) and a require here would pull its
 * target into the website bundle. The Incoterm codes are therefore restated
 * below, and tests/unit/quote-engine.test.js holds them to data/incoterms.js.
 * Named `exports.x =` assignments, for the bundlers' CommonJS lexer (see
 * packages/shared/index.js). No em dashes in any sentence: they reach a tenant.
 */

/* ── vocabulary ─────────────────────────────────────────────────────────── */

const NOT_SURE = "NOT_SURE";
/** What a request stores when the term is not known yet (data/incoterms.js NOT_SURE). */
const TERM_TBD = "TBD";
/** What a request stores when the service has no delivery term (data/incoterms.js NOT_APPLICABLE). */
const TERM_NONE = "N/A";

/** Incoterms 2020 in ICC order. The four sea-only rules are flagged. */
const INCOTERM_CODES = ["EXW", "FCA", "FAS", "FOB", "CPT", "CIP", "CFR", "CIF", "DAP", "DPU", "DDP"];
const SEA_ONLY_CODES = ["FAS", "FOB", "CFR", "CIF"];
const SEA_ONLY = new Set(SEA_ONLY_CODES);

/** The cards (service_type.transport_mode) whose services may use the sea-only rules. */
const SEA_TERM_CARDS = ["SEA", "CUSTOMS", "OTHER"];

const DIRECTIONS = ["IMPORT", "EXPORT"];
const KNOWS = ["YES", "NO"];
const PARTIES = ["BUYER", "SELLER"];
const INSURED = ["YES", "NO"];

/**
 * The points of a journey, in order. `rank` is what makes "only ends after the
 * start" a comparison. Both premises ends share rank 3: they are the same
 * place, and differ by whether the duties are paid on the way in.
 */
const POINTS = {
  SUPPLIER_PREMISES: 0,
  ORIGIN_PORT: 1,
  DESTINATION_PORT: 2,
  PREMISES: 3,
  PREMISES_DUTY_PAID: 3,
};
const STARTS = ["SUPPLIER_PREMISES", "ORIGIN_PORT", "DESTINATION_PORT"];
const ENDS = ["ORIGIN_PORT", "DESTINATION_PORT", "PREMISES", "PREMISES_DUTY_PAID"];
/** A seller's goods are not at the port of arrival before the work begins. */
const SELLER_STARTS = ["SUPPLIER_PREMISES", "ORIGIN_PORT"];

/** The six facts of a scope, in the order the journey meets them. */
const SCOPE_FLAGS = [
  "origin_pickup",
  "export_clearance",
  "main_carriage",
  "import_clearance",
  "duties_taxes",
  "final_delivery",
];

const SCOPE_LABELS = {
  origin_pickup: { en: "Collection at Origin", fr: "Enlèvement à l'origine" },
  export_clearance: { en: "Export Clearance", fr: "Dédouanement export" },
  main_carriage: { en: "Main Carriage", fr: "Transport principal" },
  import_clearance: { en: "Import Clearance", fr: "Dédouanement import" },
  duties_taxes: { en: "Duties and Taxes", fr: "Droits et taxes" },
  final_delivery: { en: "Final Delivery", fr: "Livraison finale" },
};

const SPANS = ["O", "M", "D", "OM", "MD", "OMD"];

/** What a routing rule may send a (direction, span) cell to. */
const OUTCOMES = ["END_TO_END", "IMPORT", "EXPORT", "DESK", "TYPE"];

/** The member flows the engine routes between (from service_type.territory). */
const ROUTED_FLOWS = ["IMPORT", "EXPORT", "END_TO_END", "HINTERLAND"];

/** Why a request went to the desk. */
const DESK_REASONS = [
  "NOT_SURE", // an answer the type depends on was "not sure"
  "RULE_DESK", // the routing rule for this work says desk review
  "NO_RULE", // no routing rule covers this work
  "NO_MEMBER", // the rule's flow has no member on this website service
  "TERM_NOT_OFFERED", // the derived term is not one the resolved service quotes
  "INVALID", // the answers contradict the questions (a stale or tampered form)
];

/**
 * The generic routing rules, seeded into every tenant by
 * migrations/seeds/9180_seed_quote_route_rules.sql (the test reads that file
 * and holds the two together). One row per (direction, span), all twelve.
 */
const DEFAULT_RULES = [
  { direction: "IMPORT", span: "O", outcome: "DESK" },
  { direction: "IMPORT", span: "M", outcome: "IMPORT" },
  { direction: "IMPORT", span: "D", outcome: "IMPORT" },
  { direction: "IMPORT", span: "OM", outcome: "IMPORT" },
  { direction: "IMPORT", span: "MD", outcome: "IMPORT" },
  { direction: "IMPORT", span: "OMD", outcome: "END_TO_END" },
  { direction: "EXPORT", span: "O", outcome: "EXPORT" },
  { direction: "EXPORT", span: "M", outcome: "EXPORT" },
  { direction: "EXPORT", span: "D", outcome: "DESK" },
  { direction: "EXPORT", span: "OM", outcome: "EXPORT" },
  { direction: "EXPORT", span: "MD", outcome: "EXPORT" },
  { direction: "EXPORT", span: "OMD", outcome: "END_TO_END" },
].map((r) => ({ website_service_id: null, service_type_id: null, ...r }));

/* ── what each side of a contract carries ───────────────────────────────── */

const ALL = SCOPE_FLAGS;
const DEST = ["import_clearance", "duties_taxes", "final_delivery"];

/** The buyer's share of the journey under each term (ICC 2020). */
const BUYER_SHARE = {
  EXW: ALL,
  FCA: ["main_carriage", ...DEST],
  FAS: ["main_carriage", ...DEST],
  FOB: ["main_carriage", ...DEST],
  CPT: DEST,
  CIP: DEST,
  CFR: DEST,
  CIF: DEST,
  DAP: ["import_clearance", "duties_taxes"],
  DPU: ["import_clearance", "duties_taxes"],
  DDP: [],
};

/** The seller's share of the journey under each term (ICC 2020). */
const SELLER_SHARE = {
  EXW: [],
  FCA: ["origin_pickup", "export_clearance"],
  FAS: ["origin_pickup", "export_clearance"],
  FOB: ["origin_pickup", "export_clearance"],
  CPT: ["origin_pickup", "export_clearance", "main_carriage"],
  CIP: ["origin_pickup", "export_clearance", "main_carriage"],
  CFR: ["origin_pickup", "export_clearance", "main_carriage"],
  CIF: ["origin_pickup", "export_clearance", "main_carriage"],
  DAP: ["origin_pickup", "export_clearance", "main_carriage", "final_delivery"],
  DPU: ["origin_pickup", "export_clearance", "main_carriage", "final_delivery"],
  DDP: ALL,
};

const C_TERMS = new Set(["CPT", "CIP", "CFR", "CIF"]);

/* ── the sentence a visitor reads, and the desk reads after them ────────── */

/**
 * One sentence per term, from the side the visitor is on. Held here rather
 * than in a dictionary because the desk must read the SAME sentence the visitor
 * was shown: it is stored on the request.
 */
const EXPLAIN = {
  BUYER: {
    EXW: {
      en: "This is EXW: your supplier makes the goods ready at their premises, and we collect them there.",
      fr: "C'est l'EXW : votre fournisseur met la marchandise à disposition dans ses locaux, et nous l'y enlevons.",
    },
    FCA: {
      en: "This is FCA: your supplier clears the goods for export and hands them over at the agreed place.",
      fr: "C'est le FCA : votre fournisseur dédouane la marchandise à l'export et la remet au lieu convenu.",
    },
    FAS: {
      en: "This is FAS: your supplier clears the goods for export and delivers them alongside the vessel.",
      fr: "C'est le FAS : votre fournisseur dédouane la marchandise à l'export et la livre le long du navire.",
    },
    FOB: {
      en: "This is FOB: your supplier clears the goods for export and loads them on board, and we take over from there.",
      fr: "C'est le FOB : votre fournisseur dédouane la marchandise à l'export et la charge à bord, et nous prenons le relais.",
    },
    CPT: {
      en: "This is CPT: your supplier pays the carriage to the place of arrival, and we take over from there.",
      fr: "C'est le CPT : votre fournisseur paie le transport jusqu'au lieu d'arrivée, et nous prenons le relais.",
    },
    CIP: {
      en: "This is CIP: your supplier pays and insures the carriage to the place of arrival, and we take over from there.",
      fr: "C'est le CIP : votre fournisseur paie et assure le transport jusqu'au lieu d'arrivée, et nous prenons le relais.",
    },
    CFR: {
      en: "This is CFR: your supplier pays the voyage to the port of arrival, and we take over when the vessel berths.",
      fr: "C'est le CFR : votre fournisseur paie le voyage jusqu'au port d'arrivée, et nous prenons le relais à l'accostage.",
    },
    CIF: {
      en: "This is CIF: your supplier pays and insures the voyage to the port of arrival, and we take over when the vessel berths.",
      fr: "C'est le CIF : votre fournisseur paie et assure le voyage jusqu'au port d'arrivée, et nous prenons le relais à l'accostage.",
    },
    DAP: {
      en: "This is DAP: your supplier delivers to your door, and import clearance and duties stay with you.",
      fr: "C'est le DAP : votre fournisseur livre à votre porte, et le dédouanement import et les droits restent à votre charge.",
    },
    DPU: {
      en: "This is DPU: your supplier delivers to your door and unloads, and import clearance and duties stay with you.",
      fr: "C'est le DPU : votre fournisseur livre à votre porte et décharge, et le dédouanement import et les droits restent à votre charge.",
    },
    DDP: {
      en: "This is DDP: your supplier delivers to your door with import duties paid.",
      fr: "C'est le DDP : votre fournisseur livre à votre porte, droits d'importation acquittés.",
    },
  },
  SELLER: {
    EXW: {
      en: "This is EXW: your buyer collects from your premises and arranges everything after that.",
      fr: "C'est l'EXW : votre acheteur enlève la marchandise dans vos locaux et organise toute la suite.",
    },
    FCA: {
      en: "This is FCA: you clear the goods for export and hand them to your buyer's carrier at the agreed place.",
      fr: "C'est le FCA : vous dédouanez la marchandise à l'export et la remettez au transporteur de votre acheteur au lieu convenu.",
    },
    FAS: {
      en: "This is FAS: you clear the goods for export and deliver them alongside the vessel.",
      fr: "C'est le FAS : vous dédouanez la marchandise à l'export et la livrez le long du navire.",
    },
    FOB: {
      en: "This is FOB: you clear the goods for export and load them on board, and your buyer pays the voyage.",
      fr: "C'est le FOB : vous dédouanez la marchandise à l'export et la chargez à bord, et votre acheteur paie le voyage.",
    },
    CPT: {
      en: "This is CPT: you pay the carriage to the place of arrival.",
      fr: "C'est le CPT : vous payez le transport jusqu'au lieu d'arrivée.",
    },
    CIP: {
      en: "This is CIP: you pay and insure the carriage to the place of arrival.",
      fr: "C'est le CIP : vous payez et assurez le transport jusqu'au lieu d'arrivée.",
    },
    CFR: {
      en: "This is CFR: you pay the voyage to your buyer's port of arrival.",
      fr: "C'est le CFR : vous payez le voyage jusqu'au port d'arrivée de votre acheteur.",
    },
    CIF: {
      en: "This is CIF: you pay and insure the voyage to your buyer's port of arrival.",
      fr: "C'est le CIF : vous payez et assurez le voyage jusqu'au port d'arrivée de votre acheteur.",
    },
    DAP: {
      en: "This is DAP: you deliver to your buyer's door, and your buyer clears the goods and pays the duties.",
      fr: "C'est le DAP : vous livrez à la porte de votre acheteur, qui dédouane la marchandise et paie les droits.",
    },
    DPU: {
      en: "This is DPU: you deliver to your buyer's door and unload, and your buyer clears the goods and pays the duties.",
      fr: "C'est le DPU : vous livrez à la porte de votre acheteur et déchargez, et votre acheteur dédouane et paie les droits.",
    },
    DDP: {
      en: "This is DDP: you deliver to your buyer's door with import duties paid.",
      fr: "C'est le DDP : vous livrez à la porte de votre acheteur, droits d'importation acquittés.",
    },
  },
};

/** A C term whose insurer is unknown: the pair is named and the scope still stands. */
const EXPLAIN_C_PAIR = {
  BUYER: {
    sea: {
      en: "This is CFR or CIF: your supplier pays the voyage to the port of arrival, and we will confirm with you who insures it.",
      fr: "C'est le CFR ou le CIF : votre fournisseur paie le voyage jusqu'au port d'arrivée, et nous confirmerons avec vous qui l'assure.",
    },
    any: {
      en: "This is CPT or CIP: your supplier pays the carriage to the place of arrival, and we will confirm with you who insures it.",
      fr: "C'est le CPT ou le CIP : votre fournisseur paie le transport jusqu'au lieu d'arrivée, et nous confirmerons avec vous qui l'assure.",
    },
  },
  SELLER: {
    sea: {
      en: "This is CFR or CIF: you pay the voyage to your buyer's port of arrival, and we will confirm with you who insures it.",
      fr: "C'est le CFR ou le CIF : vous payez le voyage jusqu'au port d'arrivée de votre acheteur, et nous confirmerons avec vous qui l'assure.",
    },
    any: {
      en: "This is CPT or CIP: you pay the carriage to the place of arrival, and we will confirm with you who insures it.",
      fr: "C'est le CPT ou le CIP : vous payez le transport jusqu'au lieu d'arrivée, et nous confirmerons avec vous qui l'assure.",
    },
  },
};

const EXPLAIN_TBD = {
  en: "Our team will confirm the Incoterm with you before we quote.",
  fr: "Notre équipe confirmera l'Incoterm avec vous avant de chiffrer.",
};

/* ── reading a website service ──────────────────────────────────────────── */

const up = (v) => (typeof v === "string" ? v.trim().toUpperCase() : "");
const flowOfMember = (m) => {
  const f = up(m && m.flow);
  return f || null;
};
const routedMembers = (service) => (service.members || []).filter((m) => ROUTED_FLOWS.includes(flowOfMember(m)));

/**
 * FREIGHT   a member runs import, export, end to end or hinterland: the
 *           direction and Incoterm questions apply, and the route decides.
 * CUSTOMS   a clearance service: direction and Incoterm are asked for the
 *           desk, but there is no journey to derive a term from.
 * SIMPLE    everything else (inland road and rail, storage, representation):
 *           no direction, no term.
 */
function kindOf(service) {
  if (routedMembers(service).length) return "FREIGHT";
  if (up(service.card) === "CUSTOMS") return "CUSTOMS";
  return "SIMPLE";
}

/** The directions a service can run, in IMPORT, EXPORT order. */
function directionsOf(service) {
  const kind = kindOf(service);
  if (kind === "CUSTOMS") return [...DIRECTIONS];
  if (kind !== "FREIGHT") return [];
  const flows = new Set(routedMembers(service).map(flowOfMember));
  const both = flows.has("END_TO_END") || flows.has("HINTERLAND") || (flows.has("IMPORT") && flows.has("EXPORT"));
  if (both) return [...DIRECTIONS];
  return flows.has("IMPORT") ? ["IMPORT"] : ["EXPORT"];
}

/** True when the service's mode may use FAS, FOB, CFR and CIF. */
const seaTermsAllowed = (service) => SEA_TERM_CARDS.includes(up(service.card) || "OTHER");

/**
 * The terms the service offers, in ICC order: the mode's terms, narrowed to
 * those at least one member quotes. A member that sends no list does not
 * narrow (a payload from before 14300).
 */
function incotermsOf(service) {
  const sea = seaTermsAllowed(service);
  const members = service.members || [];
  const lists = members.filter((m) => Array.isArray(m.incoterms)).map((m) => new Set(m.incoterms.map(up)));
  return INCOTERM_CODES.filter((c) => (sea || !SEA_ONLY.has(c)) && (!lists.length || lists.some((l) => l.has(c))));
}

/* ── scope ──────────────────────────────────────────────────────────────── */

const scopeOf = (flags) => {
  const on = new Set(flags);
  const out = {};
  for (const f of SCOPE_FLAGS) out[f] = on.has(f);
  return out;
};

/** O, M and D, in that order, for the sides the work touches. "" or "OD" are not journeys. */
function spanOf(scope) {
  if (!scope) return null;
  const o = scope.origin_pickup || scope.export_clearance;
  const m = scope.main_carriage;
  const d = scope.import_clearance || scope.duties_taxes || scope.final_delivery;
  const s = `${o ? "O" : ""}${m ? "M" : ""}${d ? "D" : ""}`;
  return SPANS.includes(s) ? s : null;
}

const carriesTransport = (flags) =>
  flags.includes("origin_pickup") || flags.includes("main_carriage") || flags.includes("final_delivery");

/**
 * A picked term, read from the visitor's side, or from the other side when the
 * visitor's carries no transport (see the header).
 */
function scopeForTerm(direction, term) {
  const natural = direction === "EXPORT" ? "SELLER" : "BUYER";
  const share = (party) => (party === "BUYER" ? BUYER_SHARE : SELLER_SHARE)[term];
  let party = natural;
  if (!carriesTransport(share(natural))) party = natural === "BUYER" ? "SELLER" : "BUYER";
  return { visitor: natural, job: party, scope: scopeOf(share(party)) };
}

/** The work between a start and an end, for a buyer or a seller. */
function scopeForRoute(party, start, end) {
  const s = POINTS[start];
  const e = POINTS[end];
  const flags = [];
  if (s === 0) flags.push("origin_pickup");
  if (s === 0 || (party === "SELLER" && s === 1)) flags.push("export_clearance");
  if (s <= 1 && e >= 2) flags.push("main_carriage");
  if (e >= 3 && (party === "BUYER" || end === "PREMISES_DUTY_PAID")) flags.push("import_clearance");
  if (end === "PREMISES_DUTY_PAID") flags.push("duties_taxes");
  if (e >= 3) flags.push("final_delivery");
  return scopeOf(flags);
}

/**
 * The term a start and an end describe. A buyer's term is where the seller's
 * work stops, which is where ours begins; a seller's term is where theirs
 * stops, which is where ours ends. Returns the term, or the C pair when the
 * insurer is still unanswered.
 */
function termForRoute(service, party, start, end, insured) {
  // A service that may carry by sea names the sea rule (FOB, CFR, CIF); any
  // other names the any-mode rule (FCA, CPT, CIP), which the ICC built for air,
  // road and rail.
  const seaRule = seaTermsAllowed(service);
  let family;
  if (party === "BUYER") {
    family = start === "SUPPLIER_PREMISES" ? "E" : start === "ORIGIN_PORT" ? "F" : "C";
  } else {
    family = end === "ORIGIN_PORT" ? "F" : end === "DESTINATION_PORT" ? "C" : end === "PREMISES" ? "DAP" : "DDP";
  }
  if (family === "E") return { term: "EXW" };
  if (family === "F") return { term: seaRule ? "FOB" : "FCA" };
  if (family === "DAP" || family === "DDP") return { term: family };
  // C: the insurer decides.
  if (insured === "YES") return { term: seaRule ? "CIF" : "CIP" };
  if (insured === "NO") return { term: seaRule ? "CFR" : "CPT" };
  return { term: null, cPair: seaRule ? "sea" : "any", askInsured: true };
}

/* ── routing ────────────────────────────────────────────────────────────── */

const FLOW_ORDER = {
  END_TO_END: (dir) => ["END_TO_END", dir],
  IMPORT: () => ["IMPORT", "END_TO_END"],
  EXPORT: () => ["EXPORT", "END_TO_END"],
};

/** The rule for a cell: the service's own first, then the generic one. */
function ruleFor(rules, serviceId, direction, span) {
  const list = Array.isArray(rules) ? rules : [];
  const match = (r, own) =>
    r && up(r.direction) === direction && String(r.span || "") === span &&
    (own ? r.website_service_id != null && String(r.website_service_id) === String(serviceId) : r.website_service_id == null);
  return list.find((r) => match(r, true)) || list.find((r) => match(r, false)) || null;
}

/**
 * Members for a rule's outcome. Returns `{ members }` (one: resolved; more:
 * the visitor picks by name) or `{ desk: reason }`.
 */
function membersForOutcome(service, rule, direction) {
  if (!rule) return { desk: "NO_RULE" };
  const outcome = up(rule.outcome);
  if (outcome === "DESK") return { desk: "RULE_DESK" };
  const members = service.members || [];
  if (outcome === "TYPE") {
    const m = members.find((x) => String(x.id) === String(rule.service_type_id));
    return m ? { members: [m] } : { desk: "NO_MEMBER" };
  }
  const order = FLOW_ORDER[outcome];
  if (!order) return { desk: "NO_RULE" };
  const routed = routedMembers(service);
  for (const flow of order(direction)) {
    const c = routed.filter((m) => flowOfMember(m) === flow);
    if (c.length) return { members: c };
  }
  const hinterland = routed.filter((m) => flowOfMember(m) === "HINTERLAND");
  if (hinterland.length) return { members: hinterland };
  return { desk: "NO_MEMBER" };
}

/**
 * Members the type could be when the work is NOT known (a term left "not
 * sure"): those that run this way. One means the type is still decided.
 */
function membersForDirection(service, direction) {
  const kind = kindOf(service);
  if (kind !== "FREIGHT") return service.members || [];
  return routedMembers(service).filter((m) => {
    const f = flowOfMember(m);
    if (f === "END_TO_END" || f === "HINTERLAND") return true;
    return !direction || f === direction;
  });
}

/* ── the evaluation ─────────────────────────────────────────────────────── */

const memberOption = (m) => ({ id: String(m.id), name: m.name || "" });

/**
 * Run the questions over a website service.
 *
 * @param service  `{ id, card, members: [{ id, name, flow, incoterms? }] }`
 * @param answers  `{ direction, knows, incoterm, party, start, end, insured, member }`
 * @param rules    routing rules (generic and this service's own); DEFAULT_RULES when omitted
 *
 * Returns the steps that apply (each with its options and the answer given),
 * `next` (the first unanswered step, or null when complete), and when complete:
 * the outcome (RESOLVED with a service_type_id, or DESK with a reason), the
 * Incoterm and how it was reached, the scope and its span, and the sentence.
 * Answers to steps that do not apply are dropped from `answers`. An answer
 * outside its step's options is an `issue`, and the outcome is DESK/INVALID.
 * It never throws on any input.
 */
function evaluate(service, answers, rules) {
  const svc = service && typeof service === "object" ? service : { members: [] };
  const a = answers && typeof answers === "object" ? answers : {};
  const ruleSet = Array.isArray(rules) ? rules : DEFAULT_RULES;

  const kind = kindOf(svc);
  const steps = [];
  const issues = [];
  const given = {};
  const result = {
    kind,
    steps,
    next: null,
    complete: false,
    issues,
    answers: given,
    direction: null,
    incoterm: null,
    incoterm_source: null,
    explanation: null,
    party: null,
    scope: null,
    span: null,
    outcome: null,
    reason: null,
    service_type_id: null,
    hinterland_direction: null,
  };

  /** Ask a step; returns the answer, `undefined` when unanswered (stops), or "INVALID". */
  const ask = (id, options, notSure = true) => {
    const raw = a[id];
    const value = id === "member" ? (raw == null ? "" : String(raw)) : up(raw);
    const allowed = id === "member" ? options.map((o) => o.id) : options;
    const step = { id, options, not_sure: notSure, answer: null };
    steps.push(step);
    if (!value) {
      result.next = id;
      return undefined;
    }
    if (value === NOT_SURE && notSure) {
      step.answer = NOT_SURE;
      given[id] = NOT_SURE;
      return NOT_SURE;
    }
    if (!allowed.includes(value)) {
      issues.push({ field: id, message: "not one of the choices offered" });
      return "INVALID";
    }
    step.answer = value;
    given[id] = value;
    return value;
  };

  const finish = (fields) => {
    Object.assign(result, fields, { complete: true, next: null });
    if (result.outcome === "RESOLVED" && result.service_type_id) {
      const m = (svc.members || []).find((x) => String(x.id) === String(result.service_type_id));
      if (m && flowOfMember(m) === "HINTERLAND" && result.direction) {
        result.hinterland_direction = result.direction === "EXPORT" ? "OUT_OF" : "INTO";
      }
    }
    return result;
  };
  const desk = (reason, extra = {}) => finish({ outcome: "DESK", reason, service_type_id: null, ...extra });
  const invalid = () => desk("INVALID", { incoterm: TERM_TBD, incoterm_source: "NOT_SURE", explanation: { ...EXPLAIN_TBD } });

  /** Pick among candidates: one resolves, several ask, none is the desk. */
  const settle = (members, fields, noneReason = "NO_MEMBER") => {
    if (!members.length) return desk(noneReason, fields);
    let chosen = members[0];
    if (members.length > 1) {
      const pick = ask("member", members.map(memberOption));
      if (pick === undefined) return result;
      if (pick === "INVALID") return invalid();
      if (pick === NOT_SURE) return desk("NOT_SURE", fields);
      chosen = members.find((m) => String(m.id) === pick);
    }
    // The resolved service must quote the term the visitor named or derived.
    const term = fields.incoterm;
    if (term && INCOTERM_CODES.includes(term) && Array.isArray(chosen.incoterms) &&
        !chosen.incoterms.map(up).includes(term)) {
      return desk("TERM_NOT_OFFERED", fields);
    }
    return finish({ ...fields, outcome: "RESOLVED", reason: null, service_type_id: String(chosen.id) });
  };

  /** The term is unknown: resolve only if the direction alone decides the type. */
  const unknownTerm = (direction, explanation = EXPLAIN_TBD) => {
    const fields = { direction, incoterm: TERM_TBD, incoterm_source: "NOT_SURE", explanation: { ...explanation } };
    const members = direction === null && kind === "FREIGHT" ? routedMembers(svc) : membersForDirection(svc, direction);
    if (members.length === 1) return settle(members, fields);
    if (kind !== "FREIGHT") return settle(members, fields);
    return desk("NOT_SURE", fields);
  };

  /* SIMPLE: no direction, no term. */
  if (kind === "SIMPLE") {
    return settle(svc.members || [], { incoterm: TERM_NONE, incoterm_source: "NOT_APPLICABLE" });
  }

  /* direction */
  const directions = directionsOf(svc);
  let direction;
  if (directions.length === 1) {
    direction = directions[0];
    given.direction = direction;
  } else {
    const d = ask("direction", directions);
    if (d === undefined) return result;
    if (d === "INVALID") return invalid();
    if (d === NOT_SURE) return unknownTerm(null);
    direction = d;
  }
  result.direction = direction;

  /* the term */
  const offered = incotermsOf(svc);
  if (!offered.length) {
    // A service quoting no term at all: route by direction alone.
    const fields = { direction, incoterm: TERM_NONE, incoterm_source: "NOT_APPLICABLE" };
    const members = membersForDirection(svc, direction);
    return members.length ? settle(members, fields) : desk("NO_MEMBER", fields);
  }

  const knows = ask("knows", KNOWS, false);
  if (knows === undefined) return result;
  if (knows === "INVALID") return invalid();

  if (knows === "YES") {
    const term = ask("incoterm", offered);
    if (term === undefined) return result;
    if (term === "INVALID") return invalid();
    if (term === NOT_SURE) return unknownTerm(direction);
    const visitor = direction === "EXPORT" ? "SELLER" : "BUYER";
    const base = {
      direction,
      incoterm: term,
      incoterm_source: "PICKED",
      explanation: { ...EXPLAIN[visitor][term] },
    };
    if (kind === "CUSTOMS") {
      return settle(svc.members || [], {
        ...base,
        party: visitor,
        scope: scopeOf([direction === "IMPORT" ? "import_clearance" : "export_clearance"]),
        span: direction === "IMPORT" ? "D" : "O",
      });
    }
    const { job, scope } = scopeForTerm(direction, term);
    return route({ ...base, party: job, scope, span: spanOf(scope) });
  }

  /* knows === "NO" */
  if (kind === "CUSTOMS") {
    // No journey to derive a term from: the desk confirms it, the type stands.
    return settle(svc.members || [], {
      direction,
      incoterm: TERM_TBD,
      incoterm_source: "NOT_SURE",
      explanation: { ...EXPLAIN_TBD },
      scope: scopeOf([direction === "IMPORT" ? "import_clearance" : "export_clearance"]),
      span: direction === "IMPORT" ? "D" : "O",
    });
  }

  const party = ask("party", PARTIES);
  if (party === undefined) return result;
  if (party === "INVALID") return invalid();
  if (party === NOT_SURE) return unknownTerm(direction);

  const start = ask("start", party === "SELLER" ? SELLER_STARTS : STARTS);
  if (start === undefined) return result;
  if (start === "INVALID") return invalid();
  if (start === NOT_SURE) return unknownTerm(direction);

  const end = ask("end", ENDS.filter((e) => POINTS[e] > POINTS[start]));
  if (end === undefined) return result;
  if (end === "INVALID") return invalid();
  if (end === NOT_SURE) return unknownTerm(direction);

  const scope = scopeForRoute(party, start, end);
  const span = spanOf(scope);
  let derived = termForRoute(svc, party, start, end, null);
  if (derived.askInsured) {
    const insured = ask("insured", INSURED);
    if (insured === undefined) return result;
    if (insured === "INVALID") return invalid();
    if (insured === NOT_SURE) {
      // The scope is whole; only CFR against CIF is open. Route on the scope.
      return route({
        direction,
        party,
        scope,
        span,
        incoterm: TERM_TBD,
        incoterm_source: "NOT_SURE",
        explanation: { ...EXPLAIN_C_PAIR[party][derived.cPair] },
      });
    }
    derived = termForRoute(svc, party, start, end, insured);
  }
  const term = derived.term;
  const fields = {
    direction,
    party,
    scope,
    span,
    incoterm: term,
    incoterm_source: "DERIVED",
    explanation: { ...EXPLAIN[party][term] },
  };
  if (!offered.includes(term)) return desk("TERM_NOT_OFFERED", fields);
  return route(fields);

  /** From a known scope to the member. */
  function route(fields) {
    if (!fields.span) return desk("INVALID", fields);
    const rule = ruleFor(ruleSet, svc.id, direction, fields.span);
    const found = membersForOutcome(svc, rule, direction);
    if (found.desk) return desk(found.desk, fields);
    return settle(found.members, fields);
  }
}

/* ── checking the configuration ─────────────────────────────────────────── */

/**
 * Problems in a rule set, for Master Data to refuse and the test to prove
 * absent. Each `{ index, field, message }`; `index` is null for a gap.
 *
 *   - every field from its vocabulary;
 *   - IMPORT only on an importing cell, EXPORT only on an exporting one;
 *   - TYPE names a service type and belongs to one website service;
 *   - no cell twice for the same scope (generic, or one website service);
 *   - the generic rules cover all twelve cells, so no work is ever unrouted.
 */
function validateRules(rules, { requireComplete = true } = {}) {
  const out = [];
  const seen = new Set();
  // Cells held by a rule with nothing wrong in it: a broken row covers nothing.
  const covered = new Set();
  (Array.isArray(rules) ? rules : []).forEach((r, index) => {
    const before = out.length;
    const direction = up(r && r.direction);
    const span = String((r && r.span) || "");
    const outcome = up(r && r.outcome);
    if (!DIRECTIONS.includes(direction)) out.push({ index, field: "direction", message: "must be IMPORT or EXPORT" });
    if (!SPANS.includes(span)) out.push({ index, field: "span", message: `must be one of ${SPANS.join(", ")}` });
    if (!OUTCOMES.includes(outcome)) out.push({ index, field: "outcome", message: `must be one of ${OUTCOMES.join(", ")}` });
    if (outcome === "IMPORT" && direction === "EXPORT") out.push({ index, field: "outcome", message: "an exporting cell cannot route to an import service" });
    if (outcome === "EXPORT" && direction === "IMPORT") out.push({ index, field: "outcome", message: "an importing cell cannot route to an export service" });
    if (outcome === "TYPE" && !(r && r.service_type_id)) out.push({ index, field: "service_type_id", message: "required when the outcome names a service type" });
    if (outcome === "TYPE" && !(r && r.website_service_id)) out.push({ index, field: "website_service_id", message: "a rule naming a service type belongs to one website service" });
    const key = `${(r && r.website_service_id) || "*"}|${direction}|${span}`;
    if (seen.has(key)) out.push({ index, field: "span", message: "this cell already has a rule" });
    seen.add(key);
    if (out.length === before) covered.add(key);
  });
  if (requireComplete) {
    for (const direction of DIRECTIONS) {
      for (const span of SPANS) {
        if (!covered.has(`*|${direction}|${span}`)) {
          out.push({ index: null, field: "span", message: `no generic rule for ${direction} ${span}` });
        }
      }
    }
  }
  return out;
}

/**
 * Warnings about one website service, for its editor: members the engine can
 * never reach, two members it cannot tell apart, a mode that rules out terms.
 */
function validateService(service, rules = DEFAULT_RULES) {
  const out = [];
  const svc = service || { members: [] };
  const members = svc.members || [];
  if (!members.length) out.push({ code: "NO_MEMBERS", message: "This website service has no service type to quote." });
  const kind = kindOf(svc);
  if (kind === "FREIGHT") {
    for (const m of members) {
      if (!ROUTED_FLOWS.includes(flowOfMember(m))) {
        out.push({ code: "UNREACHABLE", member: String(m.id), message: `${m.name || "A member"} has no import, export, end to end or hinterland territory, so a quote never reaches it.` });
      }
    }
    const byFlow = new Map();
    for (const m of routedMembers(svc)) {
      const f = flowOfMember(m);
      byFlow.set(f, [...(byFlow.get(f) || []), m]);
    }
    for (const [flow, list] of byFlow) {
      if (list.length > 1) out.push({ code: "SAME_FLOW", flow, message: `${list.map((m) => m.name).join(" and ")} share one flow, so the visitor is asked to choose between them.` });
    }
    for (const r of validateRules(rules, { requireComplete: false })) {
      out.push({ code: "RULE", message: r.message });
    }
  }
  return out;
}

/* ── for the forms ──────────────────────────────────────────────────────── */

/** `[{ flag, en, fr }]` for the flags a scope carries, in journey order. */
function describeScope(scope) {
  if (!scope) return [];
  return SCOPE_FLAGS.filter((f) => scope[f]).map((f) => ({ flag: f, ...SCOPE_LABELS[f] }));
}

/**
 * Every answer set a service can be given, for the exhaustive test and for a
 * Master Data preview of what a service resolves to. Walks the questions the
 * engine itself asks, so it cannot drift from them.
 */
function enumerate(service, rules) {
  const out = [];
  const walk = (answers) => {
    const r = evaluate(service, answers, rules);
    if (r.complete) {
      out.push({ answers: { ...answers }, result: r });
      return;
    }
    const step = r.steps[r.steps.length - 1];
    const values = step.id === "member" ? step.options.map((o) => o.id) : [...step.options];
    if (step.not_sure) values.push(NOT_SURE);
    for (const v of values) walk({ ...answers, [step.id]: v });
  };
  walk({});
  return out;
}

exports.NOT_SURE = NOT_SURE;
exports.TERM_TBD = TERM_TBD;
exports.TERM_NONE = TERM_NONE;
exports.INCOTERM_CODES = INCOTERM_CODES;
exports.SEA_ONLY_CODES = SEA_ONLY_CODES;
exports.SEA_TERM_CARDS = SEA_TERM_CARDS;
exports.DIRECTIONS = DIRECTIONS;
exports.KNOWS = KNOWS;
exports.PARTIES = PARTIES;
exports.INSURED = INSURED;
exports.STARTS = STARTS;
exports.ENDS = ENDS;
exports.SELLER_STARTS = SELLER_STARTS;
exports.SCOPE_FLAGS = SCOPE_FLAGS;
exports.SCOPE_LABELS = SCOPE_LABELS;
exports.SPANS = SPANS;
exports.OUTCOMES = OUTCOMES;
exports.ROUTED_FLOWS = ROUTED_FLOWS;
exports.DESK_REASONS = DESK_REASONS;
exports.DEFAULT_RULES = DEFAULT_RULES;
exports.BUYER_SHARE = BUYER_SHARE;
exports.SELLER_SHARE = SELLER_SHARE;
exports.C_TERMS = [...C_TERMS];
exports.EXPLAIN = EXPLAIN;
exports.EXPLAIN_TBD = EXPLAIN_TBD;
exports.kindOf = kindOf;
exports.directionsOf = directionsOf;
exports.incotermsOf = incotermsOf;
exports.scopeForTerm = scopeForTerm;
exports.scopeForRoute = scopeForRoute;
exports.spanOf = spanOf;
exports.evaluate = evaluate;
exports.validateRules = validateRules;
exports.validateService = validateService;
exports.describeScope = describeScope;
exports.enumerate = enumerate;
