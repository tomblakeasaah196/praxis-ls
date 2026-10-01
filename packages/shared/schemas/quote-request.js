"use strict";
/**
 * Quote request (MOD-20-intake) — every payload, for every door a request
 * comes in by (tenant review, meeting 6, PR 2).
 *
 * ── ONE INTAKE MODEL ────────────────────────────────────────────────────────
 *
 * A request reaches the tenant three ways — the public website, the client
 * portal, and staff keying one in from an email — and the three used to
 * disagree about what a request IS: the website dropped the service id it
 * knew, the portal stored translated words and regex-parsed them back, the
 * desk picked from a hard-coded list of ten that missed Rail, Customs and
 * Project Cargo. All three now send a `service_type_id`, validated here, and
 * the server writes `service_category` as a display copy of the service's
 * name so exports, leads and the AI keep reading what they always read.
 *
 * The staff form, the API's adapter (`quote_request.validator.js`), the public
 * intake and the portal's create route all parse with these shapes. The website
 * and the portal bundles do not import this package (their first-paint budget);
 * what they send is held to these shapes at the API.
 *
 * ── WHAT IS NOT HERE ────────────────────────────────────────────────────────
 *
 * Rules that need the DATABASE — is the service type active, does it offer this
 * Incoterm, does a ROUTE service have its two ends, do these documents belong to
 * this client — are the service's (`quote_request.service.js`). A shape cannot
 * know which service the id names.
 */

const { z } = require("zod");
const { HINTERLAND_DIRECTIONS } = require("../rules/service-scope");

/** The intake lifecycle (0683). The API's rules module reads this list. */
const STATUSES = [
  "RECEIVED",
  "UNDER_REVIEW",
  "CLARIFICATION_REQUIRED",
  "QUOTED",
  "CONVERTED_TO_OPPORTUNITY",
  "CLOSED_NO_ACTION",
];

/** States in which nothing may be edited, attached or re-linked any more. */
const TERMINAL = ["CONVERTED_TO_OPPORTUNITY", "CLOSED_NO_ACTION"];

/**
 * Where a request came from. PORTAL since 10705; EMAIL for a request keyed in
 * from a mail thread (14310 moved this list from a CHECK constraint into this
 * shape — see that migration for why).
 */
const INTAKE_CHANNELS = ["MANUAL", "WEBSITE", "PORTAL", "EMAIL", "REFERRAL", "CAMPAIGN"];

/** How long the goods stay — the CHECK on quote_request (0683). */
const WAREHOUSE_DURATIONS = [
  "LESS_THAN_7_DAYS",
  "DAYS_7_TO_14",
  "DAYS_15_TO_30",
  "OVER_30_DAYS",
  "UNKNOWN",
];

/**
 * What a document sent with a request IS (owner decision Q4). The commercial
 * invoice is first and the one the wizard recommends: it is what lets the desk
 * price. Stored on the link (`quote_request_attachment.document_kind`), not on
 * the vault row, because the same file can be a proforma to one request and
 * nothing in particular to another.
 */
const DOCUMENT_KINDS = [
  "COMMERCIAL_INVOICE",
  "PROFORMA",
  "PACKING_LIST",
  "BL_AWB",
  "CARGO_PHOTOS",
  "OTHER",
];

/**
 * Whether a request may be tied to a client, or moved to another one. Not once
 * it is converted or closed: the opportunity it became, and the history the
 * client read in their portal, belong to the client it had then.
 */
const canRelink = (status) => !TERMINAL.includes(String(status || ""));

const text = (max) => z.string().trim().max(max).optional();
/** An email box a form may leave empty: `""` reads as "not given". */
const optionalEmail = z.string().trim().email().max(255).optional().or(z.literal("").transform(() => undefined));

/**
 * The delivery term as the wire carries it: an ICC code, `TBD` (not sure) or
 * `N/A` (the service has none). Upper-cased so `fob` and `FOB` are one answer.
 * Which codes a given request may use is the service type's list — checked by
 * the service, which can see it.
 */
const incoterm = z.string().trim().min(1).max(30).transform((v) => v.toUpperCase());

const hinterlandDirection = z.enum(HINTERLAND_DIRECTIONS);

/* ── the desk ─────────────────────────────────────────────────────────────── */

