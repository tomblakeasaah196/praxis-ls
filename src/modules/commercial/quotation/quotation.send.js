/**
 * Send, share, revise and expire a quotation
 * (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.4 "Send", "The link", "Revise").
 *
 * ── SEND ───────────────────────────────────────────────────────────────────
 *
 * To (the company's contact by default), Cc, Subject, Message, the output
 * (Full or Extract) and the PDF attached. In ONE transaction: the quotation is
 * issued (numbered, captured, the request moved to Quoted, the profile pinned,
 * the version it revises withdrawn), a share link is minted that opens until
 * the offer's last valid day, and the next step "Follow up quotation" is set
 * three working days out. Then, once that has committed, the mail leaves
 * through the mail engine on the `quotation.sent` send point.
 *
 * The mail goes AFTER the commit on purpose: a mail that left for a quotation
 * that then rolled back would hand a client a link to nothing. If the mail
 * fails, the quotation stays sent with its link open, the failure is audited
 * and the caller is told in so many words (QUOTATION_MAIL_FAILED); sending
 * again resends it under a fresh link, which retires the one that never
 * arrived. In the TEST environment the engine withholds the mail and the
 * answer says `delivered: false`, never that it was delivered.
 *
 * ── THE LINK ───────────────────────────────────────────────────────────────
 *
 * 32 random bytes, shown once (in the mail, or to staff on Copy Link) and
 * stored only as a sha256. Minting a new one replaces the old, revoking it.
 *
 * ── REVISE ─────────────────────────────────────────────────────────────────
 *
 * A sent, declined or expired quotation is copied into version + 1 as a
 * DRAFT, lines and sections intact, `supersedes_id` naming it. Sending the
 * new version withdraws the old one (quotation.service `issue`). One open
 * revision at a time.
 */
"use strict";

const crypto = require("crypto");
const repo = require("./quotation.repo");
const rules = require("./quotation.rules");
const events = require("./quotation.events");
const quotationSections = require("./quotation.sections");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { atomically } = require("../../../shared/db/tx");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

const ref = (id) => "quotation:" + id;
const service = () => require("./quotation.service");
const tokenHash = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");
const mintToken = () => crypto.randomBytes(32).toString("base64url");

/** Where the public page lives: the tenant's public site, else the host the request came in on. */
async function linkBase(client, origin) {
  // The careers module already resolves the tenant's public site base the way
  // every outsider link must (registry first, then the request's host under
  // /public): one rule for every link a stranger is mailed.
  return require("../../hr/careers/careers.link").careersBase(client, { origin });
}
const linkUrl = (base, token) => (base ? `${base}/q/${encodeURIComponent(token)}` : `/q/${encodeURIComponent(token)}`);

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Mint (or replace) the link. Inside the caller's transaction. */
async function mint(client, q, { expiresOn = null } = {}) {
  const token = mintToken();
  const until = expiresOn && (!q.valid_until || expiresOn <= rules.isoDay(q.valid_until)) ? expiresOn : q.valid_until;
  const row = await repo.update(client, q.quotation_id, {
    share_token_hash: tokenHash(token),
    share_expires_at: rules.shareExpiry(until),
    share_revoked_at: null,
  });
  return { token, row };
}

/**
 * The next step after a send (§3.4): "Follow up quotation" in three working
 * days, on the company row, for its owner. Only where the row is open and the
 * caller did not turn it off; a refusal from the lead service never fails the
 * send (the quotation went out, the reminder is a courtesy).
 */
