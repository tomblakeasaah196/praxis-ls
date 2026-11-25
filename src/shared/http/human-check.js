"use strict";

/**
 * The bot check in front of every public form that writes: the message button,
 * the contact form, the quote request and the careers applications.
 *
 * The website sends the Turnstile token in the `X-Turnstile-Token` header
 * rather than in the body, so the four `.strict()` body schemas stay exactly as
 * they are and no form can forget to strip it.
 *
 * Mount it AFTER the limiter and the validator: a body with a mistake in it is
 * refused before its single-use token is spent, so the visitor fixes the field
 * and sends again with the same check.
 *
 * Without keys in the tenant's settings this passes everything through, and
 * the honeypot and timing trap carry on as the only filter
 * (`services/turnstile.service.js` says why that is the safe default).
 */

const { AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");
const turnstile = require("../../services/turnstile.service");
const settings = require("../../modules/sales/public_intake/website-messages.settings");

const HEADER = "x-turnstile-token";

function requireHuman(action) {
  const mw = async (req, _res, next) => {
    try {
      const keys = await req.tenantDbIn("live", (c) => settings.turnstileKeys(c));
      if (!keys) return next();
      const token = String(req.get(HEADER) || "").trim();
      if (!token || token.length > 4096) {
        return next(new AppError("HUMAN_CHECK_REQUIRED", "Complete the check that you are not a robot, then send again", 422));
      }
      const out = await turnstile.verifyToken({ secret: keys.secret, token, remoteIp: req.ip });
      if (out.unreachable) {
        logger.warn({ action, tenant: req.tenant && req.tenant.slug }, "[human-check] Cloudflare unreachable; letting the submission through on the other filters");
        return next();
      }
      if (!out.success) {
        return next(new AppError("HUMAN_CHECK_FAILED", "The check that you are not a robot did not pass. Please try again", 422));
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
  mw.praxisHumanCheck = action;
  return mw;
}

module.exports = { requireHuman, HEADER };
