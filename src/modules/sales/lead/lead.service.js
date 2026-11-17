/**
 * Lead (MOD-20) — the COMPANY ROW of Sales & CRM (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md
 * §3.2, §4.1 to §4.4; owner decisions D2, D4, D5 and D11).
 *
 * One row per company, OPEN or ARCHIVED, a Prospect until it becomes a Client
 * (`client_id`), and the client keeps the row so its later website and portal
 * requests land on it. What it asks for is a REQUEST (quote_request), which is
 * also the deal; what happened with it is an ACTIVITY; what happens next is a
 * dated NEXT STEP on somebody's desk.
 *
 * THE RULE THIS FILE EXISTS TO HOLD: every OPEN row has a next step, unless it
 * is a client with nothing open. It is the only writer of
 * `lead.next_step_task_id`, and every write that could leave an open row
 * without one either sets one in the same transaction or refuses.
 *
 * THE OTHER: one row per company. Capture refuses a company already on file
 * (same email, same phone, or the same name once folded) and says which row it
 * is; intake from the website, the portal and the enquiry desk FINDS that row
 * instead of making a second (`findOrCreateForIntake`).
 *
 * All SQL is in the repo; the next step's task rows are written by
 * lead.next-step.js on the caller's transaction.
 */
"use strict";
const repo = require("./lead.repo");
const events = require("./lead.events");
const rules = require("./lead.rules");
const nextSteps = require("./lead.next-step");
const clientMaster = require("../../master/client_master/client_master.service");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { getSetting } = require("../../../shared/config/settings");
const { timezoneOf, zonedWallClockToUtc } = require("../../dashboard/workspace/workspace.time");
const { AppError } = require("../../../utils/errors");
const { atomically } = require("../../../shared/db/tx");
const { logger } = require("../../../config/logger");
const { lead: shape } = require("@praxis/shared");

const ref = (id) => "lead:" + id;

/** The request service requires this one; reached lazily to keep the cycle out of load order. */
const requests = () => require("../quote_request/quote_request.service");

const COMPANY_FIELDS = [
  "entity_id", "company_name", "contact_name", "email", "phone", "country", "address",
  "niu", "rccm", "source", "service_interest", "client_type_hint", "payment_terms_days", "owner_user_id",
];

/** What the next step on a website or portal request says (§3.2). */
const ANSWER_REQUEST = { WEBSITE: "Answer website request", PORTAL: "Answer portal request" };
const ANSWER_WITHIN_WORKING_HOURS = 4;

/* ─── owners ──────────────────────────────────────────────────────────────── */

/**
 * Who owns a row nobody named an owner for (§3.2): the default sales owner
 * (setting `sales.default_owner`, Settings & Admin), else the first active
 * CEO-role user (for SMART, the MD), else the first person who may work leads.
 * Null only on a tenant with nobody at all who could.
 */
async function defaultOwner(client) {
  const configured = await getSetting(client, "sales", "default_owner", null);
  const fromSetting = await repo.activeUser(client, configured && configured.user_id);
  if (fromSetting) return fromSetting;
  const ceo = await repo.firstCeo(client);
  if (ceo) return ceo;
  try {
    const notificationRepo = require("../../notification/notification.repo");
    const editors = await notificationRepo.recipientsWithPermission(client, events.MODULE, "edit");
    return editors[0] || null;
  } catch (err) {
    logger.warn({ err }, "[lead] could not list who may work leads for a default owner");
    return null;
  }
}

/* ─── the clock ───────────────────────────────────────────────────────────── */

