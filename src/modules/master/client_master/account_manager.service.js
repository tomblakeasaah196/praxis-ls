/**
 * A client's account manager (client portal PR 3, 14200).
 *
 * The person on the team who looks after a client: the first one a client's
 * portal message reaches, with the owners of the shipment it is about
 * (portal_chat.service alertTeam), and whose clients are "Mine" in the Client
 * inbox. Stored in `client_master.relationship_manager_user_id` — the column
 * 0511 added for exactly this and nothing ever set.
 *
 * A LOGIN, chosen from the employee picker (people with a login only), because
 * that is what an alert reaches. The service refuses a login that is not
 * ACTIVE: an account manager who cannot be told is a message that goes
 * nowhere, and the routing would silently fall back while the screen said the
 * client was looked after. A manager who later LEAVES is shown as such
 * (`reachable: false`) and the routing falls back to the inbox until someone
 * is named in their place.
 *
 * Assigning is audited, and the new manager is told — "you look after Acme
 * now" — unless they assigned themselves.
 */
"use strict";

const notifications = require("../../notification/notification.service");
const { audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { atomically } = require("../../../shared/db/tx");
const { logger } = require("../../../config/logger");

const MODULE = "MOD-03";
/** The Client inbox (MOD-64C) — who answers a client nobody reachable looks after. */
const INBOX_MODULE = "MOD-64C";

async function read(c, clientId) {
  const { rows } = await c.query(
    `SELECT cm.client_id, COALESCE(cm.name, cm.legal_name) AS client_name,
            cm.relationship_manager_user_id AS user_id,
            u.full_name AS user_name, u.email, u.status,
            e.employee_id, e.full_name AS employee_name, e.job_title
       FROM client_master cm
       LEFT JOIN app_user u ON u.user_id = cm.relationship_manager_user_id
       LEFT JOIN employee e ON e.employee_id = u.employee_id
      WHERE cm.client_id = $1`,
    [clientId],
  );
  return rows[0] || null;
}

function view(row) {
  if (!row.user_id) return { client_id: row.client_id, manager: null };
  return {
    client_id: row.client_id,
    manager: {
      user_id: row.user_id,
      // The employee's name is the one the team knows; the login's is the
      // fallback for a login with no employee record behind it.
      name: row.employee_name || row.user_name || row.email || null,
      job_title: row.job_title || null,
      email: row.email || null,
      employee_id: row.employee_id || null,
      reachable: row.status === "ACTIVE",
    },
  };
}

/** Who looks after this client, if anyone. */
async function get(c, { clientId }) {
  const row = await read(c, clientId);
  if (!row) throw new AppError("NOT_FOUND", "Client not found", 404);
  return view(row);
}

/** Name the account manager (a login), or clear it with null. */
async function set(c, { clientId, userId = null, actor = {} }) {
  const before = await read(c, clientId);
  if (!before) throw new AppError("NOT_FOUND", "Client not found", 404);
  const next = userId || null;
  if ((before.user_id || null) === next) return view(before);

  let person = null;
  if (next) {
    const { rows } = await c.query("SELECT user_id, full_name, status FROM app_user WHERE user_id = $1", [next]);
    person = rows[0] || null;
    if (!person || person.status !== "ACTIVE") {
      throw new AppError(
        "ACCOUNT_MANAGER_INACTIVE",
        "Choose someone with an active login — client messages could not reach anyone else.",
        422,
      );
    }
  }

  // The change and its audit row land together, or neither does.
  await atomically(c, async () => {
    await c.query(
      "UPDATE client_master SET relationship_manager_user_id = $2, updated_at = now() WHERE client_id = $1",
      [clientId, next],
    );
    const actorId = await resolveActorId(c, actor.user_id);
    await audit(c, {
      actorUserId: actorId,
      action: "client.account_manager_set",
      moduleKey: MODULE,
      entityRef: `client:${clientId}`,
      before: { user_id: before.user_id || null },
      after: { user_id: next },
    });
  });

  // Told, unless they named themselves. Best-effort: the assignment stands
  // whether or not the notification can be written.
  if (next && next !== actor.user_id) {
    try {
      await notifications.notify(c, {
        userId: next,
        eventTypeKey: "client.account_manager_assigned",
        category: "comms",
        title: `You look after ${before.client_name || "a client"}`,
        body: "Their portal messages now reach you first.",
        entityRef: `client:${clientId}`,
        url: `/comms/clients?client=${clientId}`,
      });
    } catch (err) {
      logger.warn({ err, clientId }, "account manager: assignment notice not sent");
    }
  }
  return get(c, { clientId });
}

/**
 * Who can be named: people with an ACTIVE login, searched by name or job — the
 * employee picker's rows, cut to what a picker shows.
 *
 * Its own read rather than `/employees`, because the people who assign
 * account managers (sales and operations, through the Client inbox's MOD-64C)
 * do not hold the employee master (MOD-02), and that endpoint answers with the
 * whole staff record. A person with two logins is offered with the oldest
 * ACTIVE one — the same "oldest" the employee list picks, minus the logins an
 * alert could not reach.
 */
async function candidates(c, { q = "", limit = 15 } = {}) {
  const term = String(q || "").trim().slice(0, 80);
  const n = Math.min(Math.max(Number(limit) || 15, 1), 50);
  const { rows } = await c.query(
    `SELECT e.employee_id, e.full_name, e.job_title, e.department, u.user_id AS account_user_id
       FROM employee e
       JOIN LATERAL (
         SELECT au.user_id
           FROM app_user au
          WHERE au.employee_id = e.employee_id AND au.status = 'ACTIVE'
          ORDER BY au.created_at ASC
          LIMIT 1
       ) u ON true
      WHERE e.is_active = true
        AND ($1 = '' OR e.full_name ILIKE '%' || $1 || '%' OR e.job_title ILIKE '%' || $1 || '%')
      ORDER BY e.full_name ASC
      LIMIT $2`,
    [term, n],
  );
  return rows;
}

/* ── who is told about a client (tenant review 29 Sep 2026, D7) ──────────── */

/**
 * "Also notify" — the extra people told about this client, beside its account
 * manager and the CEO-role users. Only ACTIVE logins: a person who has left
 * drops out of routing on their own, and the 360 shows them as unreachable
 * until someone takes them off.
 */
async function alsoNotify(c, { clientId }) {
  const { rows } = await c.query(
    `SELECT n.user_id, u.status, u.email,
            COALESCE(e.full_name, u.full_name, u.email) AS name, e.job_title, e.employee_id
       FROM client_notify_person n
       JOIN app_user u ON u.user_id = n.user_id
       LEFT JOIN employee e ON e.employee_id = u.employee_id
      WHERE n.client_id = $1
      ORDER BY COALESCE(e.full_name, u.full_name, u.email)`,
    [clientId],
  );
  return rows.map((r) => ({
    user_id: r.user_id, name: r.name || null, job_title: r.job_title || null, email: r.email || null,
    employee_id: r.employee_id || null, reachable: r.status === "ACTIVE",
  }));
}

/**
 * Replace the "Also notify" list. Each person must hold an ACTIVE login — the
 * same rule the account manager follows, for the same reason: someone who
 * cannot be told is a name on a screen and nobody in the inbox. The change and
 * its audit row land together; the people added are told.
 */
async function setAlsoNotify(c, { clientId, userIds = [], actor = {} }) {
  const before = await read(c, clientId);
  if (!before) throw new AppError("NOT_FOUND", "Client not found", 404);
  const next = [...new Set((userIds || []).filter(Boolean))];
  if (next.length) {
    const { rows } = await c.query(
      "SELECT user_id FROM app_user WHERE user_id = ANY($1::uuid[]) AND status = 'ACTIVE'",
      [next],
    );
    if (rows.length !== next.length) {
      throw new AppError(
        "ALSO_NOTIFY_INACTIVE",
        "Choose people with an active login — anyone else could not be told about this client.",
        422,
      );
    }
  }
  const current = (await alsoNotify(c, { clientId })).map((p) => p.user_id);
  const added = next.filter((id) => !current.includes(id));
  const removed = current.filter((id) => !next.includes(id));
  if (!added.length && !removed.length) return told(c, { clientId });

  const actorId = await resolveActorId(c, actor.user_id);
  await atomically(c, async () => {
    if (removed.length) {
      await c.query("DELETE FROM client_notify_person WHERE client_id = $1 AND user_id = ANY($2::uuid[])", [clientId, removed]);
    }
    for (const userId of added) {
      await c.query(
        `INSERT INTO client_notify_person (client_id, user_id, added_by) VALUES ($1, $2, $3)
         ON CONFLICT (client_id, user_id) DO NOTHING`,
        [clientId, userId, actorId],
      );
    }
    await audit(c, {
      actorUserId: actorId,
      action: "client.also_notify_set",
      moduleKey: MODULE,
      entityRef: `client:${clientId}`,
      before: { user_ids: current },
      after: { user_ids: next },
    });
  });

  for (const userId of added.filter((id) => id !== actor.user_id)) {
    try {
      await notifications.notify(c, {
        userId,
        eventTypeKey: "client.also_notify_added",
        category: "clients",
        title: `You are told about ${before.client_name || "a client"}`,
        body: "Their messages, documents, payments and quote requests now reach you too.",
        entityRef: `client:${clientId}`,
        url: `/master/clients?focus=${clientId}`,
      });
    } catch (err) {
      logger.warn({ err, clientId }, "also notify: notice not sent");
    }
  }
  return told(c, { clientId });
}

/** The CEO-role users — told about every client (D7, kept as today). */
async function ceoUsers(c) {
  const { rows } = await c.query(
    `SELECT DISTINCT u.user_id, COALESCE(e.full_name, u.full_name, u.email) AS name, e.job_title
       FROM app_user u
       JOIN user_role ur ON ur.user_id = u.user_id
       JOIN role r ON r.role_id = ur.role_id
       LEFT JOIN employee e ON e.employee_id = u.employee_id
      WHERE r.code = 'CEO' AND u.status = 'ACTIVE'
      ORDER BY 2`,
  );
  return rows;
}

/**
 * The whole "who is told" list for one client, as the Client 360 shows it:
 * "Told about this client: Awa (account manager), Timothée (CEO), Paul (also
 * notify)". `fallback` says when nobody reachable looks after the client and
 * its alerts go to the Client inbox team instead.
 */
async function told(c, { clientId }) {
  const am = await get(c, { clientId });
  const also = await alsoNotify(c, { clientId });
  const ceo = await ceoUsers(c);
  const manager = am.manager;
  return {
    client_id: clientId,
    manager,
    also_notify: also,
    ceo: ceo.map((u) => ({ user_id: u.user_id, name: u.name || null, job_title: u.job_title || null })),
    fallback_to_inbox: !(manager && manager.reachable),
  };
}

/**
 * The people to tell about something a client did — ONE list everywhere (D7):
 * the chat's alert, documents and answers, payment claims and quote requests.
 *
 *   manager  the account manager, when their login is ACTIVE;
 *   also     the "Also notify" people with an ACTIVE login;
 *   ceo      the CEO-role users (today's "MD");
 *   inbox    the Client inbox team (MOD-64C edit) — ONLY when there is no
 *            reachable account manager, as today.
 *
 * Returned as lists so a caller can add its own (a shipment's owners) and say
 * why each person is there. `all` is the de-duplicated union.
 */
async function audience(c, { clientId }) {
  const { rows } = await c.query(
    `SELECT 'manager' AS why, u.user_id
       FROM client_master cm
       JOIN app_user u ON u.user_id = cm.relationship_manager_user_id
      WHERE cm.client_id = $1 AND u.status = 'ACTIVE'
     UNION ALL
     SELECT 'also' AS why, u.user_id
       FROM client_notify_person n
       JOIN app_user u ON u.user_id = n.user_id
      WHERE n.client_id = $1 AND u.status = 'ACTIVE'
     UNION ALL
     SELECT 'ceo' AS why, u.user_id
       FROM app_user u
       JOIN user_role ur ON ur.user_id = u.user_id
       JOIN role r ON r.role_id = ur.role_id
      WHERE r.code = 'CEO' AND u.status = 'ACTIVE'`,
    [clientId],
  );
  const of = (why) => [...new Set(rows.filter((r) => r.why === why).map((r) => r.user_id))];
  const out = { manager: of("manager"), also: of("also"), ceo: of("ceo"), inbox: [] };
  if (!out.manager.length) {
    const notificationRepo = require("../../notification/notification.repo");
    out.inbox = await notificationRepo.recipientsWithPermission(c, INBOX_MODULE, "edit");
  }
  out.all = [...new Set([...out.manager, ...out.also, ...out.ceo, ...out.inbox])];
  return out;
}

module.exports = { get, set, candidates, alsoNotify, setAlsoNotify, told, audience, INBOX_MODULE };
