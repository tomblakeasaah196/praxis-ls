"use strict";
/**
 * Tax Jurisdiction + tax-code rate cards (MOD-07). Declares every event key this
 * module emits so the service imports them instead of hard-coding strings, and
 * so they line up with migrations/seeds/9020_seed_rbac_events.sql.
 */
module.exports = {
  MODULE: "MOD-07",
  JURISDICTION_CREATED: "tax_jurisdiction.created",
  JURISDICTION_UPDATED: "tax_jurisdiction.updated",
  JURISDICTION_DEACTIVATED: "tax_jurisdiction.deactivated",
  CODE_CREATED: "tax_code.created",
  CODE_UPDATED: "tax_code.updated",
  CODE_EXPIRED: "tax_code.expired",
};
