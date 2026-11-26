/**
 * Website settings (MOD-29) AI manifest: the AI profile.
 *
 * The AI profile is the text AI assistants read about the company (served at
 * /llms.txt and folded into the website's structured data), so it is the one
 * website setting the assistant is most often asked about: "what does ChatGPT
 * say we do?", "add our new office to the AI profile". It may read it, and
 * propose a change a person confirms. It never writes the summary from nothing
 * on its own initiative: the profile is the company's own account of itself.
 */
"use strict";
const service = require("./site_settings.service");
const validator = require("./site_settings.validator");

const MOD = "MOD-29";

module.exports = {
  entity: "site_ai_profile",
  module_key: MOD,
  screens: ["settings_website_ai_profile"],
  reads: [
    {
      key: "get_site_ai_profile",
      service: (c) => service.getAiProfile(c),
      permission: { module: MOD, action: "view" },
      describe: "The AI profile of the company's public website: the one-paragraph summary AI assistants read, the other names the company is searched by, founding year, offices, services, sectors, areas served, memberships and credentials, leadership, what the company does not do, contact, and the date it was last reviewed.",
    },
  ],
  writes: [
    {
      key: "update_site_ai_profile",
      service: (c, p, actor) => service.updateAiProfile(c, { patch: p, actor }),
      schema: validator.schemas.aiProfile,
      permission: { module: MOD, action: "edit" },
      confirm: true,
      describe: "Change fields of the AI profile (summary, alternate_names, founded, offices, services_summary, sectors, areas_served, credentials, leadership, not_offered, contact, reviewed_on as YYYY-MM-DD). Only the fields sent change. It is published to AI assistants at once, so a person confirms it.",
    },
  ],
};
