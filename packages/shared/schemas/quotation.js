"use strict";
/**
 * Quotations (tenant review, meeting 6, PR 4) — the payloads the staff app and
 * the API must agree on.
 *
 *   fromCosting         "Create quotation" on a costing (G1): which request it
 *                       answers, and when it lapses. Everything else is priced
 *                       by the server from the costing — the client sends no
 *                       lines and no prices.
 *   familyOrder         the order a document prints its client families in
 *                       (G2): heading keys, a CLIENT_HEADING code or
 *                       "custom:<text>".
 *   commercialSettings  Settings › Commercial: the target margin a quotation
 *                       priced from a costing applies to its services.
 *   decline             a client declining in the portal (G4) — a reason from
 *                       the signature programme's DECLINE list, and their words.
 *   COSTING_QUOTABLE    the costing statuses "Create quotation" is offered on;
 *                       the button is disabled with the reason on any other.
 */
const { z } = require("zod");
const { uuid, isoDate } = require("./common");

/**
 * Validated or approved (auditor default, recorded in the register):
 * SUBMITTED_FOR_APPROVAL has passed its validator; APPROVED_LOCKED is
 * approved; UNLOCK_REQUESTED is still approved while the reopening is decided.
 */
const COSTING_QUOTABLE = Object.freeze(["SUBMITTED_FOR_APPROVAL", "APPROVED_LOCKED", "UNLOCK_REQUESTED"]);

const familyKey = z.string().trim().min(1, "A family needs a name.").max(160);
const familyOrder = z.array(familyKey).max(60, "At most 60 families.");

const fromCosting = z
  .object({
    // undefined = the suggested request; null = link none; an id = that one.
    quote_request_id: uuid.nullable().optional(),
    valid_until: isoDate.nullable().optional(),
  })
  .strict();

const targetMargin = z
  .number({
    // Zod 4's `error` replaces `invalid_type_error`: a present value of the wrong type gets this
    // sentence, a missing one still reads "Required".
    error: (iss) => (iss.code === "invalid_type" && iss.input !== undefined ? "Enter the margin as a number." : undefined),
  })
  .min(0, "The margin cannot be negative.")
  .lt(100, "The margin must be below 100 %.");

const commercialSettings = z.object({ target_margin_percent: targetMargin }).strict();

const decline = z
  .object({
    reason_code: z.string().trim().min(1, "Choose a reason.").max(60),
    note: z.string().trim().max(400).optional().nullable(),
  })
  .strict();

/* ── one document, Full Proposal or Commercial Extract (lean revamp, PR 4) ──
 *
 * doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.4, §3.5, §4.6; owner decisions D6, D7,
 * D8. The vocabularies below are the ones the quotation table cannot hold as a
 * CHECK (14540, the 13791 rule): the service validates against these, and the
 * editor (PR 6) offers exactly these.
 */

/** The fixed library, in its fixed print order. Nothing reorders it. */
const SECTION_KEYS = Object.freeze([
  "cover", "about_us", "needs", "solution", "scope", "pricing", "terms", "case_stories", "next_steps",
]);
/** What a Commercial Extract prints: the letterhead cover, the price and how to say yes. */
const EXTRACT_SECTIONS = Object.freeze(["cover", "pricing", "terms", "next_steps"]);
/** Sections whose words a person writes on the quotation (the rest are automatic). */
const TEXT_SECTIONS = Object.freeze(["needs", "solution", "scope", "terms"]);
/** Sections a TEMPLATE carries default words for (§3.5). */
const TEMPLATE_TEXT_SECTIONS = Object.freeze(["solution", "scope", "terms"]);
/** Always printed, whatever the switch says. */
const ALWAYS_ON = Object.freeze(["pricing"]);
const LANGUAGES = Object.freeze(["EN", "FR", "BILINGUAL"]);
const OUTPUTS = Object.freeze(["FULL", "EXTRACT"]);
/** At most three Case Stories on a proposal. */
const MAX_STORIES = 3;
const MAX_SECTION_TEXT = 20000;

const sectionText = z.string().max(MAX_SECTION_TEXT, "At most 20,000 characters.").nullable().optional();

/** One section of a quotation as the editor saves it. */
const section = z
  .object({
    section_key: z.enum(SECTION_KEYS),
    enabled: z.boolean().optional(),
    body_en: sectionText,
    body_fr: sectionText,
    story_ids: z.array(uuid).max(MAX_STORIES, "At most three case stories.").optional(),
  })
  .strict()
  .refine((s) => !(ALWAYS_ON.includes(s.section_key) && s.enabled === false), {
    message: "Pricing is always printed.",
    path: ["enabled"],
  });

