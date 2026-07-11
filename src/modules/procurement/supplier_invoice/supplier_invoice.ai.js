"use strict";
const service = require("./supplier_invoice.service");
const validator = require("./supplier_invoice.validator");
module.exports = {
  entity: "supplier_invoice", module_key: "MOD-61", screens: [],
  reads: [
    { key: "list_supplier_invoices", service: service.list, describe: "List supplier invoices." },
    { key: "get_supplier_invoice", service: service.get, describe: "Get a supplier invoice with lines." },
  ],
  writes: [
    { key: "draft_supplier_invoice", service: service.createDraft, schema: validator.schemas.create, permission: { module: "MOD-61", action: "create" }, confirm: true, describe: "Create a DRAFT supplier invoice." },
    { key: "match_supplier_invoice", service: service.match, schema: validator.schemas.match, permission: { module: "MOD-61", action: "edit" }, confirm: true, describe: "Run the three-way match (PR↔PO↔GRN↔invoice)." },
    { key: "post_supplier_invoice", service: service.post, schema: validator.schemas.post, permission: { module: "MOD-61", action: "approve" }, confirm: true, describe: "Post to GL (Dr expense+VAT / Cr supplier net of WHT + WHT). KB §8.5." },
  ],
};
