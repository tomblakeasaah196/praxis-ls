"use strict";
/**
 * The website's brand layer: photograph slots, trust documents and the legal
 * pages (14660, doc/smartls-website/ENGINEERING_GUIDE.md PR 4).
 *
 * MODULE KEY: MOD-29, the key every part of the tenant's public face rides
 * (see site_settings.events). A marketing administrator who writes the About
 * page publishes its policies too; splitting them would be a second grant
 * nobody has asked for.
 */
module.exports = {
  MODULE: "MOD-29",
  IMAGE_UPDATED: "site.image_updated",
  DOCUMENT_CREATED: "site.document_created",
  DOCUMENT_UPDATED: "site.document_updated",
  DOCUMENT_DELETED: "site.document_deleted",
  DOCUMENT_PUBLISHED: "site.document_published",
  DOCUMENT_WITHDRAWN: "site.document_withdrawn",
};
