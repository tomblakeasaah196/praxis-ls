/** Worker job: render a document to PDF, store it, capture it in the vault.
 *  Job data: { tenantMeta, env, html, key, entityRef, docType }. */
"use strict";
const registry = require("../../services/tenant/registry.service");
const pdf = require("../../services/pdf.service");
module.exports = async function pdfRender(job) {
  const { tenantMeta, env = "live", html, key, entityRef, docType } = job.data || {};
  if (!tenantMeta || !html || !entityRef) throw new Error("pdf job needs tenantMeta + html + entityRef");
  return registry.withTenantConnection(tenantMeta, env, (c) => pdf.renderAndStore(c, { html, key, entityRef, docType }));
};
