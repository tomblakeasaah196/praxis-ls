/**
 * Client activity → the people told about that client (tenant review of 29 Sep
 * 2026, PR 1, items 1.4, 1.5, 1.13; owner decisions D3 and D7).
 *
 * ── WHO ─────────────────────────────────────────────────────────────────────
 *
 * ONE list per client, the same everywhere (account_manager.service
 * `audience`): its account manager, its "Also notify" people and the CEO-role
 * users — or, when no reachable account manager is named, the Client inbox
 * team as well. The chat's own alert (portal_chat.service alertTeam) reads the
 * same list, so a client's message, document, payment claim and quote request
 * reach exactly the same people.
 *
 * ── HOW ─────────────────────────────────────────────────────────────────────
 *
 * Category `clients` — "Client activity" in Preferences — whose EMAIL defaults
 * ON (notification-email-default.js), so every one of them gets the bell, the
 * push (on devices where notifications are on) and the email unless THEY opt
 * out; a person's preference row always wins. Never `forceEmail`. A burst is
 * one email per person per conversation per 15 minutes (`emailOnceEvery`);
 * the bell and the push stay one per event.
 *
 * ── WHAT ────────────────────────────────────────────────────────────────────
 *
 *   client_request.submitted   a document or an answer sent through the portal
 *   payment_proof.submitted    "I have paid"
 *   quote_request.created      a quote request — read off its row (client,
 *                              channel, reference), never off the event, and
 *                              without touching the quote-request module:
 *                                · linked to a client → that client's list;
 *                                · a WEBSITE prospect with no client → the
 *                                  quote-request editors (MOD-20 edit) in-app,
 *                                  the CEO-role users by email too;
 *                                · anything else (a request staff keyed in
 *                                  themselves) → nobody: they know.
 *
 * The module broadcast in notify-events still runs for the first two — the
 * operations and finance queues that work them — but leaves out everyone this
 * already told, so nobody gets two bells for one upload.
 *
 * A website enquiry also creates a lead whose "New lead" alert would say the
 * same thing a second time; `isWebsiteQuoteLead` lets notify-events drop it, so
 * the enquiry is ONE alert (the quote request), not two.
 *
 * Best-effort: never throws into the business operation that emitted the event.
 */
"use strict";

const { logger } = require("../../config/logger");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (ref) => {
  const s = String(ref || "");
  const id = s.slice(s.indexOf(":") + 1);
  return UUID.test(id) ? id : null;
};

/** A burst is one email per person per conversation per this long. */
const EMAIL_WINDOW_SECONDS = 15 * 60;
const QUOTE_MODULE = "MOD-20";

/** "From Paul Atiock (paul@goum.cm)" — who at the client did it. */
function who(by) {
  if (!by || typeof by !== "object") return null;
  const name = by.name ? String(by.name).trim() : "";
  const email = by.email ? String(by.email).trim() : "";
  if (!name && !email) return null;
  return name && email ? `${name} (${email})` : name || email;
}

/** The client's name, for the title of the alert. */
async function companyName(client, clientId) {
  const { rows } = await client.query(
    "SELECT COALESCE(name, legal_name) AS name FROM client_master WHERE client_id = $1",
    [clientId],
  );
  return (rows[0] && rows[0].name) || "A client";
}

/** What each client event says, and where a tap lands. */
const EVENTS = {
  "client_request.submitted": {
    conversation: "documents",
    title: (company) => `${company} sent a document`,
    body: (p) => [p.kind === "INFO" ? "An answer to a request" : "A file to review", who(p.by) && `From ${who(p.by)}`].filter(Boolean).join(" · "),
    url: (clientId) => `/master/clients?focus=${clientId}&tab=Documents`,
  },
  "payment_proof.submitted": {
    conversation: "payments",
    title: (company) => `${company} reported a payment`,
    body: (p) => [p.amount ? `${new Intl.NumberFormat("en-GB").format(Number(p.amount))} ${p.currency || ""}`.trim() : null, who(p.by) && `From ${who(p.by)}`]
      .filter(Boolean).join(" · "),
    url: (clientId) => `/master/clients?focus=${clientId}&tab=Portal`,
  },
};

async function notifyList(client, userIds, { title, body, entityRef, url, eventTypeKey, conversation, clientId, priority = "NORMAL" }) {
  const service = require("../../modules/notification/notification.service");
  if (!userIds.length) return 0;
  return service.notifyMany(client, userIds, {
    eventTypeKey, title, body, entityRef, url, priority,
    category: "clients",
    pushTag: `client:${clientId}:${conversation}`,
    renotify: true,
    emailOnceEvery: { key: `client:${clientId}:${conversation}`, seconds: EMAIL_WINDOW_SECONDS },
  });
}