async function followUp(client, q, actor) {
  const leadId = q.lead_id || (q.client_id ? await repo.leadOfClient(client, q.client_id) : null);
  if (!leadId) return null;
  const lead = await repo.leadHead(client, leadId);
  if (!lead || lead.status !== "OPEN") return null;
  await client.query("SAVEPOINT quotation_follow_up");
  try {
    await require("../../sales/lead/lead.service").setNextStep(client, {
      id: leadId,
      step: { action: "Follow up quotation", due_at: rules.workingDaysFrom(new Date(), 3).toISOString(), assigned_to: lead.owner_user_id || actor.user_id || null },
      actor,
    });
    await client.query("RELEASE SAVEPOINT quotation_follow_up");
    return leadId;
  } catch (err) {
    await client.query("ROLLBACK TO SAVEPOINT quotation_follow_up");
    if (err instanceof AppError && err.status < 500) return null;
    throw err;
  }
}

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The covering mail: the sender's message, then the link. One language, the attachment's. */
function mailBody({ message, url, language, number }) {
  const fr = language === "FR";
  const open = fr ? "Consulter et répondre en ligne" : "View and answer online";
  const note = fr
    ? `Le document ${esc(number || "")} est joint. Le lien ci-dessous permet de le consulter, de le télécharger, de l'accepter ou de le décliner.`
    : `The document ${esc(number || "")} is attached. The link below lets you read it, download it, and accept or decline it.`;
  const html = [
    message ? `<p>${esc(message).replace(/\n/g, "<br>")}</p>` : "",
    `<p>${note}</p>`,
    `<p><a href="${esc(url)}">${open}</a></p>`,
  ].join("");
  const text = [message || "", note.replace(/<[^>]+>/g, ""), `${open}: ${url}`].filter(Boolean).join("\n\n");
  return { html, text };
}

/**
 * Send. `input` is the shared `quotation.send` shape. `origin` is the request's
 * host (the link falls back to it); `env` decides the watermark and whether
 * the mail engine withholds the message.
 */
