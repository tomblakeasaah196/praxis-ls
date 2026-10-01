"use strict";
/**
 * AI manifest for the service taxonomy.
 *
 * READ-ONLY on purpose. Service types are configuration that everything else
 * classifies against — milestone templates hang off them,
 * `dictionary_item.service_type_key` references them, and they drive the Control
 * Tower's transport mode. `key` is immutable after creation precisely because a
 * rename orphans those references, so this is not a surface the assistant should
 * be proposing changes to on a user's behalf. Reads let it answer "which
 * services do we sell, which are missing a milestone template, and what is
 * classified under a given one".
 *
 * Still read-only after meeting 6 gave each service a quote-form card and its
 * own Incoterms (14300): a card decides which questions a client is asked, so
 * it is set by a person in Service types, with the collision warning in front
 * of them. The AI can read where every service lands (`list_service_quote_cards`).
 *
 * The screen is `master/service-types` — the taxonomy lives in the Master Data
 * hub in the UI; the backend module stays under `operations` because it rides
 * MOD-29 with the dossier (see service_type.events.js for why).
 */
const service = require("./service_type.service");
const dossier360 = require("./service_type_360.service");
const { serviceScope } = require("@praxis/shared");

/**
 * Where each active service lands in a quote request (meeting 6, PR 2): its
 * card (transport_mode) and flow (from territory), the Incoterms it offers,
 * and any pair that would collapse into one chip on the wizard.
 */
async function quoteCards(c) {
  const rows = (await service.list(c, {})).filter((r) => r.is_active !== false);
  const services = rows.map((r) => ({
    service_type_id: r.service_type_id,
    key: r.key,
    name: r.name_en || r.name_fr,
    ...serviceScope.placementOf(r),
    incoterms: r.incoterms || [],
    enquiry_shape: r.enquiry_shape,
  }));
  const names = new Map(services.map((s) => [s.service_type_id, s.name]));
  return {
    services,
    collisions: serviceScope.collisions(rows).map((g) => ({ ...g, names: g.ids.map((id) => names.get(id)) })),
  };
}

module.exports = {
  entity: "service_type",
  module_key: "MOD-29",
  screens: ["master/service-types"],
  reads: [
    {
      key: "list_service_types",
      service: service.list, permission: { module: "MOD-29", action: "view" },
      describe: "List the service taxonomy, with milestone-template coverage per service type, each service's quote-form card (transport_mode: SEA / AIR / RAIL / ROAD / STORAGE / CUSTOMS / OTHER) and the Incoterms it offers.",
    },
    {
      key: "list_service_quote_cards",
      service: (c) => quoteCards(c), permission: { module: "MOD-29", action: "view" },
      describe: "Where each active service type lands on the quote request wizard (website, client portal, desk): its card (mode), its flow (IMPORT / EXPORT / END_TO_END / INLAND / HINTERLAND, from territory; null shows the service by name), the Incoterms it offers, and any pair of services sharing one card and one flow (collisions) that Service types warns about.",
    },
    {
      key: "get_service_type",
      service: service.get, permission: { module: "MOD-29", action: "view" },
      describe: "Get a service type by id.",
    },
    {
      // Payload accepts `service_type_id` (the AI's usual field name) or the
      // raw id string, matching how the entity-360 read is called
      // (corporate_entity.ai.js:26). Money keys arrive masked because the AI
      // read does not carry a request context to resolve MOD-09 grants against
      // — a caller who needs the money should open the screen.
      key: "get_service_type_360",
      service: (c, p) => dossier360.dossier(c, (p && p.service_type_id) || p, { canSeeFinancials: false }), permission: { module: "MOD-29", action: "view" },
      describe: "Full 360 for one service type: milestone templates and their stages, applicable financial dictionary items, recent operations files and margin simulations, and the money rollup (billed / planned / actual — masked without finance visibility).",
    },
  ],
  writes: [],
};