/** The tenant's wall clock, both ways, for working-hour arithmetic. */
function clockOf(timeZone) {
  // @date-format:parts built only to call formatToParts(); it renders nothing.
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone, hour12: false, weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const WEEKDAY = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const parts = (at) => {
    const p = fmt.formatToParts(new Date(at));
    const get = (t) => p.find((x) => x.type === t).value;
    return {
      year: Number(get("year")), month: Number(get("month")), day: Number(get("day")),
      hour: Number(get("hour")) % 24, minute: Number(get("minute")), weekday: WEEKDAY[get("weekday")],
    };
  };
  const instant = (x) => new Date(zonedWallClockToUtc({ year: x.year, month: x.month, day: x.day, hour: x.hour, minute: x.minute }, timeZone));
  return { parts, instant };
}

/** When the end of today is, on the tenant's clock: the Due Today tile's edge. */
async function endOfToday(client, now = new Date()) {
  const { parts, instant } = clockOf(await timezoneOf(client));
  const p = parts(now);
  return new Date(instant({ ...p, hour: 0, minute: 0 }).getTime() + 24 * 3600 * 1000).toISOString();
}

/** Four working hours from now, for a website or portal request's first answer. */
async function answerBy(client, now = new Date()) {
  const clock = clockOf(await timezoneOf(client));
  return rules.addWorkingHours(now, ANSWER_WITHIN_WORKING_HOURS, clock).toISOString();
}

/* ─── reads ───────────────────────────────────────────────────────────────── */

/** The row as every caller reads it: its live next step and whether it owes one. */
async function shapeRow(client, row) {
  if (!row) return null;
  const live = await nextSteps.current(client, row.next_step_task_id);
  const open = await repo.openRequestCount(client, row.lead_id);
  return {
    ...row,
    is_client: Boolean(row.client_id),
    open_requests: open,
    next_step: live
      ? {
          task_id: live.task_id, action: live.title, due_at: live.due_at, status: live.status,
          assigned_to: live.assigned_to, overdue: Boolean(live.due_at && new Date(live.due_at) < new Date()),
        }
      : null,
    next_step_required: rules.owesNextStep(row, open),
  };
}

async function get(client, id) {
  return shapeRow(client, await repo.get(client, id));
}

