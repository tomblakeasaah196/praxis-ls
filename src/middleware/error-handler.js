/**
 * Centralised error handler + 404 handler for the API.
 *
 * One consistent shape:  { error: { code, message, fields? }, request_id }
 * Never leaks SQL text, stack traces, or internal messages to the client.
 */
"use strict";

const { ZodError } = require("zod");
const { logger } = require("../config/logger");
const { AppError } = require("../utils/errors");

function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` },
    request_id: req.request_id,
  });
}

const PG = {
  23505: [409, "CONFLICT", "A record with these values already exists"],
  23503: [409, "REFERENCE_INVALID", "Referenced record not found"],
  23502: [400, "MISSING_VALUE", "A required value was missing"],
  23514: [400, "INVALID_VALUE", "A value violates a domain constraint"],
  22001: [400, "VALUE_TOO_LONG", "One of the values you entered is too long"],
  22003: [400, "VALUE_OUT_OF_RANGE", "One of the values you entered is out of range"],
  "22P02": [400, "INVALID_VALUE", "One of the values is in the wrong format"],
  40001: [409, "TEMPORARY_CONFLICT", "Please retry — a brief conflict occurred"],
  "40P01": [409, "TEMPORARY_CONFLICT", "Please retry — a brief conflict occurred"],
  P0001: [409, "ACTION_BLOCKED", "That action was blocked by a business rule"],
};

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const request_id = req.request_id;

  if (err instanceof AppError) {
    const status = err.status || 500;
    if (status >= 500) logger.error({ err, request_id }, err.message);
    else logger.warn({ request_id, code: err.code, status }, err.message);
    return res.status(status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { fields: err.details } : {}) },
      request_id,
    });
  }

  if (err instanceof ZodError) {
    const fields = err.issues.reduce((acc, i) => {
      const path = i.path.join(".") || "_";
      (acc[path] = acc[path] || []).push(i.message);
      return acc;
    }, {});
    logger.warn({ request_id, fields }, "validation error");
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Invalid input", fields },
      request_id,
    });
  }

  const mapped = err && err.code && PG[err.code];
  if (mapped) {
    const [status, code, message] = mapped;
    logger.warn({ request_id, pg_code: err.code, constraint: err.constraint }, "pg error");
    return res.status(status).json({ error: { code, message }, request_id });
  }

  logger.error({ err, request_id }, "unhandled error");
  return res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Something went wrong on our side — please try again.", reference: request_id },
    request_id,
  });
}

module.exports = { errorHandler, notFoundHandler };
