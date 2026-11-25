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

/**
 * The deal's stage (14511, owner decision D3). Fixed, never configurable: New,
 * Contacted, Meeting, Quoted, then Won or Lost. Won comes from an accepted
 * quotation or Mark Won, never from a click on the bar, because a win opens the
 * operations file.
 */
const STAGES = ["NEW", "CONTACTED", "MEETING", "QUOTED", "WON", "LOST"];
/** The stages a request is still being worked in. */
const OPEN_STAGES = ["NEW", "CONTACTED", "MEETING", "QUOTED"];
/** The stages a person may click on the bar (Lost asks why). */
const MOVABLE_STAGES = ["NEW", "CONTACTED", "MEETING", "QUOTED", "LOST"];
/** Why a deal was lost (§3.2). */
const LOST_REASONS = ["PRICE", "TIMING", "COMPETITOR", "NO_RESPONSE", "OTHER"];
/** The two channels whose wizards ask for an Incoterm, so one is owed. */
const INCOTERM_REQUIRED_CHANNELS = ["WEBSITE", "PORTAL"];

/**
 * Where a request came from. PORTAL since 10705; EMAIL for a request keyed in
 * from a mail thread (14310 moved this list from a CHECK constraint into this
 * shape — see that migration for why). CAMPAIGN left with Campaigns (14512).
 */
const INTAKE_CHANNELS = ["MANUAL", "WEBSITE", "PORTAL", "EMAIL", "REFERRAL"];

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
 * it is won or lost: the file it opened, and the history the client read in
 * their portal, belong to the client it had then.
 */
const canRelink = (stage) => {
  const v = String(stage || "");
  return v !== "WON" && v !== "LOST";
};

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
  entity_id: z.string().guid().optional().nullable(),
  lead_id: z.string().guid().optional().nullable(),
  // The client a request is FOR (owner decision Q5). A linked request appears
  // in that client's portal and takes their account manager as owner.
  client_id: z.string().guid().optional().nullable(),
  intake_channel: z.enum(INTAKE_CHANNELS).optional(),
  requester_name: text(255),
  requester_company: text(255),
  requester_email: optionalEmail,
  requester_phone: text(255),
  // The service, structured. `service_category` is written by the server from
  // its name; a caller that sends only the words (an older client, the AI)
  // still lands, as free text.
  service_type_id: z.string().guid().optional().nullable(),
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
  owner_user_id: z.string().guid().optional().nullable(),
  // 14511 — the deal the request carries: what it is called when it was typed
  // by hand, and what it is worth.
  title: text(255),
  estimated_value: z.number().nonnegative().max(1e15).optional().nullable(),
  currency: z.string().trim().length(3).transform((v) => v.toUpperCase()).optional().nullable(),
  // origin_place_id / destination_place_id / attachment_doc_id (and 14220's
  // collection_place_id / delivery_place_id) are deliberately NOT here. They
  // are written by the intake paths that earn them — the coordinates come from
  // re-querying the provider, the document from the vault's own sniffing write.
  // A PATCH that could set attachment_doc_id to any uuid would let a staff user
  // hang any document in the vault off any quote request: the shape of an IDOR.
};

/**
 * Capture a request at the desk. A request typed by hand from a phone call may
 * not know its Incoterm yet (14511); one arriving through a wizard that asks
 * for it (the website, the portal) owes one.
 */
const staffCreate = z.object({ ...staffFields }).superRefine((v, ctx) => {
  if (INCOTERM_REQUIRED_CHANNELS.includes(v.intake_channel) && !v.incoterm) {
    ctx.addIssue({ code: "custom", path: ["incoterm"], message: "Required" });
  }
});
/** Edit one. Every field optional; the service refuses a terminal request. */
const staffUpdate = z.object({ ...staffFields });

/** A lost deal says why: one of five reasons, and a line. */
const lostReason = {
  lost_reason_code: z.enum(LOST_REASONS).optional(),
  lost_reason: z.string().trim().max(500).optional().nullable(),
};
const requireReasonWhenLost = (v, ctx) => {
  if (v.stage === "LOST" && !v.lost_reason_code) {
    ctx.addIssue({ code: "custom", path: ["lost_reason_code"], message: "Say why it was lost" });
  }
};

/** Click a stage on the bar. Won is not here: it goes through Mark Won. */
const moveStage = z.object({ stage: z.enum(MOVABLE_STAGES), ...lostReason }).strict().superRefine(requireReasonWhenLost);

/**
 * Mark Won by hand (§3.2): the same win an accepted quotation makes. The
 * entity is only asked for when the tenant has several and the request names
 * none: it decides whose counter numbers the operations file.
 */
const markWon = z.object({ entity_id: z.string().guid().optional().nullable() }).strict();

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
  chat_attachment_id: z.string().guid(),
  document_kind: z.enum(DOCUMENT_KINDS).optional().nullable(),
}).strict();