async function mustGet(client, id, { forUpdate = false } = {}) {
  const row = forUpdate ? await repo.getForUpdate(client, id) : await repo.get(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Lead not found", 404);
  if (row.merged_into_lead_id) {
    throw new AppError("LEAD_MERGED", "This company was merged into its main row", 409, { lead_id: row.merged_into_lead_id });
  }
  return row;
}

/**
 * The list (§3.2): server-paged, filtered by a chip, a tile and a search, with
 * the three tiles over the same set. Money is the masters' rule: without
 * finance visibility the value is null, never zero.
 */
async function list(client, q = {}, { userId = null, canSeeFinancials = false } = {}) {
  const todayEnd = await endOfToday(client);
  const { rows, total, tiles, limit, offset } = await repo.list(client, q, { userId, todayEnd });
  const money = (v) => (canSeeFinancials ? Number(v || 0) : null);
  return {
    rows: rows.map((r) => ({ ...r, open_value: money(r.open_value), open_currency: canSeeFinancials ? r.open_currency : null })),
    total,
    tiles: {
      due_today: tiles.due_today || 0,
      overdue: tiles.overdue || 0,
      open_value: money(tiles.open_value),
      open_currency: canSeeFinancials ? tiles.open_currency || null : null,
      money_visible: canSeeFinancials,
    },
    limit,
    offset,
  };
}

/* ─── the duplicate check ─────────────────────────────────────────────────── */

const matchedOn = (r) => [r.email_match && "email", r.phone_match && "phone", r.company_match && "company"].filter(Boolean);

/**
 * "Already here?" as the capture form types (§3.2, D5). `exact` rows matched a
 * key outright (same email, same phone, same folded name) and capture will
 * refuse them; `similar` rows only read alike and are offered, not enforced.
 * A client with no company row yet comes back with `lead_id` null and its
 * `client_id`: opening it makes its row (`clientRow`).
 */
async function duplicates(client, { company_name: company = null, email = null, phone = null, exclude_id: excludeId = null } = {}) {
  const rows = await repo.duplicates(client, { company, email, phone, excludeId });
  const out = rows.map((r) => ({
    lead_id: r.lead_id,
    client_id: r.client_id,
    company_name: r.company_name,
    contact_name: r.contact_name,
    email: r.email,
    phone: r.phone,
    status: r.status,
    is_client: Boolean(r.client_id),
    client_name: r.client_name || null,
    matched_on: matchedOn(r),
    exact: Boolean(r.email_match || r.phone_match || r.company_match),
  }));
  return { exact: out.filter((r) => r.exact), similar: out.filter((r) => !r.exact) };
}

/** Refuse a company already on file, naming the row so the form can open it. */
async function assertNotOnFile(client, keys, excludeId = null) {
  const { exact } = await duplicates(client, { ...keys, exclude_id: excludeId });
  if (!exact.length) return;
  const hit = exact[0];
  throw new AppError("LEAD_EXISTS", `Already here: ${hit.company_name}`, 409, {
    lead_id: hit.lead_id, client_id: hit.client_id, company_name: hit.company_name,
    is_client: hit.is_client, matched_on: hit.matched_on,
  });
}

/* ─── writing a next step ─────────────────────────────────────────────────── */

/**
 * Put a new next step on a row and point at it, in the caller's transaction.
 * The step a row had stays on its owner's desk as an ordinary task unless the
 * caller closes it first.
 */
async function pointAt(client, { lead, step, actor }) {
  const assignee = step.assigned_to || lead.owner_user_id || actor.user_id || null;
  const task = await nextSteps.create(client, {
    leadId: lead.lead_id, action: step.action, dueAt: step.due_at,
    assignedTo: assignee, createdBy: actor.user_id || assignee,
  });
  await repo.update(client, lead.lead_id, { next_step_task_id: task.task_id });
  await emitEvent(client, { eventTypeKey: events.NEXT_STEP_SET, moduleKey: events.MODULE, entityRef: ref(lead.lead_id), actorUserId: actor.user_id || null, payload: { task_id: task.task_id, due_at: task.due_at } });
  return task;
}

/* ─── capture ─────────────────────────────────────────────────────────────── */

/**
 * Capture Lead (§3.2): a company or person, a phone or an email, a dated next
 * step, and optionally what they need, which opens their first request. A
 * company already on file is refused with the row it is (409 LEAD_EXISTS):
 * the form offers to open it instead.
 */
async function capture(client, { data, actor = {} }) {
  await assertNotOnFile(client, { company_name: data.company_name, email: data.email, phone: data.phone });
  const owner = (await repo.activeUser(client, data.owner_user_id))
    || (await resolveActorId(client, actor.user_id))
    || (await defaultOwner(client));
  let created = null;
  const out = await atomically(client, async () => {
    const row = await repo.insert(client, {
      entity_id: data.entity_id || null,
      company_name: data.company_name,
      contact_name: data.contact_name || null,
      email: data.email || null,
      phone: data.phone || null,
      country: data.country || null,
      address: data.address || null,
      niu: data.niu || null,
      rccm: data.rccm || null,
      source: data.source || "MANUAL",
      intake_channel: data.source || "MANUAL",
      service_interest: data.service_interest || null,
      client_type_hint: data.client_type_hint || null,
      payment_terms_days: data.payment_terms_days ?? null,
      status: "OPEN",
      owner_user_id: owner,
      details_json: JSON.stringify(data.details || {}),
    });
    created = await pointAt(client, { lead: row, step: data.next_step, actor });
    // What Do They Need? opens the first request on the new row.
    const request = data.service_type_id
      ? await requests().create(client, {
          data: {
            lead_id: row.lead_id, service_type_id: data.service_type_id, intake_channel: "MANUAL",
            requester_company: row.company_name, requester_name: row.contact_name,
            requester_email: row.email, requester_phone: row.phone, owner_user_id: owner,
          },
          actor,
          options: { fromCapture: true },
        })
      : null;
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.lead_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.lead_id), after: row });
    return { lead_id: row.lead_id, request };
  });
  await nextSteps.tellAssignee(client, created);
  return { ...(await get(client, out.lead_id)), request: out.request };
}

