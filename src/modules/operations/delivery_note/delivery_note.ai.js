"use strict";
const service = require("./delivery_note.service");
const validator = require("./delivery_note.validator");
module.exports = {
  entity: "delivery_note", module_key: "MOD-32", screens: [],
  reads: [
    { key: "list_delivery_notes", service: service.list, describe: "List delivery notes." },
    { key: "get_delivery_note", service: service.get, describe: "Get a delivery note by id." },
  ],
  writes: [
    { key: "create_delivery_note", service: service.create, schema: validator.schemas.create, permission: { module: "MOD-32", action: "create" }, confirm: true, describe: "Create a numbered delivery note on a dossier." },
  ],
};
