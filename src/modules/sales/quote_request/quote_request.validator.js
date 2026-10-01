"use strict";
/**
 * Quote request (MOD-20-intake) — the API's adapter onto the shared shapes.
 *
 * Every rule lives in `@praxis/shared` schemas/quote-request.js, which the
 * staff form validates with too (meeting 6, PR 2): "a valid request" is one
 * definition for the desk, the portal and the website, and a field the form
 * believes legal is a field this route accepts. This file only turns a parse
 * failure into the 422 the rest of the API answers with.
 *
 * `incoterm` is required on create (the legacy drawer marked it required); the
 * service then checks it against the chosen service type's own list.
 */
const { quoteRequest } = require("@praxis/shared");
const { AppError } = require("../../../utils/errors");

const schemas = {
  create: quoteRequest.staffCreate,
  update: quoteRequest.staffUpdate,
  transition: quoteRequest.transition,
  convertToOpportunity: quoteRequest.convert,
  attachment: quoteRequest.attachment,
  fromChat: quoteRequest.fromChat,
  clientMatch: quoteRequest.clientMatchQuery,
  // AI-facing variants carry quote_request_id in the payload.
  aiTransition: quoteRequest.aiTransition,
  aiConvert: quoteRequest.aiConvert,
  aiLinkClient: quoteRequest.aiLinkClient,
  aiFileFromChat: quoteRequest.aiFileFromChat,
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

/** The same, for a GET's query string — parsed into `req.validatedQuery`. */
const mwQuery = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.query);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid query", 422, p.error.flatten().fieldErrors));
  req.validatedQuery = p.data;
  return next();
};

module.exports = {
  create: mw("create"),
  update: mw("update"),
  transition: mw("transition"),
  convertToOpportunity: mw("convertToOpportunity"),
  attachment: mw("attachment"),
  fromChat: mw("fromChat"),
  clientMatch: mwQuery("clientMatch"),
  schemas,
  INTAKE_CHANNEL: quoteRequest.INTAKE_CHANNELS,
  WAREHOUSE_DURATION: quoteRequest.WAREHOUSE_DURATIONS,
};