/* ─── one row per company: intake ─────────────────────────────────────────── */

/**
 * The company row of a client: found, or made from the client master's facts
 * (as a Client, its account manager the owner). Used by the portal, by
 * "Open It" on a client the duplicate check found, and by intake.
 */
async function clientRow(client, { clientId, actor = {} }) {
  const existing = await repo.forClient(client, clientId);
  if (existing) return existing;
  const facts = await repo.clientFacts(client, clientId);
  if (!facts) throw new AppError("CLIENT_NOT_FOUND", "That client does not exist", 422, { client_id: ["no such client"] });
  const owner = facts.account_manager_user_id || (await defaultOwner(client));
  return atomically(client, async () => {
    // Two requests from one client at once both find no row; the unique index
    // lets one insert, and the other reads what it made.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('lead:client:' || $1::text))", [clientId]);
    const again = await repo.forClient(client, clientId);
    if (again) return again;
    const row = await repo.insert(client, {
      entity_id: facts.entity_id || null,
      company_name: facts.name,
      email: facts.email || null,
      phone: facts.phone || null,
      country: facts.country_code || null,
      address: facts.address || null,
      niu: facts.niu || null,
      rccm: facts.rccm || null,
      source: "MANUAL",
      intake_channel: "MANUAL",
      status: "OPEN",
      owner_user_id: owner,
      client_id: clientId,
      payment_terms_days: facts.payment_terms_days ?? null,
      details_json: JSON.stringify({}),
    });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.lead_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.lead_id), after: row });
    return row;
  });
}

/**
 * Where a request from outside lands (§3.8): the client's row when the client
 * is known (the portal), else the row whose email, then phone, then folded
 * company name matches, else a new prospect row. An archived row is reopened.
 *
 * Every arrival puts a next step on the row ("Answer website request", due
 * within four working hours) unless its current one is already sooner; the step
 * it had stays on its owner's desk either way.
 *
 * Runs on the caller's transaction (the website's submit, the portal's create).
 */
async function findOrCreateForIntake(client, { requester = {}, clientId = null, channel = "WEBSITE", entityId = null, actor = {} }) {
  return atomically(client, async () => {
    let row = null;
    let created = false;
    if (clientId) {
      row = await clientRow(client, { clientId, actor });
    } else {
      // One arrival at a time per address: two submissions from one person in
      // the same second must land on one row, not race to make two.
      const lockKey = String(requester.email || requester.phone || requester.company || "").toLowerCase().trim();
      if (lockKey) await client.query("SELECT pg_advisory_xact_lock(hashtext('lead:intake:' || $1::text))", [lockKey]);
      const { exact } = await duplicates(client, {
        company_name: requester.company || null, email: requester.email || null, phone: requester.phone || null,
      });
      // Email, then phone, then the folded company name (§3.8): in that order of trust.
      const pick = ["email", "phone", "company"]
        .map((key) => exact.find((d) => d.matched_on.includes(key)))
        .find(Boolean);
      if (pick && pick.lead_id) row = await repo.get(client, pick.lead_id);
      else if (pick && pick.client_id) row = await clientRow(client, { clientId: pick.client_id, actor });
    }
    if (!row) {
      const source = shape.SOURCES.includes(channel) ? channel : "MANUAL";
      row = await repo.insert(client, {
        entity_id: entityId || null,
        company_name: requester.company || requester.name || requester.email || requester.phone || "Website request",
        contact_name: requester.name || null,
        email: requester.email || null,
        phone: requester.phone || null,
        source,
        intake_channel: source,
        service_interest: requester.service || null,
        status: "OPEN",
        owner_user_id: await defaultOwner(client),
        details_json: JSON.stringify(requester.details || {}),
      });
      created = true;
      await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.lead_id), actorUserId: actor.user_id || null });
      await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.lead_id), after: row });
    } else if (row.status === "ARCHIVED") {
      row = await repo.update(client, row.lead_id, { status: "OPEN", archived_reason: null, archived_at: null });
      await emitEvent(client, { eventTypeKey: events.REOPENED, moduleKey: events.MODULE, entityRef: ref(row.lead_id), actorUserId: actor.user_id || null, payload: { by: channel } });
    }
    if (!row.owner_user_id) {
      row = await repo.update(client, row.lead_id, { owner_user_id: await defaultOwner(client) });
    }
    return { lead: row, created };
  });
}

