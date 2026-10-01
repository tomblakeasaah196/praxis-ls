/**
 * Quote request (MOD-20-intake) — service layer.
 *
 * The intake register from F6 (doc/SALES_CRM_FEATURES.md): a request for a
 * quote arrives from the website or is keyed in by staff, carrying the whole
 * logistics scope; staff work it; when it becomes real it converts into a
 * tracked opportunity.
 *
 * THREE THINGS THIS LAYER IS RESPONSIBLE FOR, EACH OF WHICH WAS WRONG BEFORE:
 *
 * 1. THE REFERENCE. `numbering.allocate` refuses a null entity — `doc_sequence`
 *    is keyed (module, year, entity) so a tenant with two corporate entities
 *    cannot share one counter. It was being called with `entityId: null` on
 *    every create, so every create raised 422 NO_ENTITY and the register could
 *    not take a single row. The entity is now resolved (payload → the lead's →
 *    the tenant's only active entity) and the number is allocated BEFORE the
 *    insert, so the row and its reference are one statement, not two.
 *
 * 2. CONVERSION IS ONE TRANSACTION. The opportunity used to be created — and
 *    COMMITTED, since opportunity.service opens its own BEGIN/COMMIT — before
 *    this function opened its transaction. A failure on the quote_request
 *    update then left an opportunity in the pipeline that no request pointed
 *    at, which is exactly the "converted computed two ways" defect F6 exists to
 *    correct. Both writes now share one transaction, opened here, and the
 *    opportunity repo is called directly so no nested BEGIN can commit early.
 *
 * 3. AN ATTACHMENT THAT FAILS LEAVES NOTHING BEHIND. There was no upload path
 *    at all — the controller took a `vault_id` from the request body and linked
 *    it — while a comment asserted that the controller deleted the vault row on
 *    rollback. It did not. The upload now happens here, inside the transaction
 *    that writes the link, and the stored object is deleted when that
 *    transaction rolls back.
 *
 * AND, SINCE MEETING 6 (PR 2), ONE INTAKE MODEL FOR THREE DOORS:
 *
 * 4. A REQUEST NAMES ITS SERVICE TYPE. The website, the portal and the desk all
 *    send `service_type_id`; `resolveService` turns it into an ACTIVE service
 *    (the website: active and PUBLISHED) or a 422 naming the field — the
 *    column has no FK (14310), so this is the integrity it would have held.
 *    `service_category` is then written from the service's name, a display
 *    copy for the export, the lead and the AI. The Incoterm must be one the
 *    service offers (`service_type.incoterms`, 14300), or "Not sure" (TBD), or
 *    N/A for a service with none.
 *
 * 5. A REQUEST IS FOR A CLIENT. `client_id` ties it to one (owner decision Q5):
 *    it then appears in that client's portal, and the client's account manager
 *    becomes its owner. A prospect's request stays unassigned until somebody
 *    presses "Start review", which makes them the owner.
 *
 * 6. DOCUMENTS COME WITH IT. A portal request is sent with at least one
 *    document the client uploaded first (staged under `quote_request:staged`,
 *    owned by the client) and linked here in the creating transaction, after
 *    checking each one is theirs; staged files nobody sent are swept by the
 *    media-reconcile pass (`sweepStagedDocuments`). A file a client sent in the
 *    chat can be filed on a request — the same vault file, linked, not copied.
 */
"use strict";
const repo = require("./quote_request.repo");
const events = require("./quote_request.events");
const rules = require("./quote_request.rules");
const opportunityRepo = require("../opportunity/opportunity.repo");
const opportunityEvents = require("../opportunity/opportunity.events");
const vault = require("../../vault/document_vault/document_vault.service");
const storage = require("../../../services/storage.service");
const numbering = require("../../../services/documents/numbering.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");
const { atomically } = require("../../../shared/db/tx");
const { serviceScope, incoterms, emailDomain, quoteRequest: shape } = require("@praxis/shared");

const ref = (id) => "quote_request:" + id;

/** An enquiry attachment: a packing list, a photo of the cargo, a spec sheet. */
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp"];

/** Rows a CSV export will stream before it tells the caller it truncated. */
const EXPORT_CAP = 10000;

