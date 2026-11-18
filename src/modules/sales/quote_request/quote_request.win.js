/**
 * A request is WON: one function for every way it happens
 * (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.4 "Acceptance", §5.2; owner decision D7).
 *
 * A quotation accepted on its link, in the portal or recorded by staff, and
 * Mark Won pressed by hand all end here, and do the same things in the same
 * order:
 *
 *   1. the request is WON (stage and settle date);
 *   2. a prospect becomes a client: Make Client from the row's own facts, as
 *      the DRAFT client_master starts as, and the row keeps going as a Client;
 *   3. the operations file opens from the request (its client, service type,
 *      route, weight, cargo and entity) and the request points at it;
 *   4. the owner is told.
 *
 * ── IDEMPOTENT, BECAUSE DELIVERY IS AT-LEAST-ONCE ───────────────────────────
 *
 * The acceptance path runs from the outbox (`quotation.accepted:win-request`),
 * which may deliver the same event twice, and twice at once. The request row is
 * locked FOR UPDATE before anything is read, so a second run waits for the
 * first, then finds the request WON with its file and does nothing. A run whose
 * file could not open (below) leaves `dossier_id` empty, so the next delivery
 * tries the file again and never wins the request twice.
 *
 * ── A WIN NEVER FAILS OVER ITS FOLLOW-ON WORK ───────────────────────────────
 *
 * The client said yes; that is a fact whatever else goes wrong. Making the
 * client and opening the file each run under a SAVEPOINT: a tenant rule the
 * row cannot meet (a phone required on every client, a field the service
 * type's form requires before a file opens, a client on hard block) rolls back
 * that step alone. The request is still won, and the owner is told exactly what
 * to finish by hand. Everything else (a dead connection, a bug) rolls the whole
 * win back and the outbox retries it.
 *
 * Replaces `orchestration/handlers/opportunity-won-open-dossier.js`.
 */
"use strict";

const repo = require("./quote_request.repo");
const events = require("./quote_request.events");
const dossierSvc = require("../../operations/operations_file/operations_file.service");
const { incoterms } = require("@praxis/shared");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { atomically } = require("../../../shared/db/tx");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

const ref = (id) => "quote_request:" + id;
const leads = () => require("../lead/lead.service");

/** Run `fn` under a savepoint: a refusal rolls back this step and is returned, not thrown. */
async function step(client, name, fn) {
  await client.query(`SAVEPOINT ${name}`);
  try {
    const out = await fn();
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return { ok: true, out };
  } catch (err) {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    // Only a refusal (a 4xx the tenant's rules raised) is survivable; anything
    // else is a fault the outbox should see and retry.
    if (err instanceof AppError && err.status < 500) return { ok: false, err };
    throw err;
  }
}

/** The tenant's single active entity, or null when there are several. */
async function onlyEntity(client) {
  const { rows } = await client.query("SELECT entity_id FROM corporate_entity WHERE is_active IS NOT false LIMIT 2");
  return rows.length === 1 ? rows[0].entity_id : null;
}

/** The ICC codes only: "Not sure" and "none" are not terms a file can carry. */
const fileIncoterm = (term) => {
  const t = term ? String(term).toUpperCase() : null;
  return t && t !== incoterms.NOT_SURE && t !== incoterms.NOT_APPLICABLE ? t : null;
};

/** What the file is called: the deal's own title, else the company and the service. */
const fileTitle = (q, companyName) =>
  q.title || [companyName, q.service_category].filter(Boolean).join(" · ") || q.public_ref || "Won request";

/**
 * The route and cargo the file opens with: everything the request already
 * knows, so nothing is typed twice (§0, "turn a yes into work"). Only what the
 * request holds; a field it does not hold stays off the file.
 */
function routeOf(q) {
  const data = {};
  const term = fileIncoterm(q.incoterm);
  if (term) data.incoterm = term;
  if (q.origin_location) data.pol = q.origin_location;
  if (q.destination_location) data.pod = q.destination_location;
  if (q.collection_location) data.place_receipt = q.collection_location;
  if (q.delivery_location) data.place_delivery = q.delivery_location;
  if (q.estimated_weight !== null && q.estimated_weight !== undefined) {
    data.gross_weight = Number(q.estimated_weight);
    data.weight_unit = "KG";
  }
  if (q.cargo_description) data.commodity_desc = q.cargo_description;
  return data;
}