/**
 * Put a dated step on an open row unless the one it has is due sooner, which
 * stays (the step it had stays on its owner's desk either way). For a website
 * or portal arrival, and for an enquiry raised as a lead.
 */
async function ensureStepBy(client, { leadId, action, dueAt, assignedTo = null, actor = {} }) {
  const row = await repo.get(client, leadId);
  if (!row || row.status !== "OPEN") return null;
  const live = await nextSteps.current(client, row.next_step_task_id);
  if (live && live.due_at && new Date(live.due_at) <= new Date(dueAt)) return live;
  if (!assignedTo && !row.owner_user_id && !actor.user_id) {
    logger.error({ leadId }, "[lead] a step is owed on a row nobody can own: no default owner, CEO or sales editor");
    return null;
  }
  return pointAt(client, {
    lead: row,
    step: { action, due_at: dueAt, assigned_to: assignedTo || null },
    actor: { user_id: actor.user_id || null },
  });
}

/**
 * The next step an arrival owes: "Answer website request" within four working
 * hours (§3.2). Called by the request service once the request exists, in the
 * same transaction.
 */
async function stepForArrival(client, { leadId, channel, actor = {} }) {
  return ensureStepBy(client, {
    leadId, action: ANSWER_REQUEST[channel] || "Answer request", dueAt: await answerBy(client), actor,
  });
}

/* ─── edits ───────────────────────────────────────────────────────────────── */

async function update(client, { id, patch = {}, actor = {} }) {
  const before = await mustGet(client, id);
  const fields = {};
  for (const k of COMPANY_FIELDS) if (patch[k] !== undefined) fields[k] = patch[k];
  if (fields.source) fields.intake_channel = fields.source;
  // A rename onto another company's name, email or phone would make two rows
  // for one company through the back door.
  const keysChanged = ["company_name", "email", "phone"].some((k) => fields[k] !== undefined && fields[k] !== before[k]);
  if (keysChanged) {
    await assertNotOnFile(client, {
      company_name: fields.company_name !== undefined ? fields.company_name : null,
      email: fields.email !== undefined ? fields.email : null,
      phone: fields.phone !== undefined ? fields.phone : null,
    }, id);
  }
  const row = await atomically(client, async () => {
    const r = await repo.update(client, id, fields);
    await emitEvent(client, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: r });
    return r;
  });
  return shapeRow(client, row);
}

/* ─── activities and the loop ─────────────────────────────────────────────── */