/**
 * Which corporate entity this enquiry belongs to.
 *
 * Order: what the caller said → what the linked lead already belongs to → the
 * tenant's only active entity. A tenant with two entities and no explicit
 * choice gets a 422 naming the field rather than a guess: the entity decides
 * which counter the reference comes from and whose letterhead the quotation
 * will eventually carry, and picking one silently files the enquiry under the
 * wrong company.
 */
async function resolveEntityId(client, { data = {} }) {
  if (data.entity_id) return data.entity_id;
  if (data.lead_id) {
    const { rows } = await client.query("SELECT entity_id FROM lead WHERE lead_id = $1", [data.lead_id]);
    if (rows[0] && rows[0].entity_id) return rows[0].entity_id;
  }
  const fallback = await repo.defaultEntityId(client);
  if (fallback) return fallback;
  throw new AppError(
    "ENTITY_REQUIRED",
    "This tenant has more than one corporate entity — say which one the request belongs to",
    422,
    { entity_id: ["required when the tenant has several corporate entities"] },
  );
}

/* ─── the service a request names ─────────────────────────────────────────── */

/** The display copy written to `service_category` on every write. */
const serviceName = (st) => st.name_en || st.name_fr || st.key;

/**
 * The service type behind an id, or a 422 naming the field.
 *
 * ACTIVE, because an archived service is not something anybody sells any more;
 * PUBLISHED as well for the website, whose visitors can only have picked a
 * service the tenant put on its site. `allowInactive` is for an edit that keeps
 * the service a request was already filed under after it was archived.
 */
async function resolveService(client, id, { publishedOnly = false, allowInactive = false } = {}) {
  const st = await repo.serviceTypeById(client, id);
  if (!st || (!st.is_active && !allowInactive) || (publishedOnly && !st.is_published)) {
    throw new AppError("SERVICE_TYPE_INVALID", "Choose one of the services on offer", 422, {
      service_type_id: ["not a service on offer"],
    });
  }
  return st;
}

/** The terms a request for this service may carry: its own list, "Not sure" and "none". */
const offeredIncoterms = (st) => [...(st.incoterms || []), incoterms.NOT_SURE, incoterms.NOT_APPLICABLE];

/**
 * Refuse a delivery term the service does not offer (owner decision Q3). A
 * value that is not an ICC code at all — a legacy free-text term carried over
 * on an edit — is not this rule's business; the caller only checks what changed.
 */
function assertIncotermOffered(st, term) {
  if (!term) return;
  const t = String(term).toUpperCase();
  if (offeredIncoterms(st).includes(t)) return;
  const offered = (st.incoterms || []).join(", ") || "none";
  throw new AppError("INCOTERM_NOT_OFFERED", `${serviceName(st)} is not quoted on ${t}`, 422, {
    incoterm: [`not offered for this service (offered: ${offered}, or "not sure")`],
  });
}

/**
 * What the request stores about its service: the id, the display copy of its
 * name, and — for a hinterland transit only — which way it runs (owner decision
 * Q2). `requireDirection` is the portal's and the website's: their wizards ask,
 * so an answer is owed; the desk may not know yet.
 */
function scopeOf(st, data, { requireDirection = false } = {}) {
  const hinterland = serviceScope.flowOf(st.territory) === "HINTERLAND";
  const direction = hinterland ? data.hinterland_direction || null : null;
  if (hinterland && requireDirection && !direction) {
    throw new AppError("HINTERLAND_DIRECTION_REQUIRED", "Say whether the goods go into or out of the hinterland", 422, {
      hinterland_direction: ["into or out of the hinterland"],
    });
  }
  return { service_type_id: st.service_type_id, service_category: serviceName(st), hinterland_direction: direction };
}

/**
 * The fields a client link sets (owner decision Q5): the client, its account
 * manager as owner when nobody owns the request yet and that login is active,
 * and its name as the requester's company when none was given.
 */
async function clientLink(client, { clientId, ownerUserId = null, requesterCompany = null }) {
  const cl = await repo.clientForLink(client, clientId);
  if (!cl) {
    throw new AppError("CLIENT_NOT_FOUND", "That client does not exist", 422, { client_id: ["no such client"] });
  }
  const out = { client_id: cl.client_id };
  if (!ownerUserId && cl.account_manager_user_id) out.owner_user_id = cl.account_manager_user_id;
  if (!requesterCompany || !String(requesterCompany).trim()) out.requester_company = cl.name;
  return out;
}

