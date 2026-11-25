/**
 * Insights (MOD-29) AI manifest.
 *
 * Reads are open to anyone who can view the website editor: the assistant can
 * list the library, read one article, and say what is scheduled or still a
 * draft. The one write is a DRAFT: the assistant may start an article for a
 * person to finish, never publish one. Publishing, pinning and dates on the
 * public site stay deliberate acts in the editor, for the reason their own
 * endpoints give.
 */
"use strict";
const service = require("./insight.service");
const validator = require("./insight.validator");

const MOD = "MOD-29";

module.exports = {
  entity: "insight_article",
  module_key: MOD,
  screens: ["settings_website_insights", "settings_website_insight"],
  reads: [
    {
      key: "list_insight_articles",
      service: (c, p) => service.list(c, { tag: (p && p.tag) || null }),
      permission: { module: MOD, action: "view" },
      describe: "Every article and announcement on the public site, drafts included: headline, date, byline and role, tags, and whether it is published, scheduled (published with a future date) or a draft.",
    },
    {
      key: "get_insight_article",
      service: (c, p) => service.get(c, (p && (p.id || p.insight_article_id)) || p),
      permission: { module: MOD, action: "view" },
      describe: "One article by id, with its body, excerpt, search title and description, byline and date.",
    },
  ],
  writes: [
    {
      key: "create_insight_draft",
      service: (c, p, actor) => service.create(c, { patch: p, actor }),
      schema: validator.schemas.create,
      permission: { module: MOD, action: "edit" },
      confirm: true,
      describe: "Start an article as a DRAFT (never published): a headline in English or French, and optionally slug, excerpt, body, tags, byline name and role, and its date. A person reads and publishes it in Settings, Website, Insights.",
    },
  ],
};
