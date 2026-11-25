"use strict";
/**
 * Bodies for the website brand endpoints (14660).
 *
 * Every schema comes from `@praxis/shared` (`siteBrand`), the same object the
 * settings screens validate against, so a form that accepts a value cannot
 * hand the API something it refuses. Imported through the package ROOT, which
 * is what `check:schemas` looks for.
 */

const { AppError } = require("../../../utils/errors");
const { siteBrand: shared } = require("@praxis/shared");

const schemas = {
  imageAlt: shared.imageAlt,
  imageUpload: shared.imageUpload,
  createDocument: shared.documentCreate,
  updateDocument: shared.documentUpdate,
  publishDocument: shared.documentPublish,
};

const mw = (k) => (req, _res, next) => {
  const parsed = schemas[k].safeParse(req.body ?? {});
  if (!parsed.success) {
    return next(
      new AppError("VALIDATION_ERROR", "Invalid body", 422, parsed.error.flatten().fieldErrors),
    );
  }
  req.body = parsed.data;
  return next();
};

/** A slot key in the path is checked against the registry before any query
 *  sees it; an unknown one is a 404, the honest answer to "no such slot". */
function slotParam(req, _res, next) {
  if (!shared.isImageSlot(req.params.slot)) {
    return next(new AppError("NOT_FOUND", "There is no photograph slot by that name", 404));
  }
  return next();
}

/** Bodiless writes still refuse a body, so nothing rides along unvalidated. */
function noBody(req, _res, next) {
  if (req.body && typeof req.body === "object" && Object.keys(req.body).length) {
    return next(new AppError("VALIDATION_ERROR", "This request takes no body", 422));
  }
  return next();
}

module.exports = {
  schemas,
  slotParam,
  noBody,
  imageAlt: mw("imageAlt"),
  imageUpload: mw("imageUpload"),
  createDocument: mw("createDocument"),
  updateDocument: mw("updateDocument"),
  publishDocument: mw("publishDocument"),
};
