/**
 * ⌘K search provider — vehicles by registration (MOD-39).
 *
 * Gated on the module's `view` grant by the search service, run on the
 * request's LIVE or TEST connection, bounded by the service's limit
 * (src/services/search/provider.js has the contract).
 */
"use strict";
const { recordProvider } = require("../../../services/search/provider.js");

module.exports = recordProvider({
  type: "vehicle",
  module: "MOD-39",
  label: { en: "Vehicles", fr: "Véhicules" },
  route: "/fleet/vehicles",
  from: "vehicle v",
  columns: ["v.registration"],
  select: "v.vehicle_id AS id, v.registration AS ref, v.registration AS title, v.category AS sub, v.status AS status",
  order: "v.registration",
  url: (r) => `/fleet/vehicles?focus=${encodeURIComponent(r.id)}`,
});
