"use strict";
const service = require("./quotation.service");
const validator = require("./quotation.validator");
module.exports = {
  entity: "quotation", module_key: "MOD-27", screens: [],
  reads: [
    { key: "list_quotations", service: (c, p) => service.list(c, p), permission: { module: "MOD-27", action: "view" }, describe: "List quotations (filter status/client/operations file)." },
    { key: "get_quotation", service: (c, p) => service.get(c, p.id || p), permission: { module: "MOD-27", action: "view" }, describe: "Get a quotation with lines + totals, the quote request it answers, the costing it was priced from and the margin-simulation workings behind it." },
    // Meeting 6, G1: what "Create quotation" on a costing would produce —
    // nothing is written. Shows the margin applied and the own-cost floor.
    { key: "preview_quotation_from_costing", service: (c, p) => service.fromCostingPreview(c, { costingId: p.costing_id }), permission: { module: "MOD-27", action: "view" }, describe: "Price a validated or approved costing as a quotation WITHOUT saving: débours at cost (no VAT), services at the tenant's target margin, own-cost lines not billed but totalled as the floor the services must cover. Also lists the client's open quote requests it could answer. Param: costing_id." },
  ],
  writes: [
    { key: "draft_quotation", service: (c, p) => service.createDraft(c, { data: p }), schema: validator.schemas.create, permission: { module: "MOD-27", action: "create" }, confirm: true, describe: "Draft a quotation (lines + totals). Lines stay detailed; each may carry client_heading (a CLIENT_HEADING code or a family name made up for this quote) — the printed quotation groups lines by heading × nature (disbursements apart from fees), in family_order when given. quote_request_id links the quote request it answers (else it is taken from the opportunity's request)." },
    // The one click (G1), under the write contract: the payload's costing_id
    // and quote_request_id mapped to the service's arguments, the actor forwarded.
    { key: "draft_quotation_from_costing", service: (c, p, actor) => service.createFromCosting(c, { costingId: p.costing_id, quoteRequestId: Object.prototype.hasOwnProperty.call(p, "quote_request_id") ? p.quote_request_id : undefined, validUntil: p.valid_until || null, actor }), schema: validator.schemas.aiFromCosting, permission: { module: "MOD-27", action: "create" }, confirm: true, describe: "Create a DRAFT quotation from a validated or approved costing in one step, priced with the margin simulator's rules at the tenant's target margin (débours at cost, services marked up, own costs not billed). Families, container types, tax codes and quantities cross intact; the workings are saved as a linked margin simulation. quote_request_id links the request it answers (omit to take the suggested one, null for none)." },
    { key: "transition_quotation", service: (c, p, actor) => service.transition(c, { id: p.quotation_id, to: p.to, entityId: p.entity_id, actor }), schema: validator.schemas.aiTransition, permission: { module: "MOD-27", action: "approve" }, confirm: true, describe: "Advance a quotation by id: DRAFT→SENT first, then SENT→REJECTED/EXPIRED (acceptance is the separate accept_quotation action). Cannot skip states." },
    { key: "convert_quotation", service: (c, p, actor) => service.convert(c, { id: p.quotation_id, actor }), schema: validator.schemas.aiConvert, permission: { module: "MOD-27", action: "edit" }, confirm: true, describe: "Turn an ACCEPTED quotation (for example one the client accepted and signed in the portal) into a final-invoice DRAFT, lines, families and family order intact." },
    { key: "accept_quotation", service: (c, p, actor) => service.accept(c, { id: p.quotation_id, convert: p.convert, actor }), schema: validator.schemas.aiAccept, permission: { module: "MOD-27", action: "approve" }, confirm: true, describe: "Accept a sent quotation by id (optionally convert to a final invoice)." },
  ],
};
