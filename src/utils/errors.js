/**
 * Minimal error helpers used by the platform/tenant HTTP layer.
 * (The legacy modules reference an AppError of this shape.)
 */
"use strict";

class AppError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Wrap an async Express handler so thrown/rejected errors reach next(). */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { AppError, asyncHandler };