/**
 * Link the documents a request was sent with, inside its creating transaction.
 *
 * `fromRef` is where they wait: `quote_request:staged` for a portal client's
 * uploads — checked here to be THIS client's, unsent and unarchived, so an id
 * from another company's session is refused rather than linked — or the
 * website's `quote_request:intake`, written by the same HTTP request a moment
 * earlier. The commercial invoice, when there is one, is the PRIMARY document;
 * otherwise the first. Each vault row is re-filed under the request.
 */
async function linkDocuments(client, { quoteRequestId, docs, fromRef, clientId = null, actor = {} }) {
  if (!docs || !docs.length) return [];
  const ids = [...new Set(docs.map((d) => d.doc_id))];
  if (fromRef === repo.STAGED_REF) {
    const mine = await repo.stagedDocuments(client, { clientId, docIds: ids });
    if (mine.length !== ids.length) {
      throw new AppError("DOCUMENT_NOT_YOURS", "One of the documents is no longer waiting to be sent — add it again", 422, {
        documents: ["not an uploaded document of yours"],
      });
    }
  }
  const primaryAt = Math.max(0, docs.findIndex((d) => d.document_kind === "COMMERCIAL_INVOICE"));
  const hasPrimary = await repo.hasPrimary(client, quoteRequestId);
  const links = [];
  for (const [i, d] of docs.entries()) {
    if (links.some((l) => l.vault_id === d.doc_id)) continue;
    links.push(await repo.addAttachment(client, {
      quote_request_id: quoteRequestId,
      vault_id: d.doc_id,
      kind: !hasPrimary && i === primaryAt ? "PRIMARY" : "ADDITIONAL",
      document_kind: d.document_kind || null,
      uploaded_by_user_id: actor.user_id || null,
    }));
  }
  await repo.refileVault(client, { docIds: ids, from: fromRef, to: ref(quoteRequestId) });
  return links;
}

/**
 * Create a request.
 *
 * `options` carry what only some doors have:
 *   publishedOnly     the website: the service must be on the public site.
 *   requireDirection  the portal and the website: a hinterland transit says which way.
 *   documents         `{ docs: [{ doc_id, document_kind }], fromRef, clientId }` —
 *                     linked in the same transaction as the row.
 */
async function create(client, { data, actor = {}, options = {} }) {
  const entityId = await resolveEntityId(client, { data });
  const st = data.service_type_id
    ? await resolveService(client, data.service_type_id, { publishedOnly: options.publishedOnly === true })
    : null;
  if (st) assertIncotermOffered(st, data.incoterm);
  // A direction with no hinterland service to belong to is dropped, not stored.
  const scope = st ? scopeOf(st, data, { requireDirection: options.requireDirection === true }) : { hinterland_direction: null };
  const link = data.client_id
    ? await clientLink(client, { clientId: data.client_id, ownerUserId: data.owner_user_id, requesterCompany: data.requester_company })
    : {};
  return atomically(client, async () => {
    // Allocated INSIDE the transaction (BUILD_CONVENTIONS §3) so the number and
    // the row commit together — a rolled-back create must not burn a reference.
    const { number } = await numbering.allocate(client, {
      moduleKey: "MOD-20-INTAKE",
      entityId,
      date: new Date().toISOString().slice(0, 10),
    });
    const row = await repo.insert(client, {
      ...data,
      ...scope,
      ...link,
      entity_id: entityId,
      public_ref: data.public_ref || number,
      created_by_user_id: actor.user_id || null,
    });
    const docs = options.documents;
    const attached = docs && docs.docs && docs.docs.length
      ? await linkDocuments(client, {
        quoteRequestId: row.quote_request_id, docs: docs.docs, fromRef: docs.fromRef, clientId: docs.clientId || null, actor,
      })
      : [];
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.quote_request_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.quote_request_id), after: { ...row, documents: attached.length } });
    return row;
  });
}

