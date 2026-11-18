/**
 * The 360° dossiers for the front of the funnel: a LEAD and a QUOTE REQUEST.
 *
 * Same shape and the same contract as the masters' `party-360.service.js`,
 * deliberately, because a reader who knows one should not have to learn
 * another: one call returns the record, a KPI block, and every collection that
 * points at it, and it renders for a BRAND-NEW record with zero data — every
 * figure defaults to 0, every collection to [].
 *
 * ── WHY THESE TWO NEEDED ONE ────────────────────────────────────────────────
 * F6 split what the legacy overloaded into one column across three rows (lead,
 * quote request, opportunity), which left a salesperson with three registers
 * and no single place that answers "what is going on with this company". The
 * Sales lean revamp folded the opportunity into the request (D3) and the
 * proposal into the quotation (D6); this is the join that answers it, one
 * company row with its requests, quotations, meetings and activity.
 *
 * ── ONE CLIENT, SEQUENTIAL QUERIES ──────────────────────────────────────────
 * Every query here runs on the SAME pg client, which cannot execute two at
 * once, so these are sequential by nature — the same note treasury-360 carries.
 * Each collection is capped (LIMIT 25, timeline 50); a lead with more than 25
 * requests is a data problem, not a rendering one.
 *
 * ── MONEY IS GATED ──────────────────────────────────────────────────────────
 * Request value and quotation totals are money, so they follow the masters'
 * rule rather than inventing a second one: `canSeeFinancials` (a read grant on
 * Treasury, MOD-09; the CEO sees all) decides, and without it the figures are
 * `null` and `money_visible` is false. Null, not zero — "you may not see this"
 * and "this is worth nothing" are different facts, and a tile showing 0 for the
 * first is a lie. The counts are never gated: how many requests exist is not
 * confidential.
 *
 * NOTE ON RULE 1 (doc/SALES_CRM_FEATURES.md). Nothing here reaches a model, but
 * the same discipline applies: no cost or margin column is named in any query
 * below. A quotation's total is its sell-side `total_ttc`, the number already
 * printed on the client's own quotation.
 */
"use strict";

const { AppError } = require("../../utils/errors");
const mailVisibility = require("../mail/triage/visibility");

/** Collections are capped so one pathological record cannot make the page slow. */
const LIMIT = 25;
const TIMELINE_LIMIT = 50;

const rowsOf = async (c, sql, params) => (await c.query(sql, params)).rows;

/**
 * Money in, or `null` out. Applied at the point each figure is assembled rather
 * than by walking the finished object, so it is visible at the call site which
 * numbers are gated and which are not.
 */
const money = (value, canSee) => (canSee ? Number(value || 0) : null);

/**
 * Every change to this record, newest first, from the append-only ledger.
 *
 * `immutable_ledger` is indexed on `entity_ref` and `trg_ledger_ro` forbids
 * UPDATE and DELETE, so this is real history rather than a mutable log — the
 * same source treasury-360's timeline reads.
 *
 * Scoped to THIS record's own ref. A lead's meetings, requests and quotations
 * each write their own audit rows under their own refs, and folding them in
 * here would produce a feed where "status changed to SENT" is ambiguous about
 * which thing changed. Each of those rows deep-links to its own record, which
 * has its own history.
 */
