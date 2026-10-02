"use strict";
/**
 * GET /search — the query string, validated by the shared definition the ⌘K
 * palette checks before it sends (packages/shared/schemas/search.js).
 */
const { search: shared } = require("@praxis/shared");
const { AppError } = require("../../utils/errors");

function query(req, _res, next) {
  const p = shared.query.safeParse(req.query);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid search", 422, p.error.flatten().fieldErrors));
  req.searchQuery = p.data;
  return next();
}

module.exports = { query };
