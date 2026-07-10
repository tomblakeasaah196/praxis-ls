/**
 * Document vault (MOD-64). Capture a document ONCE per entity_ref then keep it in
 * sync; serve bytes for the auth-gated download. SQL lives in the repo.
 */
"use strict";
const repo = require("./document_vault.repo");
const storage = require("../../../services/storage.service");
const { AppError } = require("../../../utils/errors");

async function capture(client, opts) {
  const {
    entityRef, docType = null, storagePath = null, contentHash = null,
    fileContext = null, folderRef = null, dossierId = null, status = null,
  } = opts;
  if (!entityRef) throw new AppError("NO_ENTITY_REF", "entityRef is required", 422);
  const path = storagePath || "pending://" + entityRef;
  const existing = await repo.getByRef(client, entityRef);
  if (existing) return repo.updateSync(client, existing.doc_id, { storagePath: path, contentHash, docType, status });
  return repo.insert(client, {
    entity_ref: entityRef, doc_type: docType, storage_path: path, content_hash: contentHash,
    file_context: fileContext, folder_ref: folderRef, dossier_id: dossierId, ...(status ? { status } : {}),
  });
}

async function fetchBytes(client, docId) {
  const doc = await repo.get(client, docId);
  if (!doc) throw new AppError("NOT_FOUND", "Document not found", 404);
  if (!doc.storage_path || doc.storage_path.startsWith("pending://")) {
    throw new AppError("NOT_READY", "Document not rendered yet", 409);
  }
  const buffer = await storage.get(doc.storage_path);
  return { doc, buffer };
}

const getByRef = (client, ref) => repo.getByRef(client, ref);
const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);

module.exports = { capture, fetchBytes, getByRef, get, list };