/** A quote request: its client, channel and reference, from the row itself. */
async function quoteRow(client, entityRef) {
  const id = idOf(entityRef);
  if (!id) return null;
  const { rows } = await client.query(
    `SELECT quote_request_id, client_id, intake_channel, public_ref, requester_company, requester_name
       FROM quote_request WHERE quote_request_id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function quoteRequestCreated(client, { entityRef, actorUserId }) {
  const q = await quoteRow(client, entityRef);
  if (!q) return [];
  const accountManager = require("../../modules/master/client_master/account_manager.service");
  const ref = q.public_ref || "a new quote request";
  const url = `/sales/quote-requests?focus=${q.quote_request_id}`;
  const notMe = (ids) => ids.filter((u) => !(actorUserId && u === actorUserId));

  if (q.client_id) {
    const list = await accountManager.audience(client, { clientId: q.client_id });
    const ids = notMe(list.all);
    const company = await companyName(client, q.client_id);
    await notifyList(client, ids, {
      title: `${company} asked for a quote`,
      body: `${ref}${q.intake_channel === "PORTAL" ? " · from the client portal" : ""}`,
      entityRef, url, eventTypeKey: "quote_request.created", conversation: "quotes", clientId: q.client_id,
    });
    return ids;
  }
  if (q.intake_channel !== "WEBSITE") return [];

  // A prospect from the public website: no client, so no list. The people
  // who can work the request see it in-app; the CEO-role users are emailed.
  const repo = require("../../modules/notification/notification.repo");
  const service = require("../../modules/notification/notification.service");
  const editors = notMe(await repo.recipientsWithPermission(client, QUOTE_MODULE, "edit"));
  const { rows } = await client.query(
    `SELECT DISTINCT u.user_id FROM app_user u
       JOIN user_role ur ON ur.user_id = u.user_id
       JOIN role r ON r.role_id = ur.role_id
      WHERE r.code = 'CEO' AND u.status = 'ACTIVE'`,
  );
  const ceo = notMe(rows.map((r) => r.user_id));
  const from = q.requester_company || q.requester_name || "A website visitor";
  const title = `New quote request from the website`;
  const body = `${ref} · ${from}`;
  await notifyList(client, ceo, {
    title, body, entityRef, url, eventTypeKey: "quote_request.created", conversation: "website-quotes", clientId: "prospects",
  });
  const rest = editors.filter((u) => !ceo.includes(u));
  if (rest.length) {
    await service.notifyMany(client, rest, {
      eventTypeKey: "quote_request.created", title, body, entityRef, url, category: "sales",
    });
  }
  return [...new Set([...ceo, ...rest])];
}

/**
 * Tell the client's people about one event, if it is client activity.
 * Returns the user ids told, so the module broadcast can leave them out.
 */
async function onEvent(client, { eventTypeKey, entityRef = null, actorUserId = null, payload = {} }) {
  try {
    if (eventTypeKey === "quote_request.created") return await quoteRequestCreated(client, { entityRef, actorUserId });
    const spec = EVENTS[eventTypeKey];
    if (!spec) return [];
    const p = payload || {};
    const clientId = p.client_id && UUID.test(String(p.client_id)) ? String(p.client_id) : null;
    if (!clientId) return [];
    const accountManager = require("../../modules/master/client_master/account_manager.service");
    const list = await accountManager.audience(client, { clientId });
    const ids = list.all.filter((u) => !(actorUserId && u === actorUserId));
    const company = await companyName(client, clientId);
    await notifyList(client, ids, {
      title: spec.title(company),
      body: spec.body(p),
      entityRef,
      url: spec.url(clientId),
      eventTypeKey,
      conversation: spec.conversation,
      clientId,
      priority: eventTypeKey === "payment_proof.submitted" ? "HIGH" : "NORMAL",
    });
    return ids;
  } catch (err) {
    logger.warn({ err, eventTypeKey }, "[notify-client-team] failed");
    return [];
  }
}

/**
 * Is this lead the one a WEBSITE quote enquiry created? Then its "New lead"
 * alert would repeat the quote request's (public_intake.submitQuote creates
 * both in one transaction, and is the only writer of a WEBSITE lead), so the
 * caller drops it: one enquiry, one alert.
 */
async function isWebsiteQuoteLead(client, entityRef) {
  const id = idOf(entityRef);
  if (!id) return false;
  try {
    const { rows } = await client.query("SELECT intake_channel FROM lead WHERE lead_id = $1", [id]);
    return !!rows[0] && rows[0].intake_channel === "WEBSITE";
  } catch (err) {
    logger.warn({ err }, "[notify-client-team] lead channel unreadable — the New lead alert goes out");
    return false;
  }
}

module.exports = { onEvent, isWebsiteQuoteLead, EVENTS, EMAIL_WINDOW_SECONDS };