async function timeline(c, entityRef, limit = TIMELINE_LIMIT) {
  return rowsOf(
    c,
    `SELECT ledger_id AS audit_id, action, actor_user_id,
            actor_name_snapshot AS actor_name, is_sensitive,
            before_json AS before_snapshot, after_json AS after_snapshot,
            created_at AS occurred_at
       FROM immutable_ledger
      WHERE entity_ref = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [entityRef, limit],
  );
}

/* ═══════════════════════════ LEAD ═══════════════════════════════════════════ */

/**
 * Meetings held against this lead, each with its discovery sections folded in.
 *
 * The section bodies are NOT returned — a discovery set is long-form prose and
 * this is an index. What the dossier needs to show is which of the three
 * sections have been captured and whether any dictation failed, because a
 * section whose transcription failed must be visibly in that state rather than
 * silently empty (F1's definition of done). `has_body` and `capture_state`
 * carry exactly that, and the meeting row deep-links to the full text.
 */
async function leadMeetings(c, leadId) {
  const meetings = await rowsOf(
    c,
    `SELECT m.meeting_id, m.subject, m.location, m.scheduled_at, m.created_at,
            u.full_name AS organiser_name
       FROM meeting m
       LEFT JOIN app_user u ON u.user_id = m.organiser_id
      WHERE m.lead_id = $1
      ORDER BY COALESCE(m.scheduled_at, m.created_at) DESC
      LIMIT $2`,
    [leadId, LIMIT],
  );
  if (!meetings.length) return [];

  const sections = await rowsOf(
    c,
    `SELECT meeting_id, section_key, capture_state, dictation_error,
            (COALESCE(body, '') <> '') AS has_body, updated_at
       FROM meeting_discovery_section
      WHERE meeting_id = ANY($1)
      ORDER BY section_key`,
    [meetings.map((m) => m.meeting_id)],
  );

  const bySection = new Map();
  for (const s of sections) {
    if (!bySection.has(s.meeting_id)) bySection.set(s.meeting_id, []);
    bySection.get(s.meeting_id).push(s);
  }
  return meetings.map((m) => ({ ...m, sections: bySection.get(m.meeting_id) || [] }));
}

/**
 * The KPI block. Counts always; money only when the caller may see it. The
 * deal's figures (open requests, won requests, open value) are added by
 * `leadDossier` from the requests themselves, where the stage lives.
 */
function leadKpis({ meetings, quoteRequests, enquiries, canSee }) {
  return {
    meetings: meetings.length,
    discovery_sections_captured: meetings.reduce(
      (n, m) => n + m.sections.filter((s) => s.has_body).length,
      0,
    ),
    quote_requests: quoteRequests.length,
    enquiries: enquiries.length,
    money_visible: canSee,
  };
}

/* ═══════════════ THE COMPANY ROW (lean revamp PR 2, guide §3.2) ═══════════ */

/**
 * The Requests tab: one card per request, its stage, service, route and value.
 * Every request of the company, newest first, capped like every collection here.
 */
async function leadRequests(c, leadId, canSee) {
  const rows = await rowsOf(
    c,
    `SELECT q.quote_request_id, q.public_ref, q.title, q.stage, q.intake_channel,
            q.service_type_id, st.name_en AS service_name_en, st.name_fr AS service_name_fr,
            q.service_category, q.incoterm, q.origin_location, q.destination_location,
            q.estimated_weight, q.estimated_value, q.currency, q.lost_reason_code, q.lost_reason,
            q.settled_at, q.dossier_id, d.ref AS dossier_ref, q.owner_user_id, q.created_at,
            (SELECT count(*)::int FROM quotation qt WHERE qt.quote_request_id = q.quote_request_id) AS quotations
       FROM quote_request q
       LEFT JOIN service_type st ON st.service_type_id = q.service_type_id
       LEFT JOIN dossier_visible d ON d.dossier_id = q.dossier_id
      WHERE q.lead_id = $1
      ORDER BY (q.stage IN ('WON', 'LOST')), q.created_at DESC
      LIMIT $2`,
    [leadId, LIMIT],
  );
  return rows.map((r) => ({ ...r, estimated_value: r.estimated_value === null ? null : money(r.estimated_value, canSee) }));
}

/**
 * The Quotations tab: every quotation answering one of the company's requests,
 * or written for it as a client. Number, request, total, status, viewed, valid
 * until. A SENT one past its date reads EXPIRED, as the portal reads it.
 */
async function leadQuotations(c, lead, canSee) {
  const rows = await rowsOf(
    c,
    `SELECT qt.quotation_id, qt.doc_number, qt.status, qt.currency, qt.total_ttc, qt.valid_until, qt.costing_id,
            qt.sent_at, qt.viewed_at, qt.answered_at, qt.created_at,
            qt.quote_request_id, q.public_ref AS request_ref, q.title AS request_title
       FROM quotation qt
       LEFT JOIN quote_request q ON q.quote_request_id = qt.quote_request_id
      WHERE q.lead_id = $1 OR ($2::uuid IS NOT NULL AND qt.client_id = $2::uuid)
      ORDER BY COALESCE(qt.sent_at, qt.created_at) DESC
      LIMIT $3`,
    [lead.lead_id, lead.client_id || null, LIMIT],
  );
  const today = new Date().toISOString().slice(0, 10);
  return rows.map((r) => {
    const until = r.valid_until ? String(r.valid_until instanceof Date ? r.valid_until.toISOString() : r.valid_until).slice(0, 10) : null;
    return {
      ...r,
      status: r.status === "SENT" && until && until < today ? "EXPIRED" : r.status,
      total_ttc: money(r.total_ttc, canSee),
    };
  });
}

/**
 * The Activity tab: ONE timeline, read where each thing lives (§4.3), newest
 * first. Activities logged on the row; meetings; mail threads bound to it that
 * the caller may read (mail's own visibility rule, never a second copy); the
 * quotations' sends, opens and answers; the Company Profile shares sent to it
 * and their opens; the requests' stage moves, wins and losses from the audit
 * ledger.
 */
async function leadActivity(c, lead, { user = null, quotations = [] } = {}) {
  const leadId = lead.lead_id;
  const items = [];

  const activities = await rowsOf(
    c,
    `SELECT a.lead_activity_id, a.kind, a.body, a.occurred_at, a.quote_request_id,
            u.full_name AS author_name
       FROM lead_activity a
       LEFT JOIN app_user u ON u.user_id = a.author_user_id
      WHERE a.lead_id = $1
      ORDER BY a.occurred_at DESC
      LIMIT $2`,
    [leadId, TIMELINE_LIMIT],
  );
  for (const a of activities) {
    items.push({
      type: "activity", at: a.occurred_at, kind: a.kind, title: a.kind, body: a.body,
      author_name: a.author_name, quote_request_id: a.quote_request_id, ref: { type: "lead_activity", id: a.lead_activity_id },
    });
  }

  const meetings = await rowsOf(
    c,
    `SELECT m.meeting_id, m.subject, m.location, m.scheduled_at, m.created_at, m.quote_request_id
       FROM meeting m
      WHERE m.lead_id = $1
      ORDER BY COALESCE(m.scheduled_at, m.created_at) DESC
      LIMIT $2`,
    [leadId, LIMIT],
  );
  for (const m of meetings) {
    items.push({
      type: "meeting", at: m.scheduled_at || m.created_at, title: m.subject, body: m.location || null,
      quote_request_id: m.quote_request_id, ref: { type: "meeting", id: m.meeting_id },
    });
  }

  if (user && user.user_id) {
    const threads = await rowsOf(
      c,
      `SELECT t.email_thread_id, t.subject, t.message_count, t.last_message_at
         FROM email_thread t
         JOIN email_connection c ON c.email_connection_id = t.email_connection_id
        WHERE t.entity_ref = $1
          AND (${mailVisibility.clause("$2")})
        ORDER BY t.last_message_at DESC NULLS LAST
        LIMIT $3`,
      ["lead:" + leadId, user.user_id, LIMIT],
    );
    for (const t of threads) {
      items.push({
        type: "mail", at: t.last_message_at, title: t.subject, body: null, count: t.message_count,
        ref: { type: "email_thread", id: t.email_thread_id },
      });
    }
  }

  for (const q of quotations) {
    const head = { type: "quotation", ref: { type: "quotation", id: q.quotation_id }, quote_request_id: q.quote_request_id, title: q.doc_number || "Quotation" };
    if (q.sent_at) items.push({ ...head, at: q.sent_at, kind: "SENT" });
    if (q.viewed_at) items.push({ ...head, at: q.viewed_at, kind: "VIEWED" });
    if (q.answered_at && ["ACCEPTED", "REJECTED", "CONVERTED"].includes(q.status)) {
      items.push({ ...head, at: q.answered_at, kind: q.status === "REJECTED" ? "DECLINED" : "ACCEPTED" });
    }
  }

  // Company Profile shares sent for this company, and every open of one (PR 6
  // handed this to PR 3): who it went to, when, and when it was read. The
  // share stores `lead_id`; the opens are its children.
  const shares = await rowsOf(
    c,
    `SELECT s.share_id, s.recipient_name, s.recipient_email, s.language, s.created_at, s.revoked_at,
            u.full_name AS author_name
       FROM company_profile_share s
       LEFT JOIN app_user u ON u.user_id = s.created_by
      WHERE s.lead_id = $1
      ORDER BY s.created_at DESC
      LIMIT $2`,
    [leadId, LIMIT],
  );
  if (shares.length) {
    const opens = await rowsOf(
      c,
      `SELECT o.open_id, o.share_id, o.kind, o.opened_at
         FROM company_profile_share_open o
        WHERE o.share_id = ANY($1)
        ORDER BY o.opened_at DESC
        LIMIT $2`,
      [shares.map((s) => s.share_id), TIMELINE_LIMIT],
    );
    const byId = new Map(shares.map((s) => [s.share_id, s]));
    for (const s of shares) {
      items.push({
        type: "profile_share", at: s.created_at, kind: "SHARED",
        title: s.recipient_name || s.recipient_email || null, body: s.recipient_email || null,
        author_name: s.author_name || null, revoked: Boolean(s.revoked_at),
        ref: { type: "company_profile_share", id: s.share_id },
      });
    }
    for (const o of opens) {
      const s = byId.get(o.share_id) || {};
      items.push({
        type: "profile_share", at: o.opened_at, kind: o.kind === "DOWNLOAD" ? "DOWNLOADED" : "OPENED",
        title: s.recipient_name || s.recipient_email || null, body: null,
        ref: { type: "company_profile_share", id: o.share_id },
      });
    }
  }

  const moves = await rowsOf(
    c,
    `SELECT l.ledger_id, l.action, l.entity_ref, l.after_json, l.created_at, l.actor_name_snapshot
       FROM immutable_ledger l
      WHERE l.entity_ref IN (SELECT 'quote_request:' || q.quote_request_id FROM quote_request q WHERE q.lead_id = $1)
        AND l.action IN ('quote_request.stage_moved', 'quote_request.won', 'quote_request.lost', 'quote_request.created')
      ORDER BY l.created_at DESC
      LIMIT $2`,
    [leadId, TIMELINE_LIMIT],
  );
  for (const m of moves) {
    const after = m.after_json || {};
    items.push({
      type: "stage", at: m.created_at, kind: m.action.replace(/^quote_request\./, "").toUpperCase(),
      title: after.stage || (m.action === "quote_request.created" ? "NEW" : null), author_name: m.actor_name_snapshot || null,
      quote_request_id: String(m.entity_ref).slice("quote_request:".length), ref: { type: "quote_request", id: String(m.entity_ref).slice("quote_request:".length) },
    });
  }

  return items
    .filter((i) => i.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, TIMELINE_LIMIT);
}

/** GET /leads/:id/360 */
async function leadDossier(c, { leadId, canSeeFinancials = false, user = null }) {
  const lead = (
    await c.query(
      `SELECT l.*, u.full_name AS owner_name, e.legal_name AS entity_name,
              cm.name AS client_name, cm.public_reference_consent
         FROM lead l
         LEFT JOIN app_user u ON u.user_id = l.owner_user_id
         LEFT JOIN corporate_entity e ON e.entity_id = l.entity_id
         LEFT JOIN client_master cm ON cm.client_id = l.client_id
        WHERE l.lead_id = $1`,
      [leadId],
    )
  ).rows[0];
  if (!lead) throw new AppError("NOT_FOUND", "Lead not found", 404);

  // The row's own reading: its live next step and whether it owes one.
  const row = await require("./lead/lead.service").get(c, leadId);
  const requests = await leadRequests(c, leadId, canSeeFinancials);
  const quotations = await leadQuotations(c, lead, canSeeFinancials);
  const activity = await leadActivity(c, lead, { user, quotations });

  const meetings = await leadMeetings(c, leadId);

  const quote_requests = await rowsOf(
    c,
    `SELECT quote_request_id, public_ref, stage, intake_channel, service_category,
            incoterm, origin_location, destination_location, estimated_weight,
            project_cargo_flag, created_at
       FROM quote_request
      WHERE lead_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [leadId, LIMIT],
  );

  const enquiries = await rowsOf(
    c,
    `SELECT contact_enquiry_id, subject, enquiry_type, status, source,
            responded_at, created_at
       FROM contact_enquiry
      WHERE lead_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [leadId, LIMIT],
  );

  const openRequests = requests.filter((r) => !["WON", "LOST"].includes(r.stage));
  const kpisBase = leadKpis({
    meetings,
    quoteRequests: quote_requests,
    enquiries,
    canSee: canSeeFinancials,
  });
  return {
    lead: { ...lead, is_client: Boolean(lead.client_id) },
    next_step: row ? row.next_step : null,
    next_step_required: row ? row.next_step_required : false,
    // The four tabs (§3.2): counts first, so a tab's badge needs no second read.
    counts: { activity: activity.length, requests: requests.length, quotations: quotations.length },
    activity,
    requests,
    quotations,
    kpis: {
      ...kpisBase,
      open_requests: openRequests.length,
      won_requests: requests.filter((r) => r.stage === "WON").length,
      open_value: canSeeFinancials ? openRequests.reduce((n, r) => n + Number(r.estimated_value || 0), 0) : null,
    },
    meetings,
    quote_requests,
    enquiries,
    // The converted client, when there is one. A thin card, not a second party
    // dossier: the client has its own 360 and this deep-links to it.
    client: lead.client_id
      ? {
          client_id: lead.client_id,
          name: lead.client_name,
          public_reference_consent: lead.public_reference_consent,
        }
      : null,
    timeline: await timeline(c, "lead:" + leadId),
  };
}

/* ═══════════════════════ QUOTE REQUEST (INTAKE) ═════════════════════════════ */

/**
 * The uploaded documents, joined to the vault for a name and a state.
 *
 * `kind` distinguishes the single PRIMARY attachment from the ADDITIONAL ones,
 * which is the legacy's "attachment plus supporting documents" split and the
 * reason the column exists.
 */
async function intakeAttachments(c, quoteRequestId) {
  return rowsOf(
    c,
    `SELECT a.quote_request_attachment_id, a.kind, a.document_kind, a.vault_id, a.created_at,
            v.original_name, v.doc_type, v.status AS vault_status,
            u.full_name AS uploaded_by_name
       FROM quote_request_attachment a
       LEFT JOIN document_vault v ON v.doc_id = a.vault_id
       LEFT JOIN app_user u ON u.user_id = a.uploaded_by_user_id
      WHERE a.quote_request_id = $1
      ORDER BY (a.kind = 'PRIMARY') DESC, a.created_at`,
    [quoteRequestId],
  );
}

/** GET /quote-requests/:id/360 */
async function intakeDossier(c, { quoteRequestId, canSeeFinancials = false }) {
  const request = (
    await c.query(
      `SELECT q.*, u.full_name AS owner_name, cu.full_name AS created_by_name,
              e.legal_name AS entity_name,
              l.company_name AS lead_company_name, l.status AS lead_status,
              -- The service the request names (14310) and the client it is
              -- for, as words — the dossier header never shows a key or an id.
              st.name_en AS service_name_en, st.name_fr AS service_name_fr,
              st.transport_mode AS service_mode, st.territory AS service_territory,
              cm.name AS client_name
         FROM quote_request q
         LEFT JOIN app_user u ON u.user_id = q.owner_user_id
         LEFT JOIN app_user cu ON cu.user_id = q.created_by_user_id
         LEFT JOIN corporate_entity e ON e.entity_id = q.entity_id
         LEFT JOIN lead l ON l.lead_id = q.lead_id
         LEFT JOIN service_type st ON st.service_type_id = q.service_type_id
         LEFT JOIN client_master cm ON cm.client_id = q.client_id
        WHERE q.quote_request_id = $1`,
      [quoteRequestId],
    )
  ).rows[0];
  if (!request) throw new AppError("NOT_FOUND", "Quote request not found", 404);

  const attachments = await intakeAttachments(c, quoteRequestId);

  return {
    request,
    kpis: {
      attachments: attachments.length,
      has_primary_attachment: attachments.some((a) => a.kind === "PRIMARY"),
      // Days the request has been open, or how long it took to settle. The
      // register's oldest-first sort answers "what is going stale"; this
      // answers it for one row.
      age_days: Math.max(
        0,
        Math.floor(
          (new Date(request.settled_at || Date.now()).getTime() -
            new Date(request.created_at).getTime()) /
            86400000,
        ),
      ),
      money_visible: canSeeFinancials,
    },
    attachments,
    lead: request.lead_id
      ? {
          lead_id: request.lead_id,
          company_name: request.lead_company_name,
          status: request.lead_status,
        }
      : null,
    timeline: await timeline(c, "quote_request:" + quoteRequestId),
  };
}

module.exports = {
  leadDossier,
  leadRequests,
  leadQuotations,
  leadActivity,
  intakeDossier,
  // Exported for tests and for reuse by the intake dossier.
  leadKpis,
  leadMeetings,
  intakeAttachments,
  timeline,
  money,
};
