/**
 * Client master (MOD-03) — clients with KYC, credit limit, payment terms and the
 * withholding-agent flag (KB §6.6/§17). Numbered ref via numbering.service. SQL
 * in the repo. Exposes a credit-status helper the invoicing flow consults.
 *
 * On top of the static Zod validation, the create path enforces the tenant's
 * per-field required-ness (party_field_config, §5.2), and the update path
 * allocates the auxiliary COA account when the client is activated (§3).
 */
"use strict";
const repo = require("./client_master.repo");
const events = require("./client_master.events");
const { kycComplete, creditStatus } = require("./client_master.rules");
const numbering = require("../../../services/documents/numbering.service");
const masterConfig = require("../master_config/master_config.service");
const lifecycle = require("../party-lifecycle.service");
const partyWrite = require("../_shared/party-write.service");
const changeRequest = require("../_shared/change-request.service");
const accountManager = require("./account_manager.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { atomically } = require("../../../shared/db/tx");
const discardRepo = require("./client_master.discard.repo");

async function create(client, { data, actor = {} }) {
  // Country-first form blocks (§2) are written as their own rows, not master
  // columns — pull them out of the flat payload before the master insert.
  const { registrations, primary_contact, primary_address, ...masterData } = data;
  return atomically(client, async () => {
    // Registrations are the source of truth; mirror OHADA NIU/RCCM onto the
    // master (invoices read those columns) and stamp the normalized name.
    partyWrite.validateRegistrations({ registrations, country: masterData.country_code, kind: "client", category: null });
    Object.assign(masterData, partyWrite.niuRccmMirror(registrations), { name_norm: partyWrite.normalizeName(masterData) });
    // Tenant field-requirement policy on top of the static schema (§5.2).
    await masterConfig.enforceRequired(client, "CLIENT", masterData);
    // The account manager (14200) is named through its own service whichever
    // door it comes in by — it must be an ACTIVE login, and naming one is
    // audited and tells them — so it is not a plain column of the insert.
    // "Also notify" (D7) rides the same door: picked at creation, written
    // through account_manager.setAlsoNotify (active logins, audited, told).
    const { relationship_manager_user_id: accountManagerId, also_notify_user_ids: alsoNotifyIds, ...insertable } = masterData;
    // A new client starts as a DRAFT unless told otherwise.
    const payload = { registration_status: "DRAFT", ...insertable };
    let ref = payload.ref || null;
    if (!ref && payload.entity_id) {
      const alloc = await numbering.allocate(client, { moduleKey: events.MODULE, entityId: payload.entity_id, date: new Date().toISOString().slice(0, 10) });
      ref = alloc.number;
    }
    const row = await repo.insert(client, { ...payload, ref });
    // Registrations, primary contact and primary address — same transaction.
    await partyWrite.writeChildren(client, { kind: "client", partyId: row.client_id, registrations, primary_contact, primary_address });
    if (accountManagerId) {
      await accountManager.set(client, { clientId: row.client_id, userId: accountManagerId, actor });
      row.relationship_manager_user_id = accountManagerId;
    }
    if (alsoNotifyIds && alsoNotifyIds.length) {
      await accountManager.setAlsoNotify(client, { clientId: row.client_id, userIds: alsoNotifyIds, actor });
    }
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: "client:" + row.client_id, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: "client:" + row.client_id, after: row });
    return row;
  });
}

async function update(client, { id, patch, actor = {}, env }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Client not found", 404);
  // The nested blocks are managed via the 360 endpoints on edit — strip them
  // from the flat patch. Registrations sent from the edit form still re-mirror
  // OHADA NIU/RCCM onto the master, and any name change refreshes name_norm.
  const masterPatch = { ...patch };
  const { registrations } = masterPatch;
  delete masterPatch.registrations; delete masterPatch.primary_contact; delete masterPatch.primary_address;
  // The account manager goes through its own service, as on create (14200):
  // an ACTIVE login, audited, and the person told.
  const accountManagerId = masterPatch.relationship_manager_user_id;
  delete masterPatch.relationship_manager_user_id;
  const alsoNotifyIds = masterPatch.also_notify_user_ids;
  delete masterPatch.also_notify_user_ids;
  // Sensitive-field maker-checker (§8): in LIVE, split legal name / credit limit
  // / status out of the direct patch — they need a second authorization. Done
  // BEFORE the mirror + name_norm recompute so a pending legal-name change never
  // half-applies through name_norm.
  const gate = changeRequest.isGoverned(env) ? changeRequest.pickSensitiveMaster(masterPatch) : { sensitive: {}, changeType: null };
  if (registrations) {
    partyWrite.validateRegistrations({ registrations, country: masterPatch.country_code ?? before.country_code, kind: "client", category: null });
    Object.assign(masterPatch, partyWrite.niuRccmMirror(registrations));
  }
  if (masterPatch.name !== undefined || masterPatch.legal_name !== undefined) {
    masterPatch.name_norm = partyWrite.normalizeName({ name: masterPatch.name ?? before.name, legal_name: masterPatch.legal_name ?? before.legal_name });
  }
  return atomically(client, async () => {
    let pending = null;
    if (gate.changeType) {
      pending = await changeRequest.open(client, { kind: "client", partyId: id, changeType: gate.changeType, payload: gate.sensitive, actor });
    }
    const row = Object.keys(masterPatch).length ? await repo.update(client, id, masterPatch) : before;
    if (accountManagerId !== undefined) {
      await accountManager.set(client, { clientId: id, userId: accountManagerId || null, actor });
    }
    if (alsoNotifyIds !== undefined) {
      await accountManager.setAlsoNotify(client, { clientId: id, userIds: alsoNotifyIds || [], actor });
    }
    // Activation (§3): allocate the aux account + refresh compliance the first
    // time a client becomes ACTIVE. Keyed on "active without an aux account" so a
    // retry after a mid-activation failure still completes it.
    if (row.registration_status === "ACTIVE" && !row.coa_aux_account) {
      await lifecycle.onActivate(client, { kind: "client", partyId: id });
    }
    await emitEvent(client, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: "client:" + id, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: "client:" + id, before, after: row });
    const result = await repo.get(client, id);
    if (pending) result.pending_change = { change_request_id: pending.change_request_id, change_type: pending.change_type };
    return result;
  });
}

