"use strict";
const service = require("./corporate_entity.service");
const validator = require("./corporate_entity.validator");
module.exports = {
  entity: "corporate_entity", module_key: "MOD-01", screens: [],
  reads: [
    { key: "list_entities", service: service.list, describe: "List corporate entities." },
    { key: "get_entity", service: service.get, describe: "Get a corporate entity by id." },
  ],
  writes: [
    { key: "create_entity", service: service.create, schema: validator.schemas.create, permission: { module: "MOD-01", action: "create" }, confirm: true, describe: "Register a corporate entity (unique code, NIU/RCCM, fiscal year)." },
    { key: "update_entity", service: service.update, schema: validator.schemas.update, permission: { module: "MOD-01", action: "edit" }, confirm: true, describe: "Edit a corporate entity." },
    { key: "set_entity_active", service: service.setActive, schema: validator.schemas.setActive, permission: { module: "MOD-01", action: "edit" }, confirm: true, describe: "Activate/deactivate an entity." },
  ],
};
