/**
 * Make Express 4 forward async rejections to the error handler.
 *
 * Express 4 does NOT await async middleware/handlers, so an `async` function
 * that throws (or rejects) produces an *unhandled* rejection: the central error
 * handler is never reached and — under Node's default unhandledRejection policy
 * — the process crashes. Any anonymous request to a gated route
 * (`authMiddleware`/`requirePermission` throw on failure) would take the whole
 * API down. See doc/PHASE0_PRODUCTION_AUDIT.md §1.
 *
 * This is a minimal, dependency-free port of `express-async-errors`: it patches
 * the Router Layer so that any handler returning a promise routes its rejection
 * to `next(err)`. Require this ONCE, before the app/router is built (top of
 * server.js and the worker). It fixes every async handler/middleware globally,
 * not just the three we know about today.
 */
"use strict";

const Layer = require("express/lib/router/layer");

if (!Layer.prototype.__praxisAsyncSafe) {
  const original = Layer.prototype.handle_request;
  Layer.prototype.handle_request = function handleRequest(req, res, next) {
    const fn = this.handle;
    // Error-handling middleware (arity 4) is dispatched elsewhere; leave it.
    if (typeof fn !== "function" || fn.length > 3) {
      return original.call(this, req, res, next);
    }
    let ret;
    try {
      ret = fn.call(this, req, res, next);
    } catch (err) {
      return next(err);
    }
    if (ret && typeof ret.then === "function") {
      ret.then(undefined, next);
    }
    return ret;
  };
  Layer.prototype.__praxisAsyncSafe = true;
}

module.exports = {};
