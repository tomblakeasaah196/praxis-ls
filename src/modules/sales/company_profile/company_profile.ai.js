"use strict";
/**
 * Company Profile for Praxis AI: the PUBLISHED profile only (guide §3.6).
 * Never a draft, never a hidden item (presentation.visible runs first), and
 * no cost or margin, because the profile holds none. Read-only: publishing and
 * sharing stay with a person on the screen.
 */
const s = require("./company_profile.service");
const { MODULE } = require("./company_profile.events");

module.exports = {
  entity: "company_profile",
  module_key: MODULE,
  screens: [],
  reads: [
    {
      key: "get_company_profile",
      service: (c, p = {}) => s.published(c, { language: p && String(p.language || "").toUpperCase() === "FR" ? "FR" : "EN" }),
      permission: { module: MODULE, action: "view" },
      describe: "Read the tenant's published company profile (who we are, services, capacity and network figures from the tenant's own data, certifications held, case stories, why choose us, contact). Optional language EN or FR. Drafts and hidden items are never returned.",
    },
  ],
  writes: [],
};
