"use strict";

const { serviceScope } = require("@praxis/shared");

const { modeFromKey, glyphOf } = serviceScope;

/**
 * The transport mode a service type moves cargo by, derived from its key.
 *
 * ── WHY IT LIVES HERE NOW ──────────────────────────────────────────────────
 *
 * It was a private function of `tracking_public.service.js`, where the tracking
 * page uses it to pick a glyph and to name the two ends of a route. The public
 * services read needs exactly the same answer, for exactly the same reason: the
 * quote wizard was asking a stranger "how is it moving?" from a list of four
 * hardcoded options while the tenant's own service taxonomy — the answer to that
 * question — sat one join away. Two callers deriving a mode from the same column
 * with two copies of the rules is how a ship on the tracking page ends up next to
 * "Place of collection" on the quote form.
 *
 * ── THE KEY'S READING, AND THE COLUMN THAT CAN OVERRULE IT ──────────────────
 *
 * Reading the key a tenant already chose costs nothing and covers every key
 * they will choose next (services are DATA — 0310_operations.sql), and an
 * unrecognised one answers OTHER: a neutral icon, never a wrong one.
 *
 * Since meeting 6 (PR 2) the quote wizard's cards are a COLUMN as well —
 * `service_type.transport_mode`, defaulted from this very reading and editable
 * in Service types, because a card decides which questions a client is asked
 * and a misread key there costs more than an icon. The ladder itself moved to
 * `@praxis/shared` (rules/service-scope.js, MODE_LADDER) so the column's
 * default, the service-type form's suggestion and this glyph cannot read one
 * key three ways. This function keeps its old vocabulary (storage is
 * WAREHOUSE) for the tracking page and the site focus lanes.
 *
 * The order is the whole content of the ladder, and it is the precedence
 * `routeLabels` has always applied. AIR before SEA, because that function tests
 * the air fields first and a combined key — a sea-air service — must land the
 * same way in both. RAIL before ROAD, because RAIL_HINTERLAND_TRANSIT is a rail
 * movement that also runs on a truck at one end, and the leg that names the
 * service is the rail one.
 *
 * @param {string|null} key  service_type.key
 * @returns {"SEA"|"AIR"|"RAIL"|"ROAD"|"WAREHOUSE"|"CUSTOMS"|"OTHER"}
 */
function serviceMode(key) {
  return glyphOf(modeFromKey(key));
}

module.exports = { serviceMode };