const staffFields = {
  // Which corporate entity the enquiry belongs to. Optional: the service
  // resolves it from the linked lead, or from the tenant's only active entity,
  // and 422s naming this field when a tenant has several.
  entity_id: z.string().uuid().optional().nullable(),
  lead_id: z.string().uuid().optional().nullable(),
  // The client a request is FOR (owner decision Q5). A linked request appears
  // in that client's portal and takes their account manager as owner.
  client_id: z.string().uuid().optional().nullable(),
  intake_channel: z.enum(INTAKE_CHANNELS).optional(),
  requester_name: text(255),
  requester_company: text(255),
  requester_email: optionalEmail,
  requester_phone: text(255),
  // The service, structured. `service_category` is written by the server from
  // its name; a caller that sends only the words (an older client, the AI)
  // still lands, as free text.
  service_type_id: z.string().uuid().optional().nullable(),
  hinterland_direction: hinterlandDirection.optional().nullable(),
  service_category: text(255),
  service_type: text(255),
  origin_location: text(255),
  destination_location: text(255),
  // 14220 — the doors either side of the main leg.
  collection_location: text(255),
  delivery_location: text(255),
  warehouse_location: text(255),
  warehouse_duration: z.enum(WAREHOUSE_DURATIONS).optional().nullable(),
  estimated_weight: z.number().nonnegative().optional().nullable(),
  project_cargo_flag: z.boolean().optional(),
  cargo_description: text(5000),
  additional_notes: text(5000),
  incoterm: incoterm.optional(),
  owner_user_id: z.string().uuid().optional().nullable(),
  // origin_place_id / destination_place_id / attachment_doc_id (and 14220's
  // collection_place_id / delivery_place_id) are deliberately NOT here. They
  // are written by the intake paths that earn them — the coordinates come from
  // re-querying the provider, the document from the vault's own sniffing write.
  // A PATCH that could set attachment_doc_id to any uuid would let a staff user
  // hang any document in the vault off any quote request: the shape of an IDOR.
};

/** Capture a request at the desk. `incoterm` is required (the legacy drawer's mark). */
const staffCreate = z.object({ ...staffFields, incoterm });
/** Edit one. Every field optional; the service refuses a terminal request. */
const staffUpdate = z.object({ ...staffFields });

const transition = z.object({ to: z.enum(STATUSES) });

const opportunity = z.object({
  name: z.string().min(1),
  estimated_value: z.number().nonnegative().optional().nullable(),
  currency: z.string().length(3).optional(),
  owner_user_id: z.string().uuid().optional().nullable(),
});
const convert = z.object({ opportunity });

/**
 * A staff upload. `file` is a base64 data URL; the vault sniffs the bytes and
 * enforces the type and size ceilings, so this only bounds what is cheap to
 * bound here — 15 MB of base64 is ~11 MB of file, above the vault's 10 MB.
 */
const attachment = z.object({
  file: z.string().min(1).max(15 * 1024 * 1024).regex(/^data:[^;]+;base64,/, "expected a base64 data URL"),
  filename: z.string().trim().max(255).optional().nullable(),
  kind: z.enum(["PRIMARY", "ADDITIONAL"]).optional(),
  document_kind: z.enum(DOCUMENT_KINDS).optional().nullable(),
});

/** "File on a quote request" — a file a client sent in the chat, linked, not copied. */
const fromChat = z.object({
  chat_attachment_id: z.string().uuid(),
  document_kind: z.enum(DOCUMENT_KINDS).optional().nullable(),
}).strict();

/** "Who is this?" — the client a requester's address belongs to. */
const clientMatchQuery = z.object({ email: z.string().trim().email().max(255) });

/* ── the AI (each carries the request id in its payload) ─────────────────── */

const aiTransition = z.object({ quote_request_id: z.string().uuid(), to: z.enum(STATUSES) });
const aiConvert = z.object({ quote_request_id: z.string().uuid(), opportunity });
const aiLinkClient = z.object({ quote_request_id: z.string().uuid(), client_id: z.string().uuid() });
const aiFileFromChat = z.object({
  quote_request_id: z.string().uuid(),
  chat_attachment_id: z.string().uuid(),
  document_kind: z.enum(DOCUMENT_KINDS).optional().nullable(),
});

/* ── the public website ───────────────────────────────────────────────────── */

/**
 * A place the requester picked from OUR picker, not a coordinate they typed.
 * Only the provider's id and the text that produced it travel; the server
 * re-runs the search and takes the provider's own coordinate (a body that
 * could carry a coordinate could carry any, stored as provider-vouched).
 */
const publicPlacePick = z.object({
  provider_place_id: z.string().min(1).max(300),
  query: z.string().min(1).max(255),
  country: z.string().length(2).optional(),
}).strict();

/** The website's documents: up to three, base64 in the body (careers' transport). */
const PUBLIC_DOCUMENTS_MAX = 3;
/** Per file, after compression — the vault re-checks the decoded bytes. */
const PUBLIC_DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;
/** All files together, so the body stays inside its raised limit (shared/http/body-limits). */
const PUBLIC_DOCUMENTS_TOTAL_BYTES = 12 * 1024 * 1024;

const publicDocument = z.object({
  data_url: z.string().min(1).max(12_000_000),
  filename: z.string().max(200).optional(),
  document_kind: z.enum(DOCUMENT_KINDS).optional(),
}).strict();