async function writeActivity(client, { lead, data, actor }) {
  if (data.quote_request_id && !(await repo.requestOnLead(client, { leadId: lead.lead_id, quoteRequestId: data.quote_request_id }))) {
    throw new AppError("VALIDATION_ERROR", "That request is not this company's", 422, { quote_request_id: ["not a request of this company"] });
  }
  const row = await repo.insertActivity(client, {
    lead_id: lead.lead_id,
    quote_request_id: data.quote_request_id || null,
    kind: data.kind,
    body: data.body,
    occurred_at: data.occurred_at ? (await nextSteps.dueInstant(client, data.occurred_at)).at : new Date().toISOString(),
    author_user_id: await resolveActorId(client, actor.user_id),
  });
  await emitEvent(client, { eventTypeKey: events.ACTIVITY_LOGGED, moduleKey: events.MODULE, entityRef: ref(lead.lead_id), actorUserId: actor.user_id || null, payload: { kind: row.kind, lead_activity_id: row.lead_activity_id } });
  await audit(client, { actorUserId: actor.user_id || null, action: events.ACTIVITY_LOGGED, moduleKey: events.MODULE, entityRef: ref(lead.lead_id), after: { lead_activity_id: row.lead_activity_id, kind: row.kind } });
  return row;
}

/** Log Activity: a call, an email, a WhatsApp, a visit or a note. */
async function logActivity(client, { id, data, actor = {} }) {
  return atomically(client, async () => {
    const lead = await mustGet(client, id, { forUpdate: true });
    return writeActivity(client, { lead, data, actor });
  });
}

/**
 * Set or change the next step without logging anything (the card's edit, the
 * AI). A live step is rescheduled in place; a row without one gets a new one.
 */
async function setNextStep(client, { id, step, actor = {} }) {
  let created = null;
  const out = await atomically(client, async () => {
    const lead = await mustGet(client, id, { forUpdate: true });
    if (lead.status !== "OPEN") throw new AppError("LEAD_ARCHIVED", "Reopen this company before giving it a next step", 409);
    const live = await nextSteps.current(client, lead.next_step_task_id);
    if (live) {
      await nextSteps.reschedule(client, { taskId: live.task_id, action: step.action, dueAt: step.due_at, assignedTo: step.assigned_to, actorId: await resolveActorId(client, actor.user_id) });
      await emitEvent(client, { eventTypeKey: events.NEXT_STEP_SET, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null, payload: { task_id: live.task_id } });
    } else {
      created = await pointAt(client, { lead, step, actor });
    }
    return id;
  });
  await nextSteps.tellAssignee(client, created);
  return get(client, out);
}

/**
 * Done (§3.2, "The loop that makes it used"): what happened and what is next,
 * in ONE write. The step is closed, the activity logged and the new step set
 * together, or nothing is. No new step is accepted only where the row owes
 * none (a client with nothing open); otherwise it is refused, and Archive is
 * the way to stop working a company.
 *
 * `task_id` is the step being completed when Done was opened from My
 * Workspace: it must be one of this row's.
 */
async function completeNextStep(client, { id, data, actor = {} }) {
  let created = null;
  const out = await atomically(client, async () => {
    const lead = await mustGet(client, id, { forUpdate: true });
    if (lead.status !== "OPEN") throw new AppError("LEAD_ARCHIVED", "Reopen this company before working it", 409);
    const actorId = await resolveActorId(client, actor.user_id);
    if (data.task_id) {
      const t = await require("../../dashboard/workspace/tasks.repo").findTask(client, data.task_id);
      if (!t || t.entity_type !== "lead" || t.entity_id !== id) {
        throw new AppError("NOT_FOUND", "That next step is not this company's", 404);
      }
      await nextSteps.close(client, { taskId: data.task_id, status: "DONE", actorId });
    }
    if (lead.next_step_task_id) await nextSteps.close(client, { taskId: lead.next_step_task_id, status: "DONE", actorId });
    const activity = await writeActivity(client, { lead, data: data.activity, actor });
    if (data.next_step) {
      created = await pointAt(client, { lead, step: data.next_step, actor });
    } else {
      const open = await repo.openRequestCount(client, id);
      if (rules.owesNextStep(lead, open)) {
        throw new AppError("NEXT_STEP_REQUIRED", "Say what happens next, or archive the company", 422, { next_step: ["required while the company is open"] });
      }
      await repo.update(client, id, { next_step_task_id: null });
    }
    return { activity };
  });
  await nextSteps.tellAssignee(client, created);
  return { lead: await get(client, id), activity: out.activity };
}

