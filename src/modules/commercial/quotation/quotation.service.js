/**
 * Quotation (MOD-27) — the priced offer between opportunity and final invoice.
 * Lifecycle: createDraft → updateDraft → send (number+capture) → accept (→ can
 * convert into a final-invoice DRAFT from its lines) / reject / expire. Totals
 * recomputed on every edit; VAT rate from tenant settings. All SQL is in the repo.
 *
 * Meeting 6, PR 4 added three things:
 *
 *   · FROM A COSTING IN ONE CLICK (G1) — `fromCostingPreview` / `createFromCosting`
 *     price a costing with the margin simulator's own rules (débours at cost,
 *     services at the tenant's target margin, own costs not billed but kept as
 *     the floor), open a DRAFT, and keep the workings as a linked margin
 *     simulation the pricer is never walked through.
 *   · THE REQUEST IT ANSWERS — `quote_request_id`, picked by staff (or found
 *     through an opportunity from before the lean revamp, whose request 14512
 *     made); the portal's request page reads it. Since the revamp it is the one
 *     link: sending the quotation moves the request to Quoted, and accepting it
 *     wins the request (`quotation.accepted:win-request`).
 *   · THE CLIENT'S ANSWER — `accept` takes who at the client accepted, and
 *     `decline` records their reason (portal_quotation.service drives both,
 *     through the signature programme exactly as proposals do — G4).
 *
 * Every write runs through `atomically`, not a raw BEGIN/COMMIT: the one-click
 * path creates the quotation AND its workings in one transaction, and a raw
 * COMMIT in here would commit that transaction half-made.
 */
"use strict";

const repo = require("./quotation.repo");
const events = require("./quotation.events");
const rules = require("./quotation.rules");
const { assertTransition, computeTotals, normaliseFamilyOrder, COSTING_QUOTABLE, assertLanguage, assertOutput, assertParty } = rules;
const quotationSections = require("./quotation.sections");
const finalInvoice = require("../../finance/final_invoice/final_invoice.service");
const numbering = require("../../../services/documents/numbering.service");
const documents = require("../../../services/documents/document.service");
const { getRule } = require("../../../shared/config/settings");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { atomically } = require("../../../shared/db/tx");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "quotation:" + id;

async function vatRate(client) { return getRule(client, "finance", "vat", "rate_percent", 19.25); }

/** The tenant's target margin for a quotation priced from a costing (14381; 0 % when unset). */
async function targetMargin(client) {
  const v = Number(await getRule(client, "commercial", "quotation", "target_margin_percent", 0));
  return Number.isFinite(v) && v >= 0 && v < 100 ? v : 0;
}

async function replaceLines(client, id, lines) {
  await repo.deleteLines(client, id);
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    /// eslint-disable-next-line no-await-in-loop
    // container_type_ref_id (0663): which box the line was priced for, carried
    // through from the costing sheet so the quote says what it is quoting.
    await repo.insertLine(client, { quotation_id: id, dictionary_item_id: l.dictionary_item_id || null, label: l.label || "Line", qty: l.qty || 1, unit_price: l.unit_price || 0, is_disbursement: l.is_disbursement === true, tax_code_id: l.is_disbursement === true ? null : l.tax_code_id || null, container_type_ref_id: l.container_type_ref_id || null, client_heading: l.client_heading && String(l.client_heading).trim() ? String(l.client_heading).trim() : null, line_no: i + 1 });
  }
}
async function recompute(client, id) {
  const lines = await repo.listLines(client, id);
  const totals = computeTotals(lines, await vatRate(client));
  return repo.update(client, id, { total_ht: totals.total_ht, total_ttc: totals.total_ttc });
}

/**
 * The request a quotation answers. An explicit pick wins, and must belong to
 * the quotation's client (a request with no client yet — a prospect — is
 * allowed: the quotation is what ties them together). Without one, the
 * request the opportunity was converted from.
 */
async function resolveQuoteRequest(client, { quoteRequestId, opportunityId, clientId }) {
  if (quoteRequestId) {
    const qr = await repo.quoteRequestHead(client, quoteRequestId);
    if (!qr) throw new AppError("QUOTE_REQUEST_NOT_FOUND", "That quote request does not exist", 422);
    if (clientId && qr.client_id && qr.client_id !== clientId) {
      throw new AppError("QUOTE_REQUEST_OTHER_CLIENT", "That quote request belongs to another client", 422);
    }
    return qr.quote_request_id;
  }
  return opportunityId ? repo.quoteRequestForOpportunity(client, opportunityId) : null;
}