async function send(client, { id, input, actor = {}, origin = null, env = "live" }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quotation not found", 404);
  if (!["DRAFT", "SENT"].includes(before.status)) {
    throw new AppError("BAD_STATE", `A ${before.status} quotation cannot be sent`, 422, { status: before.status });
  }
  if (before.superseded_at) throw new AppError("QUOTATION_SUPERSEDED", "A newer version of this quotation has been sent", 409);
  const output = input.output || before.default_output || "FULL";
  const language = rules.pickLanguage(before, input.language);
  const firstSend = before.status === "DRAFT";

  const { token, row } = await atomically(client, async () => {
    let q = before;
    // A quotation goes out with a date it lapses on: 30 days unless one was set.
    if (!q.valid_until || rules.isoDay(q.valid_until) < today()) {
      if (!firstSend && q.valid_until) throw new AppError("QUOTATION_EXPIRED", "This quotation is past its validity. Revise it to send a new offer.", 409);
      q = await repo.update(client, id, { valid_until: plusDays(30) });
    }
    if (firstSend) q = await service().issue(client, { before: q, entityId: input.entity_id || null, actor });
    q = await repo.update(client, id, {
      default_output: output,
      sent_to: input.to,
      sent_cc: input.cc && input.cc.length ? input.cc : null,
      sent_subject: input.subject,
      ...(firstSend ? {} : { sent_at: new Date(), sent_by: actor.user_id || null }),
    });
    const minted = await mint(client, q);
    if (firstSend) {
      await emitEvent(client, {
        eventTypeKey: events.SENT, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null,
        payload: { client_id: q.client_id || null, lead_id: q.lead_id || null, doc_number: q.doc_number || null, total_ttc: Number(q.total_ttc) || 0, currency: q.currency, output },
      });
    }
    if (input.follow_up !== false) await followUp(client, minted.row, actor);
    await audit(client, {
      actorUserId: actor.user_id || null, action: firstSend ? events.SENT : events.MAILED, moduleKey: events.MODULE, entityRef: ref(id),
      after: { to: input.to, cc: input.cc || [], subject: input.subject, output, language, share_expires_at: minted.row.share_expires_at },
    });
    return minted;
  });

  // The mail, after the commit (see the header).
  const document = require("./quotation.document");
  const emailSvc = require("../../../services/email.service");
  const url = linkUrl(await linkBase(client, origin), token);
  let attachment = null;
  try {
    const rendered = await document.render(client, { id, output, language, origin, env });
    const buffer = await require("../../../services/pdf.service").renderHtml(rendered.html);
    if (buffer && buffer.length) {
      attachment = { filename: `${row.doc_number || "quotation"}-${language.toLowerCase()}.pdf`, content: buffer, contentType: "application/pdf" };
    }
  } catch (err) {
    // The PDF needs headless Chrome, routinely absent on a fresh deploy
    // (doc/PDF_RENDERING_SETUP.md). The mail still carries the link, which
    // opens the same document; losing the attachment beats not sending.
    logger.warn({ err: err && err.message, quotationId: id }, "[quotation] PDF not attached to the send");
  }
  const body = mailBody({ message: input.message, url, language, number: row.doc_number });
  let info;
  try {
    info = await emailSvc.send(client, {
      to: input.to,
      cc: input.cc && input.cc.length ? input.cc : null,
      subject: input.subject,
      html: body.html,
      text: body.text,
      attachments: attachment ? [attachment] : null,
      purpose: "DOCUMENTS",
      moduleKey: events.MODULE,
      entityRef: ref(id),
      // §3.5 send points: a tenant who routes quotations from its sales address
      // is obeyed, per corporate entity where one is bound.
      sendPoint: "quotation.sent", entityId: row.entity_id || null,
      actorUserId: actor.user_id || null,
      language: language.toLowerCase(),
    });
  } catch (err) {
    await audit(client, { actorUserId: actor.user_id || null, action: events.MAIL_FAILED, moduleKey: events.MODULE, entityRef: ref(id), after: { to: input.to, error: err && err.message } });
    throw new AppError(
      "QUOTATION_MAIL_FAILED",
      "The quotation is sent and its link is open, but the email could not be delivered. Send it again.",
      502,
      { quotation_id: id, status: "SENT", reason: err && err.message ? String(err.message).slice(0, 300) : null },
    );
  }
  const suppressed = Boolean(info && info.suppressed);
  return {
    quotation: await service().get(client, id),
    link: { url, expires_at: row.share_expires_at },
    mail: { delivered: !suppressed, suppressed, reason: suppressed ? info.reason : null, attached: Boolean(attachment), to: input.to, cc: input.cc || [] },
  };
}

/** Copy Link: a fresh link on a sent quotation, shown once. */
async function share(client, { id, expiresOn = null, actor = {}, origin = null }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quotation not found", 404);
  if (before.status !== "SENT") throw new AppError("NOT_SENT", "Only a sent quotation can be shared", 422, { status: before.status });
  if (before.superseded_at) throw new AppError("QUOTATION_SUPERSEDED", "A newer version of this quotation has been sent", 409);
  const { token, row } = await atomically(client, async () => {
    const minted = await mint(client, before, { expiresOn });
    await audit(client, { actorUserId: actor.user_id || null, action: events.SHARED, moduleKey: events.MODULE, entityRef: ref(id), after: { share_expires_at: minted.row.share_expires_at } });
    return minted;
  });
  return { url: linkUrl(await linkBase(client, origin), token), path: `/q/${encodeURIComponent(token)}`, expires_at: row.share_expires_at };
}