/* ─── archive and reopen ──────────────────────────────────────────────────── */

/**
 * Archive, with a reason: the only way an open prospect stops owing a next
 * step. A request still open on it is lost with it, for the same reason, and
 * its next step is cancelled.
 */
async function archive(client, { id, reason, reasonCode = "OTHER", actor = {} }) {
  return atomically(client, async () => {
    const lead = await mustGet(client, id, { forUpdate: true });
    if (lead.status === "ARCHIVED") throw new AppError("ALREADY_ARCHIVED", "This company is already archived", 409);
    const closed = [];
    for (const q of await repo.openRequests(client, id)) {
      closed.push(await requests().markLost(client, { id: q.quote_request_id, reasonCode, reason, actor, viaArchive: true }));
    }
    if (lead.next_step_task_id) {
      await nextSteps.close(client, { taskId: lead.next_step_task_id, status: "CANCELLED", actorId: await resolveActorId(client, actor.user_id) });
    }
    const row = await repo.update(client, id, {
      status: "ARCHIVED", archived_reason: reason, archived_at: new Date().toISOString(), next_step_task_id: null,
    });
    await emitEvent(client, { eventTypeKey: events.ARCHIVED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null, payload: { reason, requests_lost: closed.length } });
    await audit(client, { actorUserId: actor.user_id || null, action: events.ARCHIVED, moduleKey: events.MODULE, entityRef: ref(id), before: lead, after: { ...row, requests_lost: closed.map((q) => q.quote_request_id) } });
    return { lead: await shapeRow(client, row), requests_lost: closed.length };
  });
}

/** Reopen an archived company, with its next step. */
async function reopen(client, { id, nextStep, actor = {} }) {
  let created = null;
  await atomically(client, async () => {
    const lead = await mustGet(client, id, { forUpdate: true });
    if (lead.status !== "ARCHIVED") throw new AppError("NOT_ARCHIVED", "This company is not archived", 409);
    const row = await repo.update(client, id, { status: "OPEN", archived_reason: null, archived_at: null });
    created = await pointAt(client, { lead: row, step: nextStep, actor });
    await emitEvent(client, { eventTypeKey: events.REOPENED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.REOPENED, moduleKey: events.MODULE, entityRef: ref(id), before: lead, after: row });
  });
  await nextSteps.tellAssignee(client, created);
  return get(client, id);
}

/* ─── Make Client ─────────────────────────────────────────────────────────── */

/**
 * Make Client (§4.1): the prospect becomes a client_master row, DRAFT, and the
 * company row keeps going as a Client. It no longer waits for QUALIFIED; there
 * is no such state.
 *
 * `strict` (by hand, the default) holds F6's rule: the client type and the
 * payment terms are said, by the person or by the hints on the row, or the call
 * is refused rather than writing a client Finance has to complete. An ACCEPTED
 * QUOTATION calls this with `strict: false` (§3.4): the acceptance must not
 * fail over a field nobody was asked for, so the client is made from what the
 * row knows, as the DRAFT it starts as anyway, and Finance completes it.
 *
 * NIU and RCCM go into the `registrations` array (the source of truth) and are
 * mirrored onto the master row by `party_write` for invoice compatibility. The
 * row's requests are tied to the new client, so they reach its portal.
 */
