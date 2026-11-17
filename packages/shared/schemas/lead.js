"use strict";
/**
 * Lead (MOD-20) — the COMPANY ROW of Sales & CRM, every payload
 * (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.2, §4.1 to §4.4).
 *
 * One row per company. What it asks for is a request on that row (the
 * quote-request shapes); what happened with it is an activity; what happens
 * next is a dated next step. The API's adapter (`lead.validator.js`) parses
 * with these, and so does the capture form, so "a lead the form accepts" and
 * "a lead the API accepts" are one definition.
 *
 * ── WHAT IS NOT HERE ────────────────────────────────────────────────────────
 *
 * Whether a company is already on file (the duplicate check), whether an open
 * lead may go without a next step (a client with nothing open), and who owns a
 * website lead are the SERVICE's: each needs the database.
 */

const { z } = require("zod");
const { LOST_REASONS } = require("./quote-request");

/** OPEN or ARCHIVED (14510). Prospect or Client is `client_id IS NULL`. */
const STATUSES = ["OPEN", "ARCHIVED"];

/** Where a company came from (14512: CAMPAIGN left with Campaigns). */
const SOURCES = ["MANUAL", "WEBSITE", "PORTAL", "EMAIL", "REFERRAL"];

/** The client types a Make Client can file under (client_type.code). */
const CLIENT_TYPES = ["SHIPPER", "CONSIGNEE", "BOTH", "CARRIER", "AGENT"];

/** What happened (14513). */
const ACTIVITY_KINDS = ["CALL", "EMAIL", "WHATSAPP", "VISIT", "NOTE"];

/** The list's chips (§3.2), My Next Steps first because it is the default. */
const VIEWS = ["mine", "open", "prospects", "clients", "archived"];

/** The two tiles that are also filters; Open Value is the third (`has_value`). */
const DUE = ["today", "overdue"];

/** The next step a capture proposes when the person changes nothing (§3.2). */
const DEFAULT_NEXT_STEP_ACTION = "Call back";

const text = (max) => z.string().trim().max(max).optional();
const optionalText = (max) => z.preprocess((v) => (v === "" || v === null ? undefined : v), text(max));
const optionalEmail = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.string().trim().email().max(255).optional(),
);
const guid = z.string().guid();

/**
 * When the next step is due: an ISO day ("2026-11-18", read as 09:00 on the
 * tenant's clock) or a moment ("2026-11-18T09:00", "…Z"). The service turns it
 * into an instant with the workspace clock, as a task due date always is.
 */
const dueAt = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/, "expected a date, or a date and time");

/** A next step: what to do, and when. Always dated (owner decision D4). */
const nextStep = z.object({
  action: z.string().trim().min(1).max(200),
  due_at: dueAt,
  // Whose desk it lands on. Defaults to the lead's owner.
  assigned_to: guid.optional().nullable(),
}).strict();

/** Everything about the company itself, as the full form ("More Details") edits it. */
const companyFields = {
  company_name: z.string().trim().min(1).max(255),
  contact_name: optionalText(255),
  email: optionalEmail,
  phone: optionalText(60),
  country: optionalText(120),
  address: optionalText(500),
  niu: optionalText(60),
  rccm: optionalText(60),
  source: z.enum(SOURCES).optional(),
  service_interest: optionalText(255),
  owner_user_id: guid.optional().nullable(),
  entity_id: guid.optional().nullable(),
  client_type_hint: z.enum(CLIENT_TYPES).optional().nullable(),
  payment_terms_days: z.number().int().min(0).max(365).optional().nullable(),
};

const hasContactWay = (v) => Boolean((v.email && String(v.email).trim()) || (v.phone && String(v.phone).trim()));

/**
 * Capture Lead (§3.2): a company or person, ONE way to reach them, and a dated
 * next step. `service_type_id` (What Do They Need?) opens the first request.
 */
const capture = z.object({
  ...companyFields,
  service_type_id: guid.optional().nullable(),
  next_step: nextStep,
  details: z.record(z.string(), z.any()).optional(),
}).strict().refine(hasContactWay, { message: "Give a phone number or an email", path: ["phone"] });

/** Edit the company. The status, the client link and the next step have their own verbs. */
const update = z.object({
  ...Object.fromEntries(Object.entries(companyFields).map(([k, v]) => [k, v.optional()])),
}).strict();

/** "Already here?" — any of the three keys, as the capture form types them. */
const duplicatesQuery = z.object({
  company_name: optionalText(255),
  email: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(255).optional()),
  phone: optionalText(60),
  exclude_id: guid.optional(),
}).refine((v) => Boolean(v.company_name || v.email || v.phone), { message: "Type a company, an email or a phone", path: ["company_name"] });

/** The list (§3.2): a chip, a tile, a search, a page. */
const listQuery = z.object({
  view: z.enum(VIEWS).optional(),
  due: z.enum(DUE).optional(),
  has_value: z.enum(["true", "false"]).optional(),
  q: z.string().trim().max(200).optional(),
  owner_user_id: guid.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
}).passthrough();

/** Log Activity: what happened, optionally about one request. */
const activity = z.object({
  kind: z.enum(ACTIVITY_KINDS),
  body: z.string().trim().min(1).max(2000),
  occurred_at: dueAt.optional(),
  quote_request_id: guid.optional().nullable(),
}).strict();

/**
 * Done on a next step: what happened, and what is next — one write. `next_step`
 * null is only accepted where a lead may have none (a client with nothing
 * open); the service decides. `task_id` is the step being completed, when it
 * was opened from My Workspace (`?done=<task_id>`).
 */
const done = z.object({
  task_id: guid.optional(),
  activity,
  next_step: nextStep.nullable(),
}).strict();

/**
 * Archive, with a reason. A request still open on the company is lost with it,
 * for `reason_code` (default OTHER) and the same line.
 */
const archive = z.object({
  reason: z.string().trim().min(1).max(500),
  reason_code: z.enum(LOST_REASONS).optional(),
}).strict();

/** Reopen an archived company, with its next step. */
const reopen = z.object({ next_step: nextStep }).strict();

/** Make Client: the facts Finance needs, the type and the terms required. */
const clientBlock = z.object({
  entity_id: guid.optional().nullable(),
  name: z.string().trim().min(1).max(255).optional(),
  legal_name: optionalText(255),
  contact_name: optionalText(255),
  country_code: z.string().length(2).optional(),
  email: optionalEmail,
  phone: optionalText(60),
  address: optionalText(500),
  client_type: z.enum(CLIENT_TYPES),
  payment_terms_days: z.number().int().min(0).max(365),
  niu: optionalText(60),
  rccm: optionalText(60),
}).strict();
const makeClient = z.object({ client: clientBlock }).strict();

/* ── the AI (each names the lead in its payload) ─────────────────────────── */

const aiActivity = activity.extend({ lead_id: guid });
const aiNextStep = nextStep.extend({ lead_id: guid });
const aiArchive = archive.extend({ lead_id: guid });
const aiMakeClient = z.object({ lead_id: guid, client: clientBlock }).strict();

module.exports = {
  STATUSES,
  SOURCES,
  CLIENT_TYPES,
  ACTIVITY_KINDS,
  VIEWS,
  DUE,
  DEFAULT_NEXT_STEP_ACTION,
  nextStep,
  capture,
  update,
  duplicatesQuery,
  listQuery,
  activity,
  done,
  archive,
  reopen,
  makeClient,
  aiActivity,
  aiNextStep,
  aiArchive,
  aiMakeClient,
};
