"use strict";
/**
 * Lead (MOD-20) — the API's adapter onto the shared shapes.
 *
 * Every rule lives in `@praxis/shared` schemas/lead.js, which the capture form
 * validates with too: "a lead the form accepts" and "a lead this route
 * accepts" are one definition (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §6). This
 * file only turns a parse failure into the 422 the rest of the API answers with.
 */
const { lead } = require("@praxis/shared");
const { AppError } = require("../../../utils/errors");

const schemas = {
  create: lead.capture,
  update: lead.update,
  activity: lead.activity,
  nextStep: lead.nextStep,
  done: lead.done,
  archive: lead.archive,
  reopen: lead.reopen,
  makeClient: lead.makeClient,
  duplicates: lead.duplicatesQuery,
  list: lead.listQuery,
  // AI-facing variants carry lead_id in the payload (REST gets it from the URL).
  aiActivity: lead.aiActivity,
  aiNextStep: lead.aiNextStep,
  aiArchive: lead.aiArchive,
  aiMakeClient: lead.aiMakeClient,
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
  activity: mw("activity"),
  nextStep: mw("nextStep"),
  done: mw("done"),
  archive: mw("archive"),
  reopen: mw("reopen"),
  makeClient: mw("makeClient"),
  duplicates: mwQuery("duplicates"),
  list: mwQuery("list"),
  schemas,
  CLIENT_TYPE: lead.CLIENT_TYPES,
  SOURCES: lead.SOURCES,
};