/** The request, with what Your Needs and the template pick read from it. */
async function requestFull(client, id) {
  if (!id) return null;
  const { rows } = await client.query(
    `SELECT qr.*, COALESCE(st.name_en, st.name_fr) AS service_name_en, COALESCE(st.name_fr, st.name_en) AS service_name_fr
       FROM quote_request qr LEFT JOIN service_type st ON st.service_type_id = qr.service_type_id
      WHERE qr.quote_request_id = $1`,
    [id],
  );
  return rows[0] || null;
}

/** A company row named by a caller: it must exist, and a merged one files on its keeper. */
async function resolveLead(client, leadId) {
  if (!leadId) return null;
  const lead = await repo.leadHead(client, leadId);
  if (!lead) throw new AppError("LEAD_NOT_FOUND", "That company does not exist", 422, { lead_id: ["no such company"] });
  return lead.merged_into_lead_id ? repo.leadHead(client, lead.merged_into_lead_id) : lead;
}

/** The language a prospect reads, from its row: EN or FR, else the tenant's default (null). */
const languageOfLead = (lead) => {
  const l = lead && lead.preferred_language ? String(lead.preferred_language).toUpperCase().slice(0, 2) : null;
  return l === "EN" || l === "FR" ? l : null;
};

/**
 * Create a DRAFT. Since the lean revamp (PR 4) a quotation is the one priced
 * document: it names the client or the prospect's company row (`lead_id`), its
 * sections are copied from the template for the request's service (else the
 * default), Your Needs is prefilled from the request and the latest discovery,
 * and it prints as a Full Proposal unless told otherwise.
 *
 * `opportunity_id` is still read, to find the request an old opportunity
 * became, and never written: the request is the one link (§4.2).
 */
async function createDraft(client, { data, actor = {} }) {
  assertLanguage(data.language);
  assertOutput(data.default_output);
  const id = await atomically(client, async () => {
    const quoteRequestId = await resolveQuoteRequest(client, {
      quoteRequestId: data.quote_request_id || null, opportunityId: data.opportunity_id || null, clientId: data.client_id || null,
    });
    const request = await requestFull(client, quoteRequestId);
    let lead = await resolveLead(client, data.lead_id || (request && request.lead_id) || null);
    const clientId = data.client_id || (request && request.client_id) || (lead && lead.client_id) || null;
    if (!lead && clientId) lead = await resolveLead(client, await repo.leadOfClient(client, clientId));
    if (lead && clientId && lead.client_id && lead.client_id !== clientId) {
      throw new AppError("QUOTATION_PARTY_MISMATCH", "That company row belongs to another client", 422, { lead_id: ["belongs to another client"] });
    }
    const template = data.template_id
      ? await repo.getTemplate(client, data.template_id)
      : await repo.templateFor(client, request ? request.service_type_id : null);
    if (data.template_id && (!template || !template.active)) {
      throw new AppError("TEMPLATE_NOT_FOUND", "That quotation template does not exist", 422, { template_id: ["no such template"] });
    }
    const q = await repo.insert(client, {
      entity_id: data.entity_id || (request && request.entity_id) || (lead && lead.entity_id) || null,
      client_id: clientId, lead_id: lead ? lead.lead_id : null,
      dossier_id: data.dossier_id || null,
      costing_id: data.costing_id || null, currency: data.currency || "XAF",
      quote_model: data.quote_model || "HT_ON_TOP", margin_percent: data.margin_percent ?? null, valid_until: data.valid_until || null, status: "DRAFT",
      quote_request_id: quoteRequestId,
      family_order: data.family_order ? JSON.stringify(normaliseFamilyOrder(data.family_order)) : null,
      created_from: data.created_from || "MANUAL",
      own_cost_total: data.own_cost_total ?? null,
      title: data.title || (request && request.title) || null,
      language: data.language || languageOfLead(lead),
      default_output: data.default_output || "FULL",
      template_id: template ? template.template_id : null,
      version: 1,
    });
    // The sections: the template's, Your Needs from the request and discovery,
    // then whatever the caller wrote over them.
    const discovery = lead || clientId
      ? await require("../../sales/meeting/meeting.repo").latestDiscovery(client, { leadId: lead ? lead.lead_id : null, clientId })
      : null;
    let rows = quotationSections.fromTemplate(template, {
      request, discovery, serviceName: request ? request.service_name_en : null,
    });
    if (request && request.service_name_fr) {
      const fr = quotationSections.needsText({ request, discovery, serviceName: request.service_name_fr }, "FR");
      rows = rows.map((r) => (r.section_key === "needs" ? { ...r, body_fr: fr } : r));
    }
    if (Array.isArray(data.sections) && data.sections.length) rows = quotationSections.merge(rows, data.sections);
    await quotationSections.assertStories(client, rows);
    await quotationSections.write(client, q.quotation_id, rows);
    if (data.lines && data.lines.length) { await replaceLines(client, q.quotation_id, data.lines); await recompute(client, q.quotation_id); }
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(q.quotation_id), after: q });
    return q.quotation_id;
  });
  return get(client, id);
}

