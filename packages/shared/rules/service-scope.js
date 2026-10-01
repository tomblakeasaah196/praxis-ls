"use strict";
/**
 * Where a service type sits in a quote request: its CARD (how the goods move)
 * and, inside the card, its FLOW (which way) — tenant review, meeting 6,
 * owner decisions Q1 and Q2.
 *
 * ── THE MODEL ───────────────────────────────────────────────────────────────
 *
 * A quote request — from the website, the client portal or the desk — names a
 * SERVICE TYPE, and the service type is what the request stores
 * (`quote_request.service_type_id`, 14310). The wizard reaches it in two taps:
 *
 *   card   SEA · AIR · RAIL · ROAD (under a "Transport" label) · STORAGE ·
 *          CUSTOMS, plus OTHER for anything none of the six describes (it is
 *          listed under an "Other services" link, never dropped). Stored on the
 *          service type as `transport_mode` — explicit and editable, because a
 *          tenant whose key the ladder below misreads must be able to correct
 *          it in Service types without engineering (the reason 13774 gave
 *          `enquiry_shape` its own column applies here).
 *   flow   IMPORT · EXPORT · END_TO_END · INLAND · HINTERLAND — DERIVED from
 *          the existing, editable `territory`. A territory with no flow
 *          (PORT_AIRPORT_ZONE, CROSS_BORDER, OTHER) is shown by the service's
 *          name instead.
 *
 * Two active services sharing one card AND one flow would collapse into one
 * chip, so the wizard shows their names instead, and Service types warns about
 * the pair (`collisions`). A card holding a single service skips the flow step.
 *
 * Hinterland transit (road or rail into Chad / CAR) is one service type that
 * runs both ways, so the request also stores which: INTO the hinterland (import
 * transit, Douala → N'Djamena) or OUT_OF it (export transit, Bangui → Douala).
 *
 * ── WHY THE KEY LADDER LIVES HERE ───────────────────────────────────────────
 *
 * `transport_mode` is backfilled from, and defaults to, a reading of the key
 * (`SEA_FREIGHT_IMPORT` → SEA). That reading was `_shared/service-mode.js`'s,
 * and it must stay ONE reading: the tracking page's glyph, the public services
 * payload, the service-type form's suggested card and the database default
 * (migration 14300's `service_type_mode_from_key`) all answer the same question.
 * The SQL function mirrors MODE_LADDER term for term, and
 * tests/unit/service-scope.test.js reads the migration to hold them together.
 */

/** `service_type.transport_mode` — the quote form's cards. */
const MODES = ["SEA", "AIR", "RAIL", "ROAD", "STORAGE", "CUSTOMS", "OTHER"];
/** The four that sit under the "Transport" label. */
const TRANSPORT_MODES = ["SEA", "AIR", "RAIL", "ROAD"];
/** The six cards, in the order the wizard draws them. OTHER is a link below them. */
const CARD_ORDER = ["SEA", "AIR", "RAIL", "ROAD", "STORAGE", "CUSTOMS"];

const FLOWS = ["IMPORT", "EXPORT", "END_TO_END", "INLAND", "HINTERLAND"];
const FLOW_OF_TERRITORY = {
  INTERNATIONAL_IMPORT: "IMPORT",
  INTERNATIONAL_EXPORT: "EXPORT",
  END_TO_END_INTERNATIONAL: "END_TO_END",
  DOMESTIC_INLAND: "INLAND",
  TRANSIT_HINTERLAND: "HINTERLAND",
};

/** `quote_request.hinterland_direction`. */
const HINTERLAND_DIRECTIONS = ["INTO", "OUT_OF"];

/**
 * The key ladder, in precedence order — what a key's words say about how it
 * moves. AIR before SEA so a sea-air key lands the way the tracking page has
 * always drawn it; RAIL before ROAD because RAIL_HINTERLAND_TRANSIT is a rail
 * movement with a truck at one end; INLAND and HINTERLAND are road unless rail
 * said otherwise first. Anything unmatched is OTHER — a neutral answer, never
 * a wrong one.
 */
const MODE_LADDER = [
  ["AIR", ["AIR", "FLIGHT"]],
  ["SEA", ["SEA", "OCEAN", "SHIPPING"]],
  ["RAIL", ["RAIL"]],
  ["ROAD", ["ROAD", "TRUCK", "HAULAGE", "INLAND", "HINTERLAND"]],
  ["STORAGE", ["WAREHOUS", "STORAGE"]],
  ["CUSTOMS", ["CUSTOMS", "CLEARANCE", "DECLARATION"]],
];

/** SEA | AIR | RAIL | ROAD | STORAGE | CUSTOMS | OTHER, read from a key. */
function modeFromKey(key) {
  const k = String(key || "").toUpperCase();
  for (const [mode, words] of MODE_LADDER) {
    if (words.some((w) => k.includes(w))) return mode;
  }
  return "OTHER";
}

/**
 * The glyph vocabulary the tracking page and the public site have always used,
 * where storage is WAREHOUSE. Kept so no consumer of `mode` changes shape.
 */
const glyphOf = (mode) => (mode === "STORAGE" ? "WAREHOUSE" : MODES.includes(mode) ? mode : "OTHER");

/** The card of a service type row: its own `transport_mode`, else the key's reading. */
function modeOf(row) {
  const m = row && typeof row.transport_mode === "string" ? row.transport_mode.toUpperCase() : null;
  return m && MODES.includes(m) ? m : modeFromKey(row && row.key);
}

/** The flow a territory places a service in, or null when it names none. */
const flowOf = (territory) => FLOW_OF_TERRITORY[String(territory || "").toUpperCase()] || null;

/** `{ mode, flow }` for a service type row. */
const placementOf = (row) => ({ mode: modeOf(row), flow: flowOf(row && row.territory) });

/**
 * Active services that would collapse into one chip — same card, same flow.
 *
 * Returns one entry per clash: `{ mode, flow, ids }`, ids in input order.
 * Services with no flow never clash: the wizard already shows them by name.
 */
function collisions(rows) {
  const groups = new Map();
  for (const r of rows || []) {
    if (!r || r.is_active === false) continue;
    const { mode, flow } = placementOf(r);
    if (!flow) continue;
    const k = `${mode}|${flow}`;
    if (!groups.has(k)) groups.set(k, { mode, flow, ids: [] });
    groups.get(k).ids.push(r.service_type_id);
  }
  return [...groups.values()].filter((g) => g.ids.length > 1);
}

/** True when the request needs to say which way a hinterland transit runs. */
const needsHinterlandDirection = (row) => placementOf(row).flow === "HINTERLAND";

module.exports = {
  MODES,
  TRANSPORT_MODES,
  CARD_ORDER,
  FLOWS,
  FLOW_OF_TERRITORY,
  HINTERLAND_DIRECTIONS,
  MODE_LADDER,
  modeFromKey,
  glyphOf,
  modeOf,
  flowOf,
  placementOf,
  collisions,
  needsHinterlandDirection,
};
