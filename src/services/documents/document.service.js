/**
 * Shared document-capture facade (BUILD_CONVENTIONS §3). Delegates to the
 * vault/document_vault module so there is one implementation and the SQL lives in
 * that module's repo. Callers (pdf.service, invoicing) use this thin surface.
 */
"use strict";
const vault = require("../../modules/vault/document_vault/document_vault.service");
module.exports = { capture: vault.capture, getByRef: vault.getByRef, get: vault.get };
