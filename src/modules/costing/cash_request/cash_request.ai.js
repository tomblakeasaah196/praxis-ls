"use strict";
const service = require("./cash_request.service");
const validator = require("./cash_request.validator");
module.exports = {
  entity: "cash_request", module_key: "MOD-49", screens: [],
  reads: [
    { key: "list_cash_requests", service: service.list, describe: "List cash requests / disbursals." },
    { key: "get_cash_request", service: service.get, describe: "Get a cash request with lines + payments." },
  ],
  writes: [
    { key: "draft_cash_request", service: service.createDraft, schema: validator.schemas.create, permission: { module: "MOD-49", action: "create" }, confirm: true, describe: "Create a DRAFT cash request." },
    { key: "update_cash_request", service: service.updateDraft, schema: validator.schemas.update, permission: { module: "MOD-49", action: "edit" }, confirm: true, describe: "Edit a DRAFT cash request." },
    { key: "transition_cash_request", service: service.transition, schema: validator.schemas.transition, permission: { module: "MOD-49", action: "approve" }, confirm: true, describe: "Submit/approve/reject a cash request." },
    { key: "disburse_cash_request", service: service.disburse, schema: validator.schemas.disburse, permission: { module: "MOD-49", action: "approve" }, confirm: true, describe: "Disburse (issues a régie advance, Dr 581 / Cr treasury)." },
    { key: "justify_cash_request", service: service.justify, schema: validator.schemas.justify, permission: { module: "MOD-49", action: "edit" }, confirm: true, describe: "Record spend and close (JUSTIFIED)." },
  ],
};