async function revokeShare(client, { id, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quotation not found", 404);
  return atomically(client, async () => {
    const row = await repo.update(client, id, { share_revoked_at: new Date() });
    await emitEvent(client, { eventTypeKey: events.SHARE_REVOKED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.SHARE_REVOKED, moduleKey: events.MODULE, entityRef: ref(id), after: { share_revoked_at: row.share_revoked_at } });
    return service().strip(row);
  });
}

const REVISABLE = ["SENT", "REJECTED", "EXPIRED"];

/** Revise: version + 1 as a DRAFT, lines and sections intact. */
async function revise(client, { id, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quotation not found", 404);
  if (!REVISABLE.includes(before.status)) {
    throw new AppError("BAD_STATE", "Only a sent, declined or expired quotation can be revised", 422, { status: before.status });
  }
  const open = await repo.openRevisionOf(client, id);
  if (open) throw new AppError("REVISION_OPEN", "A revision of this quotation is already being drafted", 409, { quotation_id: open });
  const newId = await atomically(client, async () => {
    const version = (await repo.chainVersion(client, id)) + 1;
    const copy = await repo.insert(client, {
      entity_id: before.entity_id, client_id: before.client_id, lead_id: before.lead_id, dossier_id: before.dossier_id,
      costing_id: before.costing_id, currency: before.currency, quote_model: before.quote_model, margin_percent: before.margin_percent,
      valid_until: null, status: "DRAFT", quote_request_id: before.quote_request_id,
      family_order: before.family_order ? JSON.stringify(before.family_order) : null,
      created_from: "REVISION", own_cost_total: before.own_cost_total,
      title: before.title, language: before.language, default_output: before.default_output, template_id: before.template_id,
      version, supersedes_id: id,
    });
    const lines = await repo.listLines(client, id);
    for (const l of lines) {
      await repo.insertLine(client, {
        quotation_id: copy.quotation_id, dictionary_item_id: l.dictionary_item_id || null, label: l.label, qty: l.qty,
        unit_price: l.unit_price, is_disbursement: l.is_disbursement === true, tax_code_id: l.is_disbursement === true ? null : l.tax_code_id || null,
        container_type_ref_id: l.container_type_ref_id || null, client_heading: l.client_heading || null, line_no: l.line_no,
      });
    }
    await repo.update(client, copy.quotation_id, { total_ht: before.total_ht, total_ttc: before.total_ttc });
    await quotationSections.write(client, copy.quotation_id, await quotationSections.read(client, id));
    await emitEvent(client, {
      eventTypeKey: events.REVISED, moduleKey: events.MODULE, entityRef: ref(copy.quotation_id), actorUserId: actor.user_id || null,
      payload: { supersedes_id: id, version, lead_id: before.lead_id || null, client_id: before.client_id || null },
    });
    await audit(client, { actorUserId: actor.user_id || null, action: events.REVISED, moduleKey: events.MODULE, entityRef: ref(copy.quotation_id), after: { supersedes_id: id, version } });
    return copy.quotation_id;
  });
  return service().get(client, newId);
}

/**
 * The nightly expiry: a SENT offer past its last valid day becomes EXPIRED.
 * The link already refuses to accept it from that day (rules.answerable); this
 * makes the register say so. Each in its own transaction, so one bad row does
 * not hold the rest.
 */
async function expireOverdue(client, { limit = 500 } = {}) {
  const ids = await repo.sentPastValidity(client, limit);
  let expired = 0;
  for (const id of ids) {
    const done = await atomically(client, async () => {
      const { rows } = await client.query(
        "UPDATE quotation SET status = 'EXPIRED' WHERE quotation_id = $1 AND status = 'SENT' AND valid_until < CURRENT_DATE RETURNING quotation_id, client_id, lead_id, doc_number",
        [id],
      );
      if (!rows[0]) return false;
      await emitEvent(client, { eventTypeKey: events.EXPIRED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: null, payload: { client_id: rows[0].client_id, lead_id: rows[0].lead_id, doc_number: rows[0].doc_number } });
      await audit(client, { actorUserId: null, action: events.EXPIRED, moduleKey: events.MODULE, entityRef: ref(id), after: { reason: "past valid_until" } });
      return true;
    });
    if (done) expired += 1;
  }
  return { expired };
}

module.exports = { send, share, revokeShare, revise, expireOverdue, tokenHash, mintToken, linkUrl, linkBase, mailBody, followUp, REVISABLE };