/** Tell the owner, by name, what the win did and what is left for them. */
async function tellOwner(client, { request, lead, dossier, clientError, dossierError }) {
  const userId = request.owner_user_id || (lead && lead.owner_user_id);
  if (!userId) return;
  const company = (lead && lead.company_name) || request.requester_company || "A client";
  const left = [
    clientError ? `Make the client by hand: ${clientError.message}` : null,
    dossierError ? `Open the operations file by hand: ${dossierError.message}` : null,
  ].filter(Boolean);
  try {
    const { notify } = require("../../notification/notification.service");
    await notify(client, {
      userId,
      eventTypeKey: events.WON,
      title: `${company}: request won`,
      body: left.length ? left.join(". ") : dossier ? `Operations file ${dossier.ref || ""} opened.`.replace(" .", ".") : "Request won.",
      entityRef: ref(request.quote_request_id),
      priority: left.length ? "HIGH" : "NORMAL",
      url: `/sales/leads/${request.lead_id}?request=${request.quote_request_id}`,
      dedupeKey: `quote-request-won:${request.quote_request_id}:${dossier ? "file" : "nofile"}`,
    });
  } catch (err) {
    logger.warn({ err, quoteRequestId: request.quote_request_id }, "[quote-request] win notice not sent");
  }
}

/**
 * Win a request.
 *
 *   via         MANUAL (Mark Won) or QUOTATION (an acceptance; `quotationId` says which)
 *   entityId    the corporate entity for the file, when the tenant has several
 *               and neither the request nor its company names one
 *
 * Mark Won is refused on a request already lost; an acceptance is not (the
 * client came back and said yes, which is the fact that counts).
 */
async function win(client, { id, via = "MANUAL", quotationId = null, entityId = null, actor = {} }) {
  let created = null;
  const result = await atomically(client, async () => {
    const { rows } = await client.query("SELECT * FROM quote_request WHERE quote_request_id = $1 FOR UPDATE", [id]);
    const before = rows[0];
    if (!before) throw new AppError("NOT_FOUND", "Quote request not found", 404);
    if (before.stage === "WON" && before.dossier_id) {
      return { request: before, dossier_id: before.dossier_id, already: true };
    }
    if (before.stage === "LOST" && via === "MANUAL") {
      throw new AppError("REQUEST_SETTLED", "This request is already lost", 409);
    }
    const firstWin = before.stage !== "WON";

    // 1. Won.
    let request = before;
    if (firstWin) {
      request = await repo.update(client, id, {
        stage: "WON",
        settled_at: new Date().toISOString(),
        lost_reason_code: null,
        lost_reason: null,
      });
    }

    // 2. A prospect becomes a client.
    const { rows: leadRows } = await client.query("SELECT * FROM lead WHERE lead_id = $1", [request.lead_id]);
    let lead = leadRows[0] || null;
    let clientError = null;
    if (lead && !lead.client_id) {
      const made = await step(client, "win_make_client", () =>
        leads().makeClient(client, { id: lead.lead_id, actor, strict: false }));
      if (made.ok) {
        lead = { ...lead, client_id: made.out.client_id };
        request = await repo.get(client, id);
      } else {
        clientError = made.err;
      }
    }
    const clientId = request.client_id || (lead && lead.client_id) || null;

    // 3. The operations file.
    let dossierError = null;
    const fileEntity = entityId || request.entity_id || (lead && lead.entity_id) || (await onlyEntity(client));
    if (!fileEntity) {
      dossierError = new AppError("ENTITY_REQUIRED", "say which corporate entity the file belongs to", 422);
    } else {
      const opened = await step(client, "win_open_file", () =>
        dossierSvc.insertForCreate(client, {
          data: {
            entity_id: fileEntity,
            client_id: clientId,
            service_type_id: request.service_type_id || null,
            title: fileTitle(request, lead && lead.company_name),
            owner_sales_id: request.owner_user_id || null,
            ...routeOf(request),
          },
          actor,
        }));
      if (opened.ok) {
        created = opened.out;
        request = await repo.update(client, id, { dossier_id: created.dossier_id });
      } else {
        dossierError = opened.err;
      }
    }

    // 4. Said and recorded.
    await emitEvent(client, {
      eventTypeKey: events.WON, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null,
      payload: {
        via, quotation_id: quotationId, lead_id: request.lead_id, client_id: clientId,
        dossier_id: request.dossier_id || null, first_win: firstWin,
        client_pending: clientError ? clientError.code : null, file_pending: dossierError ? dossierError.code : null,
      },
    });
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.WON, moduleKey: events.MODULE, entityRef: ref(id),
      before: { stage: before.stage, dossier_id: before.dossier_id },
      after: { stage: "WON", dossier_id: request.dossier_id || null, client_id: clientId, via, quotation_id: quotationId },
    });
    await tellOwner(client, { request, lead, dossier: created, clientError, dossierError });
    return {
      request,
      dossier_id: request.dossier_id || null,
      client_id: clientId,
      client_pending: clientError ? { code: clientError.code, message: clientError.message } : null,
      file_pending: dossierError ? { code: dossierError.code, message: dossierError.message } : null,
      already: false,
    };
  });

  // The file's milestones and places, only once the file and its link have
  // committed: these own their transactions and may wait on a geocoder.
  if (created) {
    try {
      await dossierSvc.initializeCreated(client, { dossier: created, actor });
    } catch (err) {
      logger.warn({ err, dossierId: created.dossier_id }, "[quote-request] file opened by a win, but its milestones could not be set up yet");
    }
  }
  return result;
}

module.exports = { win, routeOf, fileTitle, fileIncoterm };
