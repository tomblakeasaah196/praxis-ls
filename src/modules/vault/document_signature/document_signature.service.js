/**
 * Document signatures (MOD-64) — ties a signature to a vault document's DNA
 * (content_hash + document_vault_id) so a signed doc can be verified later.
 */
"use strict";
const repo = require("./document_signature.repo");
const vaultRepo = require("../document_vault/document_vault.repo");
const events = require("./document_signature.events");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

async function sign(client, opts) {
  const { entityRef, signerUserId = null, signerName = null, method = "DIGITAL", signatureRef = null, actor = {}, ip = null } = opts;
  if (!entityRef) throw new AppError("NO_ENTITY_REF", "entityRef is required", 422);
  const doc = await vaultRepo.getByRef(client, entityRef);
  const row = await repo.insert(client, {
    entity_ref: entityRef,
    document_vault_id: doc ? doc.doc_id : null,
    signer_user_id: signerUserId || actor.user_id || null,
    signer_name: signerName,
    method,
    signature_ref: signatureRef,
    content_hash: doc ? doc.content_hash : null,
    signed_at: new Date().toISOString(),
  });
  await emitEvent(client, { eventTypeKey: events.SIGNED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.SIGNED, moduleKey: events.MODULE, entityRef, after: row, ip });
  return row;
}
const listByRef = (client, ref) => repo.listByRef(client, ref);
module.exports = { sign, listByRef };
