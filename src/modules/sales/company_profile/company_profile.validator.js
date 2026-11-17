"use strict";
/**
 * Company Profile request validation: an adapter over `@praxis/shared`'s
 * `companyProfile`, which the editor validates with too, so a field the screen
 * accepts is a field the API accepts.
 */
const { companyProfile } = require("@praxis/shared");
const { AppError } = require("../../../utils/errors");

const use = (schema, message) => (req, _res, next) => {
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return next(new AppError("VALIDATION_ERROR", message, 422, parsed.error.flatten().fieldErrors));
  req.body = parsed.data;
  return next();
};

/** One section of the draft; the schema is chosen by the section in the path. */
const section = (req, res, next) => {
  const schema = companyProfile.section(req.params.key);
  if (!schema) return next(new AppError("NOT_FOUND", "No such section", 404));
  return use(schema, "Invalid section")(req, res, next);
};

module.exports = {
  section,
  publish: use(companyProfile.publish, "Invalid publish request"),
  share: use(companyProfile.share, "Invalid share"),
  logo: use(companyProfile.logo, "Invalid logo"),
  cover: use(companyProfile.cover, "Invalid cover image"),
};
