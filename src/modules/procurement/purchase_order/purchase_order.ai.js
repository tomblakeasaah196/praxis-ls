"use strict";
const service = require("./purchase_order.service");
const validator = require("./purchase_order.validator");
module.exports = {
  entity: "purchase_order", module_key: "MOD-60", screens: [],
  reads: [
    { key: "list_purchase_orders", service: service.list, describe: "List purchase orders." },
    { key: "get_purchase_order", service: service.get, describe: "Get a purchase order with items." },
  ],
  writes: [
    { key: "draft_purchase_order", service: service.createDraft, schema: validator.schemas.create, permission: { module: "MOD-60", action: "create" }, confirm: true, describe: "Create a DRAFT purchase order." },
    { key: "update_purchase_order", service: service.updateDraft, schema: validator.schemas.update, permission: { module: "MOD-60", action: "edit" }, confirm: true, describe: "Edit a DRAFT purchase order." },
    { key: "transition_purchase_order", service: service.transition, schema: validator.schemas.transition, permission: { module: "MOD-60", action: "approve" }, confirm: true, describe: "Issue/approve/receive/close a PO (numbers on issue)." },
  ],
};