const sections = z
  .array(section)
  .max(SECTION_KEYS.length)
  .refine((list) => new Set(list.map((s) => s.section_key)).size === list.length, {
    message: "Each section appears once.",
  });

/** The header fields the one document adds to a quotation. */
const documentFields = {
  lead_id: uuid.nullable().optional(),
  title: z.string().trim().max(200, "At most 200 characters.").nullable().optional(),
  language: z.enum(LANGUAGES).optional(),
  default_output: z.enum(OUTPUTS).optional(),
  template_id: uuid.nullable().optional(),
};

/** A template's defaults for one section (the leanest builder: on/off, words per language). */
const templateSection = z
  .object({
    enabled: z.boolean().optional(),
    body_en: sectionText,
    body_fr: sectionText,
  })
  .strict();

const templateSections = z
  .partialRecord(z.enum(SECTION_KEYS), templateSection)
  .refine((m) => !(m.pricing && m.pricing.enabled === false), { message: "Pricing is always printed." });

const template = z
  .object({
    name: z.string().trim().min(1, "Give the template a name.").max(120, "At most 120 characters."),
    service_type_ids: z.array(uuid).max(50).optional(),
    is_default: z.boolean().optional(),
    sections: templateSections.optional(),
  })
  .strict();

const templatePatch = template.partial().extend({ active: z.boolean().optional() }).strict();

const emailAddress = z.string().trim().email("Enter a valid email address.").max(320);

/** Send (§3.4): to, cc, subject, message, the output and the language to attach. */
const send = z
  .object({
    to: emailAddress,
    cc: z.array(emailAddress).max(10, "At most ten copies.").optional(),
    subject: z.string().trim().min(1, "Write a subject.").max(200, "At most 200 characters."),
    message: z.string().trim().max(5000, "At most 5,000 characters.").optional().nullable(),
    output: z.enum(OUTPUTS).optional(),
    language: z.enum(["EN", "FR"]).optional(),
    entity_id: uuid.nullable().optional(),
    // "Follow up quotation" in three working days, proposed and on by default.
    follow_up: z.boolean().optional(),
  })
  .strict();

/** Revise: nothing to say, the copy is the quotation itself. */
const revise = z.object({}).strict();

/** A share link minted by hand (Copy Link), valid until the offer lapses at the latest. */
const share = z.object({ expires_on: isoDate.nullable().optional() }).strict();

/** Record Acceptance by staff (§3.4): who at the client said yes, optionally convert. */
const recordAcceptance = z
  .object({
    convert: z.boolean().optional(),
    by_name: z.string().trim().max(200).nullable().optional(),
    by_email: emailAddress.nullable().optional(),
  })
  .strict();

/** On the link: who is accepting, before the emailed code (§3.4 "The link"). */
const linkAcceptStart = z
  .object({
    full_name: z.string().trim().min(2, "Enter your full name.").max(200),
    role: z.string().trim().max(120).nullable().optional(),
  })
  .strict();

/** On the link: the code, and the stamp or the drawn mark. */
const linkAcceptComplete = z
  .object({
    code: z.string().trim().regex(/^\d{6}$/, "Enter the six-digit code."),
    preset_code: z.enum(["STAMP", "DRAWN"]),
    full_name: z.string().trim().min(2, "Enter your full name.").max(200),
    role: z.string().trim().max(120).nullable().optional(),
    mark_image_b64: z.string().max(400000).nullable().optional(),
  })
  .strict();

/** On the link, where the tenant offers no e-signature: a confirmed accept, named. */
const linkAcceptConfirm = linkAcceptStart;

/** The AI's "Draft With AI" (§3.4): which sections, from the discovery and the profile. */
const draftSections = z
  .object({
    sections: z.array(z.enum(["needs", "solution"])).min(1).optional(),
    client_operations: z.string().max(10000).optional(),
    pain_points: z.string().max(10000).optional(),
    proposed_strategy: z.string().max(10000).optional(),
    tone: z.string().max(200).optional(),
  })
  .strict();

module.exports = {
  COSTING_QUOTABLE, familyOrder, fromCosting, targetMargin, commercialSettings, decline,
  SECTION_KEYS, EXTRACT_SECTIONS, TEXT_SECTIONS, TEMPLATE_TEXT_SECTIONS, ALWAYS_ON, LANGUAGES, OUTPUTS, MAX_STORIES,
  section, sections, documentFields, templateSection, templateSections, template, templatePatch,
  send, revise, share, recordAcceptance, linkAcceptStart, linkAcceptComplete, linkAcceptConfirm, draftSections,
};
