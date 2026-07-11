"use strict";
const service = require("./extra_charge_simulation.service");
const validator = require("./extra_charge_simulation.validator");
module.exports = {
  entity: "extra_charge_simulation", module_key: "MOD-28", screens: [],
  reads: [
    { key: "list_extra_charge_simulations", service: service.list, describe: "List demurrage/detention simulations." },
    { key: "get_extra_charge_simulation", service: service.get, describe: "Get a demurrage simulation." },
  ],
  writes: [
    { key: "create_extra_charge_simulation", service: service.create, schema: validator.schemas.compute, permission: { module: "MOD-28", action: "create" }, confirm: true, describe: "Compute + persist a tiered demurrage/detention estimate." },
  ],
};