async function makeClient(client, { id, clientData = {}, actor = {}, strict = true }) {
  const lead = await mustGet(client, id);
  if (lead.client_id) {
    if (strict) throw new AppError("ALREADY_CLIENT", "This company is already a client", 409, { client_id: lead.client_id });
    return { lead, client_id: lead.client_id, created: false };
  }
  const clientType = clientData.client_type || lead.client_type_hint || null;
  const paymentTerms = clientData.payment_terms_days ?? lead.payment_terms_days ?? null;
  if (strict && !clientType) {
    throw new AppError("VALIDATION_ERROR", "client_type is required to make a client (or set client_type_hint on the lead)", 422);
  }
  if (strict && (paymentTerms === null || paymentTerms === undefined)) {
    throw new AppError("VALIDATION_ERROR", "payment_terms_days is required to make a client (or set it on the lead)", 422);
  }

  const country = clientData.country_code || (lead.country && String(lead.country).length === 2 ? lead.country : null) || "CM";
  const registrations = [];
  const niu = clientData.niu ?? lead.niu;
  const rccm = clientData.rccm ?? lead.rccm;
  if (niu) registrations.push({ country_code: country, kind: "NIU", number: niu });
  if (rccm) registrations.push({ country_code: country, kind: "RCCM", number: rccm });

  return atomically(client, async () => {
    const locked = await repo.getForUpdate(client, id);
    if (locked.client_id) return { lead: locked, client_id: locked.client_id, created: false };

    const clientTypeId = clientType ? await repo.clientTypeIdByCode(client, clientType) : null;
    if (clientType && !clientTypeId && strict) {
      throw new AppError("UNKNOWN_CLIENT_TYPE", `client_type "${clientType}" is not configured for this tenant`, 422,
        { client_type: ["not a configured client type"] });
    }
    // The phone feeds the primary contact AND the company-level phone that
    // tenant policy requires on create (review #26, 13900), so a made client
    // is not the one path that trips REQUIRED_FIELDS_MISSING.
    const contactName = clientData.contact_name || lead.contact_name || null;
    const contactPhone = clientData.phone || lead.phone || null;
    const contactEmail = clientData.email || lead.email || null;
    const primaryContact = contactName
      ? { name: contactName, phone: contactPhone || undefined, email: contactEmail || undefined }
      : undefined;
    // The entity decides which counter allocates the client's `CL-` reference.
    const entityId = clientData.entity_id || lead.entity_id || (await repo.defaultEntityId(client));
    if (!entityId) {
      throw new AppError("ENTITY_REQUIRED", "This tenant has more than one corporate entity: say which one the client belongs to", 422,
        { entity_id: ["required when the tenant has several corporate entities"] });
    }

    const created = await clientMaster.create(client, {
      data: {
        entity_id: entityId,
        name: clientData.name || lead.company_name,
        legal_name: clientData.legal_name || lead.company_name,
        country_code: country,
        email: contactEmail || undefined,
        phone: contactPhone || undefined,
        address: clientData.address || lead.address || undefined,
        ...(clientTypeId ? { client_type_id: clientTypeId } : {}),
        ...(paymentTerms !== null && paymentTerms !== undefined ? { payment_terms_days: paymentTerms } : {}),
        registrations,
        primary_contact: primaryContact,
      },
      actor,
    });
    const clientId = created.client_id || created.id;
    const row = await repo.update(client, id, { client_id: clientId });
    await client.query("UPDATE quote_request SET client_id = $2, updated_at = now() WHERE lead_id = $1 AND client_id IS NULL", [id, clientId]);
    await emitEvent(client, { eventTypeKey: events.CONVERTED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CONVERTED, moduleKey: events.MODULE, entityRef: ref(id), after: { client_id: clientId, client_type: clientType, client_type_id: clientTypeId, payment_terms_days: paymentTerms, strict } });
    return {
      lead: row, client_id: clientId, entity_id: entityId, client_type: clientType,
      client_type_id: clientTypeId, payment_terms_days: paymentTerms, created: true,
    };
  });
}

module.exports = {
  capture, update, get, list, duplicates, clientRow, findOrCreateForIntake, stepForArrival, ensureStepBy,
  logActivity, setNextStep, completeNextStep, archive, reopen, makeClient, defaultOwner,
  answerBy, endOfToday, COMPANY_FIELDS, ANSWER_REQUEST,
};
