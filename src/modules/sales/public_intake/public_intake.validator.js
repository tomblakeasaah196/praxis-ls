"use strict";
/**
 * The public intake's shapes. The QUOTE shape is `@praxis/shared`'s
 * (quoteRequest.publicQuote, meeting 6 PR 2) — one definition of a quote
 * request for the website, the portal and the desk, with the service id, the
 * hinterland direction and up to three documents. The contact and message
 * shapes have never been shared and stay here, which is why
 * client/scripts/check-schemas.mjs lists this file as partly migrated.
 *
 * Every body is `.strict()`: an unknown key is a 422, never silently dropped.
 * The Turnstile token is NOT a body field; it travels in `X-Turnstile-Token`
 * (shared/http/human-check.js) so these shapes did not have to change for it.
 */
const { z } = require("zod");
const { quoteRequest, websiteMessages } = require("@praxis/shared");
const { AppError } = require("../../../utils/errors");

const trap = {
  website_url: z.string().max(0).optional(),
  form_started_at: z.number().int().optional(),
};
const email = z.string().trim().email().max(255);

/**
 * A visitor's files (SmartLS website v2, PR 2): up to ten base64 data URLs.
 * The string bound is the outer one, sized for the whole 20 MB as base64; the
 * real limits (decoded bytes, count, type from the bytes) are attachments.js's.
 */
const documents = z
  .array(
    z
      .object({
        data_url: z.string().min(1).max(Math.ceil((websiteMessages.ATTACHMENTS_TOTAL_BYTES * 4) / 3) + 1024),
        filename: z.string().max(255).optional(),
      })
      .strict(),
  )
  .max(websiteMessages.ATTACHMENTS_MAX_FILES)
  .optional();

/** The site path a message was written on: a path, never a URL to elsewhere. */
const originPage = z.string().max(300).regex(/^\/[^\s]*$/).optional();

const schemas = {
  quote: quoteRequest.publicQuote,
  contact: z
    .object({
      ...trap,
      name: z.string().max(255).optional(),
      email: email.optional(),
      phone: z.string().max(60).optional(),
      company_name: z.string().max(255).optional(),
      subject: z.string().max(255).optional(),
      message: z.string().min(1).max(20000),
      enquiry_type: z.enum(["GENERAL_ENQUIRY", "PARTNERSHIP", "CAREERS", "MEDIA"]).optional(),
      documents,
      origin_page: originPage,
    })
    .strict(),
  /**
   * The floating message button. The email is REQUIRED here, where the contact
   * form leaves it optional: the button asks for it first, it is the only way
   * the desk can answer, and the acknowledgement goes to it.
   */
  message: z
    .object({
      ...trap,
      email,
      message: z.string().trim().min(1).max(20000),
      name: z.string().max(255).optional(),
      company_name: z.string().max(255).optional(),
      phone: z.string().max(60).optional(),
      documents,
      origin_page: originPage,
    })
    .strict(),
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid submission", 422, p.error.flatten().fieldErrors));
  if (p.data.form_started_at && Date.now() - p.data.form_started_at < 1500) {
    return next(new AppError("SPAM_REJECTED", "Submission rejected", 422));
  }
  delete p.data.website_url;
  delete p.data.form_started_at;
  req.body = p.data;
  return next();
};

module.exports = { schemas, quote: mw("quote"), contact: mw("contact"), message: mw("message") };
