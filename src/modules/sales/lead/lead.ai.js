"use strict";
const service = require("./lead.service");
const sales360 = require("../sales-360.service");
const validator = require("./lead.validator");

/**
 * Leads (MOD-20): the company row (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §5.4).
 * The AI reads the 360, captures a company (with the duplicate check, which
 * refuses one already on file and names it), logs what happened, sets the next
 * step, and archives or makes a client under the same grants as the screen.
 *
 * Money stays hidden on the AI's reads (null, never zero): the value of a
 * company's open requests is finance-visibility data, and the assistant does
 * not carry the caller's finance grant.
 */
module.exports = {
  entity: "lead",
  module_key: "MOD-20",
  screens: [],
  reads: [
    { key: "list_leads", service: (c, p, actor) => service.list(c, p || {}, { userId: actor && actor.user_id, canSeeFinancials: false }).then((r) => ({ rows: r.rows, total: r.total, tiles: r.tiles })), permission: { module: "MOD-20", action: "view" }, describe: "List company rows (one per company). view: mine (open leads I own, soonest next step first), open, prospects, clients, archived; due: today | overdue; q searches company, contact, email, phone and a request reference. Each row carries Prospect or Client (is_client), its next step (action, due date, overdue) and how many requests are open." },
    { key: "get_lead", service: (c, p) => service.get(c, p.id || p.lead_id || p), permission: { module: "MOD-20", action: "view" }, describe: "Get a company row by id: its contact details, owner, Prospect or Client, its live next step and whether it owes one." },
    { key: "get_lead_360", service: (c, p, actor) => sales360.leadDossier(c, { leadId: p.lead_id || p.id || p, canSeeFinancials: false, user: actor || null }), permission: { module: "MOD-20", action: "view" }, describe: "The Lead 360 of one company (lead_id): its next step, its requests with their stage, its quotations, and one Activity timeline (calls, emails, WhatsApps, visits and notes logged; meetings; bound mail threads the caller may read; quotations sent, viewed and answered; stage moves)." },
    { key: "find_duplicate_leads", service: (c, p) => service.duplicates(c, p || {}), permission: { module: "MOD-20", action: "view" }, describe: "Is this company already on file? Give company_name, email and/or phone. `exact` rows matched a key outright (same email, same phone, or the same name once folded) and capture would refuse a second row; `similar` rows only read alike. A client with no company row yet has lead_id null." },
  ],
  writes: [
    { key: "capture_lead", service: (c, p, actor) => service.capture(c, { data: p, actor }), schema: validator.schemas.create, permission: { module: "MOD-20", action: "create" }, confirm: true, describe: "Capture a company: company_name, a phone or an email, and next_step { action, due_at } (required: every open lead has a dated next step). service_type_id opens its first request. Refused with LEAD_EXISTS, naming the row, when the company is already on file (same email, phone or folded name): use that row instead." },
    { key: "log_lead_activity", service: (c, p, actor) => service.logActivity(c, { id: p.lead_id, data: { kind: p.kind, body: p.body, occurred_at: p.occurred_at, quote_request_id: p.quote_request_id }, actor }), schema: validator.schemas.aiActivity, permission: { module: "MOD-20", action: "edit" }, confirm: true, describe: "Log what happened with a company (lead_id): kind CALL, EMAIL, WHATSAPP, VISIT or NOTE, and a line (body, up to 2,000 characters). quote_request_id when it was about one of its requests." },
    { key: "set_lead_next_step", service: (c, p, actor) => service.setNextStep(c, { id: p.lead_id, step: { action: p.action, due_at: p.due_at, assigned_to: p.assigned_to }, actor }), schema: validator.schemas.aiNextStep, permission: { module: "MOD-20", action: "edit" }, confirm: true, describe: "Set or change a company's next step (lead_id): action and due_at (a date, or a date and time on the tenant's clock), optionally assigned_to. It lands in My Workspace with a reminder." },
    { key: "archive_lead", service: (c, p, actor) => service.archive(c, { id: p.lead_id, reason: p.reason, reasonCode: p.reason_code || "OTHER", actor }), schema: validator.schemas.aiArchive, permission: { module: "MOD-20", action: "approve" }, confirm: true, describe: "Archive a company (lead_id) with a reason: it stops owing a next step, and every request still open on it is lost for reason_code (PRICE, TIMING, COMPETITOR, NO_RESPONSE, OTHER; default OTHER)." },
    { key: "make_lead_client", service: (c, p, actor) => service.makeClient(c, { id: p.lead_id, clientData: p.client, actor }), schema: validator.schemas.aiMakeClient, permission: { module: "MOD-20", action: "edit" }, confirm: true, describe: "Make a prospect (lead_id) a client: a DRAFT client_master row from its facts, and the company row carries on as a Client. The `client` block MUST carry client_type and payment_terms_days. An accepted quotation does this by itself." },
  ],
};