async function update(client, { id, patch = {}, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quote request not found", 404);
  if (rules.isTerminal(before.status)) {
    throw new AppError("LOCKED", "A " + before.status + " quote request cannot be edited", 422);
  }
  const fields = {};
  for (const k of repo.WRITABLE) {
    // public_ref is allocated once and is history; entity_id decides the
    // counter that produced it, so neither is patchable after the fact.
    if (k === "public_ref" || k === "entity_id") continue;
    if (patch[k] !== undefined) fields[k] = patch[k];
  }

  // The service: a new one is resolved like a create's; the same one may be
  // archived since and is kept. Its name is the display copy, and a direction
  // only survives on a hinterland service.
  let st = null;
  const nextServiceId = patch.service_type_id !== undefined ? patch.service_type_id : before.service_type_id;
  if (patch.service_type_id === null || (!nextServiceId && patch.hinterland_direction !== undefined)) {
    fields.hinterland_direction = null;
  } else if (nextServiceId) {
    st = await resolveService(client, nextServiceId, { allowInactive: nextServiceId === before.service_type_id });
    if (patch.service_type_id !== undefined || patch.hinterland_direction !== undefined) {
      Object.assign(fields, scopeOf(st, { hinterland_direction: patch.hinterland_direction !== undefined ? patch.hinterland_direction : before.hinterland_direction }));
    }
  }
  // The term is checked when it, or the service it must belong to, changed —
  // never on an untouched legacy value an edit merely carries along.
  const termChanged = fields.incoterm !== undefined && fields.incoterm !== before.incoterm;
  const serviceChanged = patch.service_type_id !== undefined && patch.service_type_id !== before.service_type_id;
  if (st && (termChanged || serviceChanged)) assertIncotermOffered(st, fields.incoterm || before.incoterm);

  // The client: re-linking follows the same rule as a create's link, and is
  // refused once the request is converted or closed (also locked above).
  if (patch.client_id !== undefined && patch.client_id !== before.client_id) {
    if (!shape.canRelink(before.status)) {
      throw new AppError("LOCKED", "A " + before.status + " quote request keeps the client it had", 422, { client_id: ["cannot be changed now"] });
    }
    if (patch.client_id) {
      Object.assign(fields, await clientLink(client, {
        clientId: patch.client_id,
        ownerUserId: fields.owner_user_id !== undefined ? fields.owner_user_id : before.owner_user_id,
        requesterCompany: fields.requester_company !== undefined ? fields.requester_company : before.requester_company,
      }));
    }
  }
  const row = await repo.update(client, id, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

async function transition(client, { id, to, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quote request not found", 404);
  rules.assertTransition(before.status, to);
  // "Start review" makes the reviewer the owner of a request nobody owns yet —
  // a prospect's, which no account manager was there to take (auditor default).
  const owner = to === "UNDER_REVIEW" && !before.owner_user_id && actor.user_id ? { owner_user_id: actor.user_id } : {};
  const row = await repo.update(client, id, { status: to, ...owner });
  await emitEvent(client, { eventTypeKey: events.transition(to), moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.transition(to), moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

/**
 * Convert a quote request into an opportunity — ONE transaction.
 *
 * The opportunity row is written through its own repo rather than through
 * opportunity.service.create, precisely because that service opens and commits
 * its own transaction: calling it here would commit the opportunity before this
 * function's own write, and a failure afterwards would strand it. The events
 * and audit rows the opportunity module would have emitted are emitted here
 * with the same keys, so nothing downstream loses a record.
 *
 * `converted_opportunity_id` is the single source of truth for "is converted";
 * the trg_quote_request_sync_converted trigger keeps `status` and `converted_at`
 * in step with it, so the two can never disagree the way the legacy's did.
 */
async function convertToOpportunity(client, { id, opportunity = {}, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quote request not found", 404);
  if (before.converted_opportunity_id) {
    throw new AppError("ALREADY_CONVERTED", "Quote request is already converted", 422);
  }
  rules.assertTransition(before.status, "CONVERTED_TO_OPPORTUNITY");

  return atomically(client, async () => {
    const opp = await opportunityRepo.insert(client, {
      name: opportunity.name,
      lead_id: before.lead_id || null,
      client_id: opportunity.client_id || null,
      pipeline_stage_id: opportunity.pipeline_stage_id || null,
      estimated_value: opportunity.estimated_value ?? null,
      currency: opportunity.currency || "XAF",
      owner_user_id: opportunity.owner_user_id || before.owner_user_id || actor.user_id || null,
      probability: opportunity.probability ?? null,
      status: "OPEN",
    });
    await emitEvent(client, { eventTypeKey: opportunityEvents.CREATED, moduleKey: opportunityEvents.MODULE, entityRef: "opportunity:" + opp.opportunity_id, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: opportunityEvents.CREATED, moduleKey: opportunityEvents.MODULE, entityRef: "opportunity:" + opp.opportunity_id, after: opp });

    const row = await repo.update(client, id, {
      converted_opportunity_id: opp.opportunity_id,
      status: "CONVERTED_TO_OPPORTUNITY",
    });
    await emitEvent(client, { eventTypeKey: events.CONVERTED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CONVERTED, moduleKey: events.MODULE, entityRef: ref(id), before, after: { opportunity_id: opp.opportunity_id } });
    return { quote_request: row, opportunity: opp };
  });
}

/* ─── attachments ─────────────────────────────────────────────────────────── */

/**
 * Upload a document against an enquiry — bytes and link in one transaction.
 *
 * THE ORPHAN RULE. Two things can be left behind by a half-done upload: a
 * `document_vault` row and the stored object it names. The row is inside this
 * transaction and disappears with the ROLLBACK. The object is not — object
 * storage has no transaction to join — so it is deleted explicitly on the
 * failure path, keyed on the storage_path the vault just returned. The delete
 * is best-effort and logged rather than thrown: failing the caller a SECOND
 * time, over cleanup, would replace a recoverable orphan with a lost document.
 *
 * `sniff` is on. An enquiry attachment arrives from a stranger through the
 * public intake in F13, and a .exe renamed .pdf is refused on its bytes.
 */
async function uploadAttachment(client, { id, dataUrl, filename = null, kind = "ADDITIONAL", documentKind = null, slug, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quote request not found", 404);
  if (rules.isTerminal(before.status)) {
    throw new AppError("LOCKED", "Cannot add attachments to a " + before.status + " quote request", 422);
  }

  let storedPath = null;
  try {
    return await atomically(client, async () => {
    const doc = await vault.createDocument(client, {
      dataUrl,
      docType: "QUOTE_REQUEST_ATTACHMENT",
      entityRef: ref(id),
      originalName: filename,
      maxBytes: ATTACHMENT_MAX_BYTES,
      allowedTypes: ATTACHMENT_TYPES,
      sniff: true,
      slug,
      actor,
    });
    storedPath = doc.storage_path;
    if (kind === "PRIMARY") await repo.demotePrimary(client, id);
    const link = await repo.addAttachment(client, {
      quote_request_id: id, vault_id: doc.doc_id, kind, document_kind: documentKind, uploaded_by_user_id: actor.user_id || null,
    });
    await audit(client, { actorUserId: actor.user_id || null, action: events.ATTACHMENT_ADDED, moduleKey: events.MODULE, entityRef: ref(id), after: link });
    return { ...link, original_name: doc.original_name, content_hash: doc.content_hash };
    });
  } catch (err) {
    if (storedPath) {
      try { await storage.delete(storedPath); } catch (cleanupErr) {
        logger.error({ err: cleanupErr, storedPath, quoteRequestId: id },
          "[quote-request] attachment rolled back but its stored object could not be deleted");
      }
    }
    throw err;
  }
}

async function removeAttachment(client, { id, attachment_id, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quote request not found", 404);
  if (rules.isTerminal(before.status)) {
    throw new AppError("LOCKED", "Cannot remove attachments from a " + before.status + " quote request", 422);
  }
  const link = await repo.getAttachment(client, { quote_request_id: id, attachment_id });
  if (!link) throw new AppError("NOT_FOUND", "Attachment not found", 404);
  return atomically(client, async () => {
    await repo.removeAttachment(client, { quote_request_id: id, attachment_id });
    // The vault row is ARCHIVED, never deleted: the document is evidence of what
    // the client sent, and MOD-64's whole contract is that vault rows are
    // retained. Detaching it from the enquiry is the operator's intent; erasing
    // it is not.
    await vault.archiveDocument(client, { id: link.vault_id, actor });
    await audit(client, { actorUserId: actor.user_id || null, action: events.ATTACHMENT_REMOVED, moduleKey: events.MODULE, entityRef: ref(id), before: link, after: { attachment_id } });
    return { removed: true };
  });
}

async function listAttachments(client, id) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quote request not found", 404);
  return repo.listAttachments(client, id);
}


/**
 * "File on a quote request" — a file the client sent in their portal chat,
 * linked to one of their requests (meeting 6, item 2.6).
 *
 * The SAME vault file, not a copy: the chat and the request then show one
 * document, with one hash, and archiving it from either is archiving it. The
 * file must come from THIS request's client's conversation — a request is
 * filed for one client, and another client's invoice on it would be a leak
 * into a portal that is not theirs. Filing the same file twice is a no-op.
 */
async function fileFromChat(client, { id, chatAttachmentId, documentKind = null, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quote request not found", 404);
  if (rules.isTerminal(before.status)) {
    throw new AppError("LOCKED", "Cannot add attachments to a " + before.status + " quote request", 422);
  }
  if (!before.client_id) {
    throw new AppError("NOT_LINKED", "Tie this request to the client first — only their own files can be filed on it", 422, {
      client_id: ["the request is not tied to a client"],
    });
  }
  const att = await repo.chatAttachment(client, chatAttachmentId);
  // One answer for "no such file" and "another client's file": the second is
  // not this caller's business to learn about.
  if (!att || att.client_id !== before.client_id) {
    throw new AppError("NOT_FOUND", "No such file in this client's conversation", 404);
  }
  if (att.kind === "VOICE") {
    throw new AppError("NOT_A_DOCUMENT", "A voice note cannot be filed as a document", 422, { chat_attachment_id: ["a voice note"] });
  }
  const existing = await repo.attachmentByVault(client, { quote_request_id: id, vault_id: att.doc_id });
  if (existing) return { ...existing, original_name: att.file_name, already: true };
  return atomically(client, async () => {
    const kind = (await repo.hasPrimary(client, id)) ? "ADDITIONAL" : "PRIMARY";
    const link = await repo.addAttachment(client, {
      quote_request_id: id, vault_id: att.doc_id, kind, document_kind: documentKind, uploaded_by_user_id: actor.user_id || null,
    });
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.ATTACHMENT_ADDED, moduleKey: events.MODULE, entityRef: ref(id),
      after: { ...link, source: "client_chat", chat_attachment_id: chatAttachmentId },
    });
    return { ...link, original_name: att.file_name };
  });
}

/**
 * Which client a requester's address belongs to (owner decision Q5).
 *
 * An exact address — a client contact's, or the client record's — wins; then
 * the company DOMAIN, never a public webmail one (`emailDomain`): two Gmail
 * users are not colleagues. One suggestion only when one client answers; the
 * candidates come back as well so the form can show what it weighed.
 */
async function clientMatch(client, { email }) {
  const domain = emailDomain.companyDomainOf(email);
  const candidates = await repo.clientCandidates(client, { email: String(email || "").trim(), domain });
  const exact = candidates.filter((c) => Number(c.rank) === 1);
  const pick = exact.length === 1 ? exact[0] : !exact.length && candidates.length === 1 ? candidates[0] : null;
  return {
    suggestion: pick ? { client_id: pick.client_id, name: pick.name, matched_on: pick.matched_on } : null,
    candidates: candidates.map((c) => ({ client_id: c.client_id, name: c.name, matched_on: c.matched_on })),
    domain,
    public_webmail: Boolean(emailDomain.domainOf(email)) && !domain,
  };
}

/* ─── the portal: documents a client sends ─────────────────────────────────── */

/** What a client may send: the vault's own portal limits (14150). */
const CLIENT_DOC_MAX_BYTES = 10 * 1024 * 1024;
const CLIENT_DOC_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

const clientVaultFile = (client, { clientId, file, entityRef, slug }) =>
  vault.createDocument(client, {
    entityRef,
    docType: "QUOTE_REQUEST_ATTACHMENT",
    file,
    clientId,
    originalName: (file && file.originalname) || null,
    maxBytes: CLIENT_DOC_MAX_BYTES,
    allowedTypes: CLIENT_DOC_TYPES,
    sniff: true,
    // Real bytes nobody on the team has looked at yet (14150's rule for every
    // file a client sends).
    status: "PENDING",
    slug,
    actor: {},
  });

/**
 * Upload one document BEFORE the request exists (owner decision Q4: a request
 * is never sent without one). It waits under `quote_request:staged`, owned by
 * the client, until `create` links it — or the sweep archives it a day later.
 */
async function stageClientDocument(client, { clientId, file, slug }) {
  if (!file) throw new AppError("FILE_REQUIRED", "Choose a file to send", 422);
  const doc = await clientVaultFile(client, { clientId, file, entityRef: repo.STAGED_REF, slug });
  return { doc_id: doc.doc_id, name: doc.original_name || (file && file.originalname) || null };
}

/**
 * "Add a document" on a request already sent — at any time (owner decision
 * Q4). Bytes and link in one transaction; the stored object is deleted if
 * that transaction rolls back, as for a staff upload.
 */
async function addClientDocument(client, { clientId, id, file, documentKind = null, slug, by = null }) {
  const before = await repo.get(client, id);
  if (!before || before.client_id !== clientId) throw new AppError("NOT_FOUND", "No such request", 404);
  if (!file) throw new AppError("FILE_REQUIRED", "Choose a file to send", 422);
  let storedPath = null;
  try {
    return await atomically(client, async () => {
      const doc = await clientVaultFile(client, { clientId, file, entityRef: ref(id), slug });
      storedPath = doc.storage_path;
      const kind = (await repo.hasPrimary(client, id)) ? "ADDITIONAL" : "PRIMARY";
      const link = await repo.addAttachment(client, { quote_request_id: id, vault_id: doc.doc_id, kind, document_kind: documentKind });
      await audit(client, {
        actorUserId: null, action: events.ATTACHMENT_ADDED, moduleKey: events.MODULE, entityRef: ref(id),
        after: { ...link, source: "client_portal", by },
      });
      return { id: link.quote_request_attachment_id, name: doc.original_name, document_kind: documentKind, kind, created_at: link.created_at };
    });
  } catch (err) {
    if (storedPath) {
      try { await storage.delete(storedPath); } catch (cleanupErr) {
        logger.error({ err: cleanupErr, storedPath, quoteRequestId: id },
          "[quote-request] client document rolled back but its stored object could not be deleted");
      }
    }
    throw err;
  }
}

/** A day: long enough for a client to finish the wizard over a slow connection. */
const STAGED_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Archive the staged documents nobody sent, and delete their bytes — called by
 * the media-reconcile pass (jobs/handlers/media-reconcile), the compensation
 * job that already sweeps orphaned vault objects. The archive is guarded in its
 * own UPDATE, so a request linking the file while this runs wins; a byte
 * deletion that fails is logged and left for the next pass to report again.
 */
async function sweepStagedDocuments(client, { ttlMs = STAGED_TTL_MS } = {}) {
  const cutoff = new Date(Date.now() - ttlMs);
  const rows = await repo.abandonedStaged(client, cutoff);
  const out = { staged_archived: 0, staged_bytes_deleted: 0, staged_delete_failed: 0 };
  for (const r of rows) {
    if (!(await repo.archiveAbandonedStaged(client, r.doc_id))) continue;
    out.staged_archived += 1;
    if (!r.storage_path || r.storage_path.startsWith("pending://")) continue;
    try {
      await storage.delete(r.storage_path);
      out.staged_bytes_deleted += 1;
    } catch (err) {
      out.staged_delete_failed += 1;
      logger.warn({ err: err && err.message, docId: r.doc_id }, "[quote-request] abandoned staged document archived but its bytes could not be deleted");
    }
  }
  return out;
}

/* ─── the portal: what a client reads ──────────────────────────────────────── */

/** A service as a quote wizard offers it: names, card, flow, Incoterms, shape. */
function quoteServiceCard(st) {
  const { mode, flow } = serviceScope.placementOf(st);
  return {
    service_type_id: st.service_type_id,
    name_en: st.name_en || st.name_fr,
    name_fr: st.name_fr || st.name_en,
    card: mode,
    flow,
    enquiry_shape: st.enquiry_shape || "ROUTE",
    incoterms: incoterms.describe(st.incoterms || []),
  };
}

/**
 * What a quote wizard offers. The portal reads EVERY active service — an
 * existing client may need one the tenant does not market — and the website
 * only the published ones (it has its own route, /public/services).
 */
async function quoteServices(client, { publishedOnly = false } = {}) {
  const rows = await repo.quoteServices(client, { publishedOnly });
  return rows.map(quoteServiceCard);
}

/** Status from the audit action that recorded it. */
const STATUS_OF_ACTION = {
  "quote_request.created": "RECEIVED",
  "quote_request.converted": "CONVERTED_TO_OPPORTUNITY",
};
const statusOfAction = (action) =>
  STATUS_OF_ACTION[action] || String(action).replace(/^quote_request\./, "").toUpperCase();

/**
 * One request as its client reads it (meeting 6, item 2.9): the scope as sent,
 * its documents, its status as a timeline, and the proposal that answered it.
 * Scoped to the client — another company's request is a 404, not a 403. The
 * owner, the internal notes and the audit actors stay with the team.
 */
async function clientView(client, { clientId, id }) {
  const row = await repo.get(client, id);
  if (!row || row.client_id !== clientId) throw new AppError("NOT_FOUND", "No such request", 404);
  const [st, documents, events_] = await Promise.all([
    row.service_type_id ? repo.serviceTypeById(client, row.service_type_id) : null,
    repo.listAttachments(client, id),
    repo.lifecycle(client, id),
  ]);
  // A request older than its audit trail still has a beginning and a now.
  let timeline = events_.map((e) => ({ status: statusOfAction(e.action), at: e.at }));
  if (!timeline.length || timeline[0].status !== "RECEIVED") timeline = [{ status: "RECEIVED", at: row.created_at }, ...timeline];
  if (timeline[timeline.length - 1].status !== row.status) timeline.push({ status: row.status, at: row.updated_at });
  const proposal = row.converted_opportunity_id
    ? await repo.answeringProposal(client, { opportunityId: row.converted_opportunity_id, clientId })
    : null;
  return {
    quote_request_id: row.quote_request_id,
    public_ref: row.public_ref,
    status: row.status,
    created_at: row.created_at,
    service: st ? quoteServiceCard(st) : null,
    service_category: row.service_category,
    hinterland_direction: row.hinterland_direction,
    origin_location: row.origin_location,
    destination_location: row.destination_location,
    collection_location: row.collection_location,
    delivery_location: row.delivery_location,
    warehouse_location: row.warehouse_location,
    warehouse_duration: row.warehouse_duration,
    incoterm: row.incoterm,
    estimated_weight: row.estimated_weight,
    cargo_description: row.cargo_description,
    requester_name: row.requester_name,
    documents: documents.map((d) => ({
      id: d.id, name: d.original_name, document_kind: d.document_kind, kind: d.kind, created_at: d.created_at,
    })),
    timeline,
    proposal,
    // PR 4 (meeting 6) adds the Commercial quotation that answered the request
    // here, beside the proposal — null until then.
    quotation: null,
  };
}

/** One of the request's documents, for its client to download. */
async function clientDocument(client, { clientId, id, attachmentId }) {
  const row = await repo.get(client, id);
  if (!row || row.client_id !== clientId) throw new AppError("NOT_FOUND", "No such request", 404);
  const link = await repo.getAttachment(client, { quote_request_id: id, attachment_id: attachmentId });
  if (!link) throw new AppError("NOT_FOUND", "No such document on this request", 404);
  return vault.fetchBytes(client, link.vault_id);
}

/* ─── reads ───────────────────────────────────────────────────────────────── */

const get = (client, id) => repo.get(client, id);

/**
 * List + the KPI tiles.
 *
 * The fold lives in `rules.kpiFrom`, which derives one tile per status from the
 * status list itself, and `assertPartitions` proves the tiles add up to TOTAL
 * before the response leaves. The previous version hand-listed four tiles while
 * the CHECK constraint allowed six, so every CLARIFICATION_REQUIRED and
 * CLOSED_NO_ACTION row was counted into TOTAL and shown in no tile — the
 * register disagreed with itself, which is the legacy defect verbatim.
 */
async function list(client, q = {}) {
  const { rows, total, kpiRows, limit, offset } = await repo.list(client, q);
  const kpi = rules.kpiFrom(kpiRows);
  rules.assertPartitions(kpi);
  return { rows, total, kpi, limit, offset };
}

/** Every matching row, for the CSV export. `truncated` is reported, never hidden. */
const listForExport = (client, q = {}) => repo.listForExport(client, q, EXPORT_CAP);

module.exports = {
  create, update, transition, convertToOpportunity,
  uploadAttachment, removeAttachment, listAttachments, fileFromChat,
  clientMatch, quoteServices, quoteServiceCard,
  stageClientDocument, addClientDocument, sweepStagedDocuments, clientView, clientDocument,
  get, list, listForExport,
  resolveEntityId, resolveService, assertIncotermOffered, linkDocuments,
  ATTACHMENT_MAX_BYTES, ATTACHMENT_TYPES, EXPORT_CAP, STAGED_TTL_MS,
};
