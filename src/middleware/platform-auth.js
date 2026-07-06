/**
 * Platform (company dashboard) authentication + authorisation.
 *
 * The dashboard is Praxis-only. Bearer JWT signed with JWT_ACCESS_SECRET and
 * carrying { sub, typ:'platform' }. We load the platform_user from the platform
 * DB and attach req.platformUser. requirePlatformRole() gates by role.
 *
 * Platform users NEVER get tenant business access — this guard only unlocks the
 * platform.* control surface.
 */
"use strict";

const jwt = require("jsonwebtoken");
const { config } = require("../config/env");
const { AppError } = require("../utils/errors");
const platformDb = require("../services/platform/db");

async function platformAuth(req, _res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer "))
    throw new AppError("AUTH_REQUIRED", "Authorization header missing", 401);
  let payload;
  try {
    payload = jwt.verify(header.slice(7).trim(), config.JWT_ACCESS_SECRET);
  } catch (err) {
    const expired = err.name === "TokenExpiredError";
    throw new AppError(
      expired ? "TOKEN_EXPIRED" : "INVALID_TOKEN",
      expired ? "Access token expired" : "Invalid token",
      401,
    );
  }
  if (payload.typ !== "platform")
    throw new AppError("WRONG_AUDIENCE", "Not a platform token", 401);

  const { rows } = await platformDb.query(
    "SELECT platform_user_id, email, full_name, role, is_active FROM platform.platform_user WHERE platform_user_id=$1",
    [payload.sub],
  );
  const u = rows[0];
  if (!u || !u.is_active)
    throw new AppError(
      "USER_INACTIVE",
      "Platform user not found or inactive",
      401,
    );
  req.platformUser = u;
  return next();
}

function requirePlatformRole(...roles) {
  const allowed = new Set(roles.length ? roles : ["PLATFORM_ROOT_ADMIN"]);
  return function check(req, _res, next) {
    if (!req.platformUser)
      throw new AppError("AUTH_REQUIRED", "Authentication required", 401);
    if (!allowed.has(req.platformUser.role))
      throw new AppError(
        "FORBIDDEN",
        `Requires role: ${[...allowed].join(", ")}`,
        403,
      );
    return next();
  };
}

module.exports = { platformAuth, requirePlatformRole };