const publicQuote = z.object({
  // The spam trap, read and stripped by the intake middleware.
  website_url: z.string().max(0).optional(),
  form_started_at: z.number().int().optional(),
  requester_name: z.string().max(255).optional(),
  requester_company: z.string().max(255).optional(),
  requester_email: z.string().email().max(255).optional(),
  requester_phone: z.string().max(60).optional(),
  // The published service the visitor picked. Validated server-side as an
  // ACTIVE, PUBLISHED service — anything else is a 422 naming this field.
  service_type_id: z.string().uuid().optional(),
  hinterland_direction: hinterlandDirection.optional(),
  service_category: z.string().max(255).optional(),
  origin_location: z.string().max(255).optional(),
  destination_location: z.string().max(255).optional(),
  cargo_description: z.string().max(5000).optional(),
  incoterm: z.string().min(1).max(30),
  entity_id: z.string().uuid().optional(),
  estimated_weight: z.coerce.number().nonnegative().max(1e9).optional(),
  project_cargo_flag: z.boolean().optional(),
  warehouse_location: z.string().max(255).optional(),
  warehouse_duration: z.enum(WAREHOUSE_DURATIONS).optional(),
  additional_notes: z.string().max(5000).optional(),
  origin_place: publicPlacePick.optional(),
  destination_place: publicPlacePick.optional(),
  documents: z.array(publicDocument).max(PUBLIC_DOCUMENTS_MAX).optional(),
  // The single-file field the form sent before `documents`; a tab still
  // running the old bundle keeps working until it reloads.
  attachment_data_url: z.string().max(12_000_000).optional(),
  attachment_filename: z.string().max(200).optional(),
}).strict();

/* ── the client portal ────────────────────────────────────────────────────── */

/**
 * One end of the route as the portal sends it: a place the client can see by
 * its id, or a worldwide suggestion by the provider's id (portal_places
 * resolves either, and never another client's door).
 */
const portalPlacePick = z
  .union([
    z.object({ geo_place_id: z.string().uuid() }).strict(),
    z.object({
      provider_place_id: z.string().trim().min(1).max(300),
      query: z.string().trim().min(1).max(200),
      country: z.string().trim().regex(/^[A-Za-z]{2}$/).optional(),
    }).strict(),
  ])
  .nullable()
  .optional();

/** A document the client uploaded first (staged), then named here by id. */
const portalDocument = z.object({
  doc_id: z.string().uuid(),
  document_kind: z.enum(DOCUMENT_KINDS),
}).strict();

/** The most documents one request can be sent with (more can follow). */
const PORTAL_DOCUMENTS_MAX = 10;

/**
 * A signed-in client's request. `client_id` is never accepted — the grant
 * decides the client. At least ONE document (owner decision Q4): the desk
 * prices from it, and the commercial invoice is the one the wizard asks for.
 */
const portalCreate = z.object({
  service_type_id: z.string().uuid(),
  hinterland_direction: hinterlandDirection.optional().nullable(),
  // 200, not 120: a picked address arrives as the provider's formatted line.
  // Optional here because a STORAGE or a no-movement service has no route —
  // the service requires both ends for a ROUTE service.
  origin_location: z.string().trim().max(200).optional(),
  destination_location: z.string().trim().max(200).optional(),
  collection_location: z.string().trim().max(200).optional(),
  delivery_location: z.string().trim().max(200).optional(),
  origin_place: portalPlacePick,
  destination_place: portalPlacePick,
  collection_place: portalPlacePick,
  delivery_place: portalPlacePick,
  warehouse_location: z.string().trim().max(200).optional(),
  warehouse_duration: z.enum(WAREHOUSE_DURATIONS).optional(),
  estimated_weight: z.number().nonnegative().optional(),
  cargo_description: z.string().max(2000).optional(),
  // Absent = "Not sure"; the service files it as TBD.
  incoterm: z.string().trim().max(30).optional(),
  documents: z.array(portalDocument).min(1, "Add at least one document — a commercial invoice is best.").max(PORTAL_DOCUMENTS_MAX),
}).strict();

/** The type a staged or added portal document is uploaded as (multipart field). */
const portalDocumentUpload = z.object({ document_kind: z.enum(DOCUMENT_KINDS).optional() });

module.exports = {
  STATUSES,
  TERMINAL,
  INTAKE_CHANNELS,
  WAREHOUSE_DURATIONS,
  DOCUMENT_KINDS,
  PUBLIC_DOCUMENTS_MAX,
  PUBLIC_DOCUMENT_MAX_BYTES,
  PUBLIC_DOCUMENTS_TOTAL_BYTES,
  PORTAL_DOCUMENTS_MAX,
  canRelink,
  staffCreate,
  staffUpdate,
  transition,
  convert,
  attachment,
  fromChat,
  clientMatchQuery,
  aiTransition,
  aiConvert,
  aiLinkClient,
  aiFileFromChat,
  publicQuote,
  portalCreate,
  portalDocumentUpload,
};
