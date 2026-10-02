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
  .number({ invalid_type_error: "Enter the margin as a number." })
  .min(0, "The margin cannot be negative.")
  .lt(100, "The margin must be below 100 %.");

const commercialSettings = z.object({ target_margin_percent: targetMargin }).strict();

const decline = z
  .object({
    reason_code: z.string().trim().min(1, "Choose a reason.").max(60),
    note: z.string().trim().max(400).optional().nullable(),
  })
  .strict();

module.exports = { COSTING_QUOTABLE, familyOrder, fromCosting, targetMargin, commercialSettings, decline };
