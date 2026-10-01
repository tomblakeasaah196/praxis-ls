"use strict";
/**
 * Client portal — the staff half's payloads (tenant review 29 Sep 2026, PR 1).
 *
 * Shared because each one is a FORM in the staff app as well as an endpoint:
 *
 *   documentRequests  "Request from client" on Client 360 › Documents — one or
 *                     several client document types (or "Other — describe
 *                     it"), a note and a due date. One portal request per type.
 *   reviewRequest     Accept / Send back / Cancel on what a client sent, with
 *                     the fields an accepted KYC document is filed with. Which
 *                     of those a type REQUIRES is `acceptFieldsFor` below — the
 *                     Accept dialog asks for exactly those, and the API refuses
 *                     an accept without them, from the one rule.
 *   messageEmail      "Send by email" on a team message: who it goes to, and a
 *                     key that makes a double click or a retry send once.
 *
 * Shape only, like every schema here. Whether a type exists, is active, or a
 * recipient may receive a message is the service's to decide.
 */
const { z } = require("zod");
const { uuid, optionalDate, blankToUndefined } = require("./common");

const boundedText = (max) => blankToUndefined(z.string().trim().max(max));

/** One thing asked for: a client document type, or a document that has none yet. */
const documentRequestItem = z.union([
  z.object({ document_type_id: uuid }).strict(),
  z
    .object({
      other: z
        .string()
        .trim()
        .min(2, "Describe the document you need.")
        .max(200),
    })
    .strict(),
]);

/** POST /portal/clients/:clientId/document-requests */
const documentRequests = z
  .object({
    items: z
      .array(documentRequestItem)
      .min(1, "Pick at least one document.")
      .max(20, "Ask for at most 20 documents at once."),
    note: boundedText(2000),
    due_on: optionalDate,
  })
  .strict();

/** The fields an accepted client document is filed with on the Client 360. */
const acceptDocument = z
  .object({
    issued_on: optionalDate,
    expires_on: optionalDate,
    issuing_authority: boundedText(200),
  })
  .strict();

/** POST /portal/client-requests/:id/review */
const reviewRequest = z.object({
  decision: z.enum(["ACCEPT", "REJECT", "CANCEL"]),
  note: z.string().trim().max(1000).optional().nullable(),
  document: acceptDocument.optional().nullable(),
});

/**
 * Which accept fields a client document type requires (owner decision D1:
 * "asked only when that document type requires them"). A type that carries an
 * expiry needs it — a document with no expiry on file reads as valid for ever —
 * and one with an issuing authority needs that. The issue date is offered with
 * either, never required.
 *
 * The document NUMBER is not here, on purpose: `client_document.document_number`
 * is the system reference the allocator assigns on save (0664, nested.js), the
 * same one the Documents tab's "Add document" shows as "Assigned on save".
 */
function acceptFieldsFor(type) {
  const t = type || {};
  const expiry = t.requires_expiry === true;
  const authority = t.requires_issuing_authority === true;
  return {
    asks: expiry || authority,
    issued_on: expiry || authority,
    expires_on: expiry,
    issuing_authority: authority,
  };
}

/** The required accept fields left blank, e.g. ["expires_on"]. */
function missingAcceptFields(type, document) {
  const need = acceptFieldsFor(type);
  const d = document || {};
  const blank = (v) => v === undefined || v === null || String(v).trim() === "";
  return ["expires_on", "issuing_authority"].filter((k) => need[k] && blank(d[k]));
}

/** POST /portal/chat/messages/:messageId/email */
const messageEmail = z
  .object({
    recipients: z
      .array(z.string().trim().toLowerCase().email("Not an email address."))
      .min(1, "Choose who receives it.")
      .max(30),
    request_key: uuid,
  })
  .strict();

// Named `exports.x =` assignments, NOT `module.exports = { x }` — see index.js.
exports.documentRequestItem = documentRequestItem;
exports.documentRequests = documentRequests;
exports.acceptDocument = acceptDocument;
exports.reviewRequest = reviewRequest;
exports.acceptFieldsFor = acceptFieldsFor;
exports.missingAcceptFields = missingAcceptFields;
exports.messageEmail = messageEmail;