// `opportunity_id` is accepted to FIND a request (an old screen may still send
// it) and never stored: the request is the one link (§4.2, PR 7 drops it).
const PATCHABLE = [
  "client_id", "lead_id", "dossier_id", "costing_id", "currency", "quote_model", "margin_percent", "valid_until",
  "quote_request_id", "family_order", "title", "language", "default_output", "entity_id",
];

async function updateDraft(client, { id, patch = {}, lines = null, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quotation not found", 404);
  if (before.status !== "DRAFT") throw new AppError("LOCKED", "Only a DRAFT quotation can be edited", 422);
  assertLanguage(patch.language);
  assertOutput(patch.default_output);
  await atomically(client, async () => {
    const fields = {};
    for (const k of PATCHABLE) if (patch[k] !== undefined) fields[k] = patch[k];
    if (fields.family_order !== undefined) fields.family_order = fields.family_order ? JSON.stringify(normaliseFamilyOrder(fields.family_order)) : null;
    if (fields.quote_request_id !== undefined || patch.opportunity_id !== undefined) {
      fields.quote_request_id = await resolveQuoteRequest(client, {
        quoteRequestId: fields.quote_request_id !== undefined ? fields.quote_request_id : before.quote_request_id,
        opportunityId: patch.opportunity_id || null,
        clientId: fields.client_id !== undefined ? fields.client_id : before.client_id,
      });
    }
    if (fields.lead_id) fields.lead_id = (await resolveLead(client, fields.lead_id)).lead_id;
    if (Object.keys(fields).length) await repo.update(client, id, fields);
    if (Array.isArray(patch.sections)) {
      const rows = quotationSections.merge(await quotationSections.read(client, id), patch.sections);
      await quotationSections.assertStories(client, rows);
      await quotationSections.write(client, id, rows);
    }
    if (Array.isArray(lines)) { await replaceLines(client, id, lines); await recompute(client, id); }
    await audit(client, { actorUserId: actor.user_id || null, action: "quotation.updated", moduleKey: events.MODULE, entityRef: ref(id), before: { status: before.status }, after: { fields: Object.keys(fields), lines: Array.isArray(lines) ? lines.length : null, sections: Array.isArray(patch.sections) ? patch.sections.map((x) => x.section_key) : null } });
  });
  return get(client, id);
}

/**
 * The request a SENT quotation answers, made when a prospect's quotation has
 * none (typed for a company row directly, or migrated from a proposal that
 * answered no opportunity). Every acceptance of a prospect then wins a request,
 * which is what makes the prospect a client and opens the file (D7): the win
 * runs in `quotation.accepted:win-request`, the only win path.
 *
 * A quotation typed for a client with no company row and no request still has
 * nothing to win, exactly as before the revamp.
 */
async function ensureRequest(client, row, actor = {}) {
  if (row.quote_request_id) return row;
  const leadId = row.lead_id || (row.client_id ? await repo.leadOfClient(client, row.client_id) : null);
  if (!leadId) return row;
  const made = await require("../../sales/quote_request/quote_request.service").create(client, {
    data: {
      lead_id: leadId,
      client_id: row.client_id || null,
      entity_id: row.entity_id || null,
      intake_channel: "MANUAL",
      title: row.title || null,
      currency: row.currency || null,
      estimated_value: Number(row.total_ttc) || null,
    },
    actor,
  });
  return repo.update(client, row.quotation_id, { quote_request_id: made.quote_request_id, lead_id: row.lead_id || leadId });
}

/**
 * The quotation becomes SENT: numbered, captured, the request moved to Quoted,
 * the Company Profile pinned, and the version it revises retired. Shared by
 * the plain transition and by Send (quotation.send.js), so a quotation sent
 * either way is the same quotation. Runs inside the caller's transaction.
 */
async function issue(client, { before, entityId = null, actor = {} }) {
  assertParty(before);
  // sent_by is a plain uuid, resolved like every actor write (DATA 2.4): a
  // sandbox send by a live-only user stores nobody rather than a dangling id.
  const fields = { status: "SENT", sent_at: new Date(), sent_by: await resolveActorId(client, actor.user_id) };
  if (!before.doc_number) {
    const eid = entityId || before.entity_id;
    if (!eid) throw new AppError("ENTITY_REQUIRED", "entity_id required to number the quotation", 422);
    const { number } = await numbering.allocate(client, { moduleKey: events.MODULE, entityId: eid, date: new Date().toISOString().slice(0, 10) });
    fields.doc_number = number;
    if (!before.entity_id) fields.entity_id = eid;
  }
  // About Us prints the Company Profile published today, for good (§3.4).
  if (!before.profile_version_id) {
    const { rows } = await client.query("SELECT version_id FROM company_profile_version WHERE status = 'PUBLISHED' ORDER BY number DESC LIMIT 1");
    if (rows[0]) fields.profile_version_id = rows[0].version_id;
  }
  let row = await repo.update(client, before.quotation_id, fields);
  row = await ensureRequest(client, row, actor);
  await documents.capture(client, { entityRef: ref(row.quotation_id), docType: "QUOTATION", status: "VERIFIED" });
  // Sending a quotation moves the request it answers to Quoted, never
  // backwards (lean revamp §3.2). Required lazily: the request service is a
  // Sales module and this one is Commercial.
  if (row.quote_request_id) {
    await require("../../sales/quote_request/quote_request.service").moveStage(client, {
      id: row.quote_request_id, stage: "QUOTED", actor, auto: true,
    });
  }
  // Sending v2 withdraws v1: its link stops opening and its offer expires.
  if (row.supersedes_id) {
    const { rows: old } = await client.query(
      `UPDATE quotation
          SET share_revoked_at = COALESCE(share_revoked_at, now()), superseded_at = now(),
              status = CASE WHEN status = 'SENT' THEN 'EXPIRED' ELSE status END
        WHERE quotation_id = $1 AND status NOT IN ('ACCEPTED', 'CONVERTED')
        RETURNING quotation_id, status`,
      [row.supersedes_id],
    );
    if (old[0]) {
      await audit(client, { actorUserId: actor.user_id || null, action: events.SHARE_REVOKED, moduleKey: events.MODULE, entityRef: ref(row.supersedes_id), after: { superseded_by: row.quotation_id, status: old[0].status } });
    }
  }
  return row;
}

async function transition(client, { id, to, entityId = null, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quotation not found", 404);
  assertTransition(before.status, to);
  return atomically(client, async () => {
    let row;
    if (to === "SENT") {
      row = await issue(client, { before, entityId, actor });
    } else {
      const fields = { status: to };
      if (to === "REJECTED" || to === "EXPIRED") { fields.answered_at = new Date(); if (to === "REJECTED") fields.answered_via = "STAFF"; }
      row = await repo.update(client, id, fields);
    }
    // The client rides in the payload: a SENT quotation reaches the client's
    // portal (notify-portal, topic PROPOSALS) as a proposal does.
    await emitEvent(client, {
      eventTypeKey: events.transition(to), moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null,
      payload: { client_id: row.client_id || null, lead_id: row.lead_id || null, doc_number: row.doc_number || null, total_ttc: Number(row.total_ttc) || 0, currency: row.currency },
    });
    await audit(client, { actorUserId: actor.user_id || null, action: events.transition(to), moduleKey: events.MODULE, entityRef: ref(id), after: strip(row) });
    return strip(row);
  });
}

/**
 * Accept a SENT quotation; optionally convert its lines into a final-invoice
 * DRAFT. `by` is the person at the client when the client accepted it in the
 * portal (G4) — not an app user, so it is stored beside the row, never as an
 * actor id; `via` says which.
 */
/** The row, locked for the rest of the transaction. */
async function lockFor(client, id) {
  const { rows } = await client.query("SELECT * FROM quotation WHERE quotation_id = $1 FOR UPDATE", [id]);
  if (!rows[0]) throw new AppError("NOT_FOUND", "Quotation not found", 404);
  return rows[0];
}

/** Answered by someone else while this answer waited for the lock: a 409, as the portal says it. */
function assertStillOpen(locked, before) {
  if (locked.status !== before.status) {
    throw new AppError("QUOTATION_ANSWERED", "This quotation has already been answered", 409, { status: locked.status });
  }
}

const ANSWERED_VIA = ["PORTAL", "LINK", "STAFF"];
const viaOf = (via) => (ANSWERED_VIA.includes(via) ? via : "STAFF");

async function accept(client, { id, convert: convertNow = false, actor = {}, by = null, via = "STAFF" }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quotation not found", 404);
  assertTransition(before.status, "ACCEPTED");
  if (before.superseded_at) throw new AppError("QUOTATION_SUPERSEDED", "A newer version of this quotation has been sent", 409);
  return atomically(client, async () => {
    // Locked and read again: two answers at once (a double click, a retried
    // request, the link and the portal together) make ONE acceptance and one
    // `quotation.accepted`; the second finds it answered.
    const locked = await lockFor(client, id);
    assertStillOpen(locked, before);
    // A prospect's quotation always answers a request, so its yes wins one (D7).
    const linked = await ensureRequest(client, locked, actor);
    await repo.update(client, id, {
      status: "ACCEPTED", answered_at: new Date(), answered_via: viaOf(via),
      answered_by_name: by && by.name ? String(by.name).slice(0, 200) : null,
      answered_by_email: by && by.email ? String(by.email).slice(0, 320) : null,
    });
    const invoiceId = convertNow ? await convertToInvoice(client, { ...before, ...linked }, actor) : null;
    // The client and who at the client ride in the payload: an acceptance made
    // in the portal reaches the client's "who is told" list (notify-client-team).
    await emitEvent(client, {
      eventTypeKey: events.ACCEPTED, moduleKey: events.MODULE, entityRef: ref(id),
      actorUserId: actor.user_id || null,
      payload: { client_id: before.client_id || null, lead_id: linked.lead_id || null, quote_request_id: linked.quote_request_id || null, doc_number: before.doc_number || null, total_ttc: Number(before.total_ttc) || 0, currency: before.currency, via: viaOf(via), ...(by ? { by } : {}) },
    });
    await audit(client, { actorUserId: actor.user_id || null, action: events.ACCEPTED, moduleKey: events.MODULE, entityRef: ref(id), after: { invoice_id: invoiceId, via, by } });
    return { quotation: await get(client, id), invoice_id: invoiceId };
  });
}

/**
 * The quotation's lines → a final-invoice DRAFT, and the quotation CONVERTED.
 *
 * The equipment tag rides across the conversion (0663). Dropping it here
 * would be the same bug one document later: the invoice would carry two
 * identically-labelled lines at different prices and nothing saying why.
 * §2.2 — qty and unit price cross INTACT. This used to pre-multiply into a
 * single `amount`, and the invoice then stored it as one unit at that price:
 * a quotation for 40 boxes at 2,000,000 became an invoice line reading
 * "1 × 80,000,000". The quantity was not lost in the invoice, it was destroyed
 * here, one document earlier.
 *
 * It also made the quotation fail the §2.7 guard against ITSELF — the
 * conversion is the one path that is definitionally correctly priced.
 * tax_code_id travels too: it is what the printed invoice shows in its VAT
 * column, and dropping it was half of the TVA 0.00 on fb7db2f3.
 */
async function convertToInvoice(client, quotation, actor = {}) {
  const lines = await repo.listLines(client, quotation.quotation_id);
  const econLines = lines.map((l) => ({
    dictionary_item_id: l.dictionary_item_id,
    qty: Number(l.qty) || 1,
    unit_price: Number(l.unit_price) || 0,
    is_disbursement: l.is_disbursement,
    tax_code_id: l.is_disbursement === true ? null : l.tax_code_id || null,
    label: l.label,
    container_type_ref_id: l.container_type_ref_id || null,
    // 14130: the invoice prints the same families the client accepted.
    client_heading: l.client_heading || null,
  }));
  const inv = await finalInvoice.createDraft(client, { entityId: quotation.entity_id, clientId: quotation.client_id, dossierId: quotation.dossier_id, lines: econLines, actor });
  // G2: and in the order the client accepted them.
  if (quotation.family_order) {
    await client.query("UPDATE invoice SET family_order = $2::jsonb WHERE invoice_id = $1", [inv.invoice_id, JSON.stringify(quotation.family_order)]);
  }
  await repo.update(client, quotation.quotation_id, { status: "CONVERTED" });
  await emitEvent(client, { eventTypeKey: events.CONVERTED, moduleKey: events.MODULE, entityRef: ref(quotation.quotation_id), actorUserId: actor.user_id || null });
  return inv.invoice_id;
}

/**
 * ACCEPTED → a final-invoice DRAFT (meeting 6, G4: "Accepted → the team is
 * told and can turn it into an invoice draft"). A client accepting in the
 * portal never converts — that stays a staff decision — so this is the step
 * the team takes afterwards.
 */
async function convert(client, { id, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quotation not found", 404);
  assertTransition(before.status, "CONVERTED");
  return atomically(client, async () => {
    const invoiceId = await convertToInvoice(client, before, actor);
    await audit(client, { actorUserId: actor.user_id || null, action: events.CONVERTED, moduleKey: events.MODULE, entityRef: ref(id), after: { invoice_id: invoiceId } });
    return { quotation: await get(client, id), invoice_id: invoiceId };
  });
}

/**
 * The client declines a SENT quotation in the portal, with a reason (G4).
 * SENT → REJECTED, the reason kept on the row, and the team told with it —
 * "declined" alone is not something sales can act on.
 */
async function decline(client, { id, reasonCode, reason, by = null, via = "PORTAL", actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quotation not found", 404);
  assertTransition(before.status, "REJECTED");
  return atomically(client, async () => {
    const locked = await lockFor(client, id);
    assertStillOpen(locked, before);
    const row = await repo.update(client, id, {
      status: "REJECTED", answered_at: new Date(), answered_via: viaOf(via),
      answered_by_name: by && by.name ? String(by.name).slice(0, 200) : null,
      answered_by_email: by && by.email ? String(by.email).slice(0, 320) : null,
      decline_reason_code: reasonCode || null,
      decline_reason: reason ? String(reason).slice(0, 600) : null,
    });
    await emitEvent(client, {
      eventTypeKey: events.DECLINED_BY_CLIENT, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null,
      payload: { client_id: before.client_id || null, lead_id: before.lead_id || null, doc_number: before.doc_number || null, reason_code: reasonCode || null, reason: reason || null, via: viaOf(via), ...(by ? { by } : {}) },
    });
    await audit(client, { actorUserId: actor.user_id || null, action: events.DECLINED_BY_CLIENT, moduleKey: events.MODULE, entityRef: ref(id), after: { reason_code: reasonCode, reason, by, via: viaOf(via) } });
    return strip(row);
  });
}

/* ── a quotation straight from a costing (meeting 6, G1) ──────────────────── */

/**
 * The costing, read and priced once: its lines classified against the
 * catalogue (the simulator's LINK COSTING read, in the costing's own currency)
 * and run through the simulator's own rules at the tenant's target margin.
 */
async function priceCosting(client, costingId) {
  // Required lazily: the simulator's service requires THIS file (its `quote`
  // creates a quotation), so a top-level require would be a cycle.
  const simulation = require("../margin_simulation/margin_simulation.service");
  const { priceCostingLines } = require("../margin_simulation/margin_simulation.rules");
  const link = await simulation.fromCosting(client, { costingId, convert: false });
  if (!COSTING_QUOTABLE.has(link.costing.status)) {
    throw new AppError(
      "COSTING_NOT_READY",
      "A quotation is created from a costing once it has been validated or approved. This one is still being prepared.",
      422,
      { status: link.costing.status },
    );
  }
  const margin = await targetMargin(client);
  const vat = await vatRate(client);
  return { link, margin, vat, priced: priceCostingLines(link.lines, { targetMarginPercent: margin, vatRatePercent: vat }) };
}

/** A billed line as the quotation stores it. */
const quoteLineOf = (l) => ({
  dictionary_item_id: l.dictionary_item_id || null,
  label: l.label,
  qty: l.qty,
  unit_cost: l.unit_cost,
  unit_price: l.unit_price,
  is_disbursement: l.is_disbursement === true,
  tax_code_id: l.is_disbursement === true ? null : l.tax_code_id || null,
  container_type_ref_id: l.container_type_ref_id || null,
  client_heading: l.client_heading || null,
  cost_nature: l.cost_nature || null,
});

/**
 * What "Create quotation" would produce, without writing anything: the lines
 * priced, the own costs and whether the services cover them, the margin
 * applied, and the client's open requests to link it to.
 */
async function fromCostingPreview(client, { costingId }) {
  return (await buildPreview(client, costingId)).preview;
}

async function buildPreview(client, costingId) {
  const { link, margin, vat, priced } = await priceCosting(client, costingId);
  const c = link.costing;
  const requests = await repo.openQuoteRequests(client, c.client_id);
  const fresh = requests.filter((r) => !r.answered);
  const sameService = fresh.filter((r) => c.service_type_id && r.service_type_id === c.service_type_id);
  const suggested = sameService.length === 1 ? sameService[0] : fresh.length === 1 ? fresh[0] : null;
  const lines = priced.billed.map(quoteLineOf);
  const preview = {
    costing: c,
    target_margin_percent: margin,
    lines,
    own_costs: priced.own.map((l) => ({ label: l.label, qty: l.qty, unit_cost: l.unit_cost, amount: Math.round(l.qty * l.unit_cost * 100) / 100 })),
    floor: priced.floor,
    totals: computeTotals(lines, vat),
    workings: priced.totals,
    unclassified: link.unclassified,
    quote_requests: requests.map((r) => ({
      quote_request_id: r.quote_request_id, public_ref: r.public_ref, stage: r.stage, title: r.title, created_at: r.created_at,
      service_name_en: r.service_name_en || null, service_name_fr: r.service_name_fr || null, answered: r.answered === true,
    })),
    suggested_quote_request_id: suggested ? suggested.quote_request_id : null,
  };
  return { preview, priced };
}

/**
 * "Create quotation" — one click (G1). The DRAFT quotation and its workings
 * are written in one transaction: a quotation without the simulation that
 * explains its prices, or the other way round, is never left behind.
 *
 * `quoteRequestId` undefined = take the suggested request (one open request of
 * this client for this service, nothing answering it yet); null = link none.
 */
async function createFromCosting(client, { costingId, quoteRequestId = undefined, validUntil = null, actor = {} }) {
  const simulation = require("../margin_simulation/margin_simulation.service");
  const { preview, priced } = await buildPreview(client, costingId);
  const c = preview.costing;
  const requestId = quoteRequestId === undefined ? preview.suggested_quote_request_id : quoteRequestId;
  const id = await atomically(client, async () => {
    const q = await createDraft(client, {
      data: {
        entity_id: c.entity_id, client_id: c.client_id, dossier_id: c.dossier_id, costing_id: c.costing_id,
        currency: c.currency, margin_percent: preview.target_margin_percent, valid_until: validUntil,
        quote_request_id: requestId || null, family_order: c.family_order || null,
        created_from: "COSTING", own_cost_total: preview.floor.own_cost_total,
        lines: preview.lines,
      },
      actor,
    });
    // The workings: every costing line, billed ones at their price and own
    // costs at 0, so the simulation's margin is the file's real margin.
    await simulation.create(client, {
      dossierId: c.dossier_id, serviceTypeId: c.service_type_id, costingId: c.costing_id, currency: c.currency,
      lines: priced.workings.map((l) => ({
        dictionary_item_id: l.dictionary_item_id || null, label: l.label, qty: l.qty, unit_cost: l.unit_cost, unit_price: l.unit_price,
        is_disbursement: l.is_disbursement === true, vat_applicable: l.vat_applicable === true, notes: l.notes || null,
        client_heading: l.client_heading || null,
      })),
      origin: "COSTING_DIRECT", targetMarginPercent: preview.target_margin_percent, quotationId: q.quotation_id, actor,
    });
    await emitEvent(client, {
      eventTypeKey: events.CREATED_FROM_COSTING, moduleKey: events.MODULE, entityRef: ref(q.quotation_id), actorUserId: actor.user_id || null,
      payload: { costing_id: c.costing_id, client_id: c.client_id || null, target_margin_percent: preview.target_margin_percent, covered: preview.floor.covered },
    });
    return q.quotation_id;
  });
  return { ...(await get(client, id)), floor: preview.floor, unclassified: preview.unclassified };
}

/** Never handed out: the hash of the public token is a credential's fingerprint. */
function strip(row) {
  if (!row) return row;
  const { share_token_hash: hash, ...rest } = row;
  return { ...rest, share_active: Boolean(hash) && rules.linkState(row) === "OPEN" };
}

async function get(client, id) {
  const raw = await repo.get(client, id);
  if (!raw) return null;
  const q = strip(raw);
  const [lines, request, workings, costing, sections, lead, views, revision] = await Promise.all([
    repo.listLines(client, id),
    repo.quoteRequestHead(client, q.quote_request_id),
    repo.workingsFor(client, id),
    repo.costingHead(client, q.costing_id),
    quotationSections.read(client, id),
    repo.leadHead(client, q.lead_id),
    repo.listViews(client, id, 20),
    repo.openRevisionOf(client, id),
  ]);
  q.lines = lines;
  // The request it answers, the costing it was priced from and the workings
  // behind its prices — each a link on the quotation's screen.
  q.quote_request = request
    ? { quote_request_id: request.quote_request_id, public_ref: request.public_ref, stage: request.stage, title: request.title, lead_id: request.lead_id }
    : null;
  q.costing = costing;
  q.workings = workings;
  q.sections = sections;
  q.lead = lead ? { lead_id: lead.lead_id, company_name: lead.company_name, client_id: lead.client_id } : null;
  q.views = views;
  q.open_revision_id = revision;
  q.languages = rules.languagesOf(q);
  return q;
}
const list = async (client, q) => (await repo.list(client, q)).rows.map(strip);

/**
 * The Quotations list (lean revamp §3.4): one page, its total, and the totals
 * gated on finance visibility as the Leads list gates its value: without it a
 * total is null, never zero.
 */
async function listPage(client, q = {}, { canSeeFinancials = false } = {}) {
  const { rows, total } = await repo.list(client, q);
  const money = (v) => (canSeeFinancials ? v : null);
  return {
    rows: rows.map((r) => {
      const row = strip(r);
      return { ...row, total_ht: money(row.total_ht), total_ttc: money(row.total_ttc) };
    }),
    total,
    money_visible: canSeeFinancials,
  };
}

/** Decline recorded by staff (§3.4 "Decline with a reason"): the reason from the same list the link offers. */
async function declineByStaff(client, { id, reasonCode, note = null, actor = {} }) {
  const { chosenReason } = require("../../portal/portal_signing");
  const chosen = await chosenReason(client, reasonCode);
  const reason = `${chosen.label_en}${note ? `: ${String(note).slice(0, 400)}` : ""}`;
  return decline(client, { id, reasonCode, reason, by: null, via: "STAFF", actor });
}

/** The DECLINE reasons, in both languages, for the staff dialog. */
async function declineReasons(client) {
  const rows = await require("../../../services/signatures/presets").reasons(client, { kind: "DECLINE" });
  return rows.map((r) => ({ reason_code: r.reason_code, label_en: r.label_en, label_fr: r.label_fr }));
}

module.exports = {
  createDraft, updateDraft, transition, accept, convert, decline, declineByStaff, declineReasons, fromCostingPreview, createFromCosting, get, list, listPage,
  targetMargin, resolveQuoteRequest, issue, ensureRequest, strip, requestFull,
};