/** "Who is this?" — the client a requester's address belongs to. */
const clientMatchQuery = z.object({ email: z.string().trim().email().max(255) });

/* ── the AI (each carries the request id in its payload) ─────────────────── */

// The AI moves a deal between WORKING stages under `edit`; losing one is its
// own action under `approve`, as the stage route gates LOST.
const aiMoveStage = z.object({ quote_request_id: z.string().guid(), stage: z.enum(OPEN_STAGES) }).strict();
const aiMarkLost = z.object({
  quote_request_id: z.string().guid(),
  lost_reason_code: z.enum(LOST_REASONS),
  lost_reason: z.string().trim().max(500).optional().nullable(),
}).strict();
const aiMarkWon = z.object({ quote_request_id: z.string().guid(), entity_id: z.string().guid().optional().nullable() }).strict();
const aiLinkClient = z.object({ quote_request_id: z.string().guid(), client_id: z.string().guid() });
const aiFileFromChat = z.object({
  quote_request_id: z.string().guid(),
  chat_attachment_id: z.string().guid(),
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

/**
 * What the visitor answered in the quote engine's questions (14640). Codes
 * only; the server runs `rules/quote-engine.js` over them and refuses any
 * answer that is not one of the choices it offers. Nothing the browser says
 * about the OUTCOME is read: the type, the term and the scope are the
 * server's own evaluation.
 */
const answerCode = z.string().trim().max(64).optional();
const quoteAnswers = z.object({
  direction: answerCode,
  knows: answerCode,
  incoterm: answerCode,
  party: answerCode,
  start: answerCode,
  end: answerCode,
  insured: answerCode,
  member: answerCode,
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
  service_type_id: z.string().guid().optional(),
  hinterland_direction: hinterlandDirection.optional(),
  // The website service the visitor picked (14640) and their answers. When
  // present, the server resolves the service type, the Incoterm and the
  // scope from them, and `service_type_id` / `incoterm` are not read.
  website_service_id: z.string().guid().optional(),
  quote_answers: quoteAnswers.optional(),
  service_category: z.string().max(255).optional(),
  origin_location: z.string().max(255).optional(),
  destination_location: z.string().max(255).optional(),
  cargo_description: z.string().max(5000).optional(),
  // Required on the older path; the engine supplies it when a website service
  // is named (refined below).
  incoterm: z.string().min(1).max(30).optional(),
  entity_id: z.string().guid().optional(),
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
}).strict().superRefine((v, ctx) => {
  if (!v.website_service_id && !v.incoterm) {
    ctx.addIssue({ code: "custom", path: ["incoterm"], message: "Required" });
  }
});

/* ── the client portal ────────────────────────────────────────────────────── */

/**
 * One end of the route as the portal sends it: a place the client can see by
 * its id, or a worldwide suggestion by the provider's id (portal_places
 * resolves either, and never another client's door).
 */
const portalPlacePick = z
  .union([
    z.object({ geo_place_id: z.string().guid() }).strict(),
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
  doc_id: z.string().guid(),
  document_kind: z.enum(DOCUMENT_KINDS),
}).strict();

/** The most documents one request can be sent with (more can follow). */
const PORTAL_DOCUMENTS_MAX = 10;

/**
 * A signed-in client's request. `client_id` is never accepted — the grant
 * decides the client. At least ONE document (owner decision Q4): the desk
 * prices from it, and the commercial invoice is the one the wizard asks for.
 */
/**
 * A place the wizard may leave empty: "" (a cleared field) is ABSENT, never a
 * stored empty string — a port-to-port request names no doors, and "" on the
 * row would read as a door nobody named. The portal validator did this before
 * the shape moved here, and portal-places.test.js holds it.
 */
const portalPlaceText = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.string().trim().max(200).optional(),
);

const portalCreate = z.object({
  service_type_id: z.string().guid(),
  hinterland_direction: hinterlandDirection.optional().nullable(),
  // 200, not 120: a picked address arrives as the provider's formatted line.
  // Optional here because a STORAGE or a no-movement service has no route —
  // the service requires both ends for a ROUTE service.
  origin_location: portalPlaceText,
  destination_location: portalPlaceText,
  collection_location: portalPlaceText,
  delivery_location: portalPlaceText,
  origin_place: portalPlacePick,
  destination_place: portalPlacePick,
  collection_place: portalPlacePick,
  delivery_place: portalPlacePick,
  warehouse_location: portalPlaceText,
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
  STAGES,
  OPEN_STAGES,
  MOVABLE_STAGES,
  LOST_REASONS,
  INCOTERM_REQUIRED_CHANNELS,
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
  moveStage,
  markWon,
  attachment,
  fromChat,
  clientMatchQuery,
  aiMoveStage,
  aiMarkLost,
  aiMarkWon,
  aiLinkClient,
  aiFileFromChat,
  publicQuote,
  quoteAnswers,
  portalCreate,
  portalDocumentUpload,
};