const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);

/** Credit status for a client + a proposed additional exposure. */
async function creditCheck(client, { clientId, additionalAmount = 0 }) {
  const c = await repo.get(client, clientId);
  if (!c) throw new AppError("NOT_FOUND", "Client not found", 404);
  // DATA 1.9: derive the real exposure. cached_receivables is written by
  // nothing and is permanently zero, so this used to report unlimited credit
  // for every client no matter what they owed.
  const { outstanding, overdue } = await repo.outstandingFor(client, clientId);
  return {
    client_id: clientId,
    kyc_complete: kycComplete(c),
    overdue,
    ...creditStatus(c, additionalAmount, outstanding),
  };
}

async function setPublicReferenceConsent(client, { id, consent, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Client not found", 404);
  const row = await repo.update(client, id, { public_reference_consent: consent });
  await audit(client, { actorUserId: actor.user_id || null, action: "client.public_reference_consent.changed", moduleKey: events.MODULE, entityRef: "client:" + id, before: { public_reference_consent: before.public_reference_consent }, after: { public_reference_consent: consent } });
  return row;
}
/**
 * What a discard would refuse on — the dialog asks before offering the
 * destructive button, so a person with a client that has history is told
 * "Deactivate instead" without first being asked to confirm a delete.
 */
async function discardCheck(client, { id }) {
  const row = await repo.get(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Client not found", 404);
  const counts = await discardRepo.history(client, id);
  const history = Object.entries(counts)
    .filter(([, n]) => Number(n) > 0)
    .map(([key, n]) => ({ key, count: Number(n), label: discardRepo.HISTORY_LABELS[key] || key }));
  const isDraft = row.registration_status === "DRAFT";
  return {
    client_id: id,
    registration_status: row.registration_status,
    can_discard: isDraft && history.length === 0,
    reason: !isDraft ? "NOT_DRAFT" : history.length ? "HAS_HISTORY" : null,
    history,
  };
}

/**
 * Discard a DRAFT client with no history (meeting 6, register 3.6) — the
 * CINECAM-style test client that otherwise stays in LIVE for ever.
 *
 * ONE transaction: the client row is locked, its history re-counted under the
 * lock (so a quotation raised a second ago refuses it), its own rows are
 * snapshotted in full into the audit trail, and then it and its own children
 * — contacts, addresses, banks, beneficial owners, registrations, documents,
 * onboarding steps, portal grants and unused invites — are removed. Anything
 * else is refused with "Deactivate instead", naming what it found.
 *
 * Not in the AI manifest: the assistant may not delete a client.
 */
async function discard(client, { id, actor = {} }) {
  return atomically(client, async () => {
    const { rows } = await client.query("SELECT * FROM client_master WHERE client_id = $1 FOR UPDATE", [id]);
    const row = rows[0];
    if (!row) throw new AppError("NOT_FOUND", "Client not found", 404);
    if (row.registration_status !== "DRAFT") {
      throw new AppError("CLIENT_NOT_DRAFT", "Only a draft client can be discarded. Deactivate instead.", 409, { registration_status: row.registration_status });
    }
    const check = await discardCheck(client, { id });
    if (check.history.length) {
      throw new AppError(
        "CLIENT_HAS_HISTORY",
        `This client already has ${check.history.map((h) => `${h.count} ${h.label}`).join(", ")}. Deactivate instead.`,
        409,
        { history: check.history },
      );
    }
    const children = await discardRepo.children(client, id);
    const snapshot = { client: row, ...children };
    const removed = await discardRepo.removeAll(client, id, children.portal_invites.map((i) => i.invite_id));
    if (removed !== 1) throw new AppError("CLIENT_NOT_DRAFT", "Only a draft client can be discarded. Deactivate instead.", 409);
    await emitEvent(client, { eventTypeKey: events.DISCARDED, moduleKey: events.MODULE, entityRef: "client:" + id, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.DISCARDED, moduleKey: events.MODULE, entityRef: "client:" + id, before: snapshot, after: null, isSensitive: true });
    return {
      discarded: true,
      client_id: id,
      removed: Object.fromEntries(Object.entries(children).map(([k, v]) => [k, v.length])),
    };
  });
}

module.exports = { create, update, get, list, creditCheck, setPublicReferenceConsent, discardCheck, discard };
