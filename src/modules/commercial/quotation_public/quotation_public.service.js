/**
 * The public quotation link, `/q/<token>` on public-web
 * (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.4 "The link"; owner decision D7).
 * The page is PR 6's; this is everything it reads and does.
 *
 *   read      the output chosen at send, in the language asked for (when the
 *             quotation is offered in it), as the ONE render (the same HTML the
 *             PDF prints) plus the structured figures, and how it can be answered
 *   pdf       Download PDF: the same render, vaulted
 *   accept    name and role, then the signature programme: the emailed code
 *             and a stamp or a drawn mark, the counterparty being the address
 *             the quotation was SENT to. Where the tenant offers no e-signature
 *             a named, confirmed accept stands in, never called a signature.
 *   decline   a reason from the signature programme's DECLINE list, and a line
 *
 * Every acceptance goes through `quotation.service accept`, which emits
 * `quotation.accepted`; `quotation.accepted:win-request` then wins the
 * request, makes the prospect a client and opens the file. There is no second
 * win path here.
 *
 * ── THE TOKEN IS THE ONLY CREDENTIAL ───────────────────────────────────────
 *
 * Only its sha256 is stored. A token that matches nothing, a revoked link, an
 * expired one and a draft all answer the same 404: a stranger learns nothing.
 * A link to a quotation already answered still READS (the client sees what
 * they accepted); only answering needs it open and in date.
 *
 * ── WHAT AN OPEN RECORDS ───────────────────────────────────────────────────
 *
 * The time, a coarse browser label and a keyed hash of the visitor, never an
 * address (quotation_view). The first open by a person stamps `viewed_at`,
 * raises `quotation.viewed` and tells the owner; the lead's timeline reads
 * the stamp where it lives.
 *
 * Proposal links from before the revamp resolve here too: 14542 carried their
 * token hashes onto the migrated quotations.
 */
"use strict";

const crypto = require("crypto");
const { config } = require("../../../config/env");
const repo = require("../quotation/quotation.repo");
const rules = require("../quotation/quotation.rules");
const events = require("../quotation/quotation.events");
const quotationService = require("../quotation/quotation.service");
const quotationDocument = require("../quotation/quotation.document");
const { tokenHash } = require("../quotation/quotation.send");
const { signingKit, declineReasons, chosenReason, langOf } = require("../../portal/portal_signing");
const { coarseUserAgent } = require("../../../services/signatures/mask");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

const DOC_TYPE = "QUOTATION";
const entityRef = (id) => `quotation:${id}`;
const notFound = () => new AppError("NOT_FOUND", "This link is not valid", 404);

/** The quotation a token opens, or the uniform 404. */
async function resolve(c, token) {
  if (!token || String(token).length > 200) throw notFound();
  const row = await repo.byShareHash(c, tokenHash(token));
  if (!row || rules.linkState(row) !== "OPEN") throw notFound();
  return row;
}

/** Answering needs the offer open and in date (and not withdrawn by a newer version). */
function assertAnswerable(row) {
  if (row.status !== "SENT") {
    throw new AppError("QUOTATION_ANSWERED", "This quotation has already been answered", 409, { status: row.status });
  }
  if (!rules.answerable(row)) {
    throw new AppError("QUOTATION_EXPIRED", "This quotation is no longer valid. Ask for an updated one.", 409);
  }
}

/** Who the link was sent to: the counterparty the signature programme writes to. */
async function recipientOf(c, row) {
  if (row.sent_to) return String(row.sent_to);
  // A quotation migrated from a proposal (14542) was never sent through Send:
  // the address on file is its company row's, else its client's.
  const { rows } = await c.query(
    `SELECT COALESCE(NULLIF(l.email::text, ''), NULLIF(cm.email::text, '')) AS email
       FROM quotation q
       LEFT JOIN lead l ON l.lead_id = q.lead_id
       LEFT JOIN client_master cm ON cm.client_id = q.client_id
      WHERE q.quotation_id = $1`,
    [row.quotation_id],
  );
  return rows[0] && rows[0].email ? String(rows[0].email) : null;
}

/** Who stands behind the signing request: whoever sent it, else the portal's rule. */
async function sender(c, row) {
  if (row.sent_by) {
    const { rows } = await c.query("SELECT user_id FROM app_user WHERE user_id = $1 AND status = 'ACTIVE'", [row.sent_by]);
    if (rows[0]) return rows[0].user_id;
  }
  return require("../../portal/portal_quotation.service").sender(c, row);
}

let kitOnce = null;
function kit() {
  if (!kitOnce) kitOnce = signingKit({ docType: DOC_TYPE, refOf: entityRef, senderOf: sender });
  return kitOnce;
}

/** A keyed hash of who opened it: enough to tell visitors apart, never an address. */
function visitorHash(ip, ua) {
  return crypto.createHmac("sha256", String(config.JWT_ACCESS_SECRET)).update(`${ip || ""}|${ua || ""}`).digest("hex").slice(0, 32);
}

/** Tell the owner, once, that the client opened it. Best-effort: a read never fails over a notice. */
async function tellOwnerOfFirstView(c, row) {
  try {
    const { rows } = await c.query(
      `SELECT COALESCE(qr.owner_user_id, l.owner_user_id, q.sent_by) AS user_id,
              COALESCE(cm.name, cm.legal_name, l.company_name) AS company, q.lead_id
         FROM quotation q
         LEFT JOIN quote_request qr ON qr.quote_request_id = q.quote_request_id
         LEFT JOIN lead l ON l.lead_id = q.lead_id
         LEFT JOIN client_master cm ON cm.client_id = q.client_id
        WHERE q.quotation_id = $1`,
      [row.quotation_id],
    );
    const who = rows[0];
    if (!who || !who.user_id) return;
    const { notify } = require("../../notification/notification.service");
    await notify(c, {
      userId: who.user_id,
      eventTypeKey: events.VIEWED,
      title: `${who.company || "A client"} opened ${row.doc_number || "a quotation"}`,
      body: null,
      entityRef: entityRef(row.quotation_id),
      url: who.lead_id ? `/sales/leads/${who.lead_id}` : `/sales/quotations?focus=${row.quotation_id}`,
      dedupeKey: `quotation-viewed:${row.quotation_id}`,
    });
  } catch (err) {
    logger.warn({ err, quotationId: row.quotation_id }, "[quotation] first-view notice not sent");
  }
}

/** Record an open. The first VIEW by a person stamps viewed_at and is said once. */
async function record(c, row, kind, { ip = null, ua = "" } = {}) {
  const agentLabel = coarseUserAgent(ua, "en");
  await repo.insertView(c, { quotationId: row.quotation_id, kind, via: "LINK", agentLabel, visitorHash: visitorHash(ip, ua) });
  if (kind === "DOWNLOAD") {
    await repo.stampFirstDownload(c, row.quotation_id);
    return;
  }
  // An unfurler (Slack, WhatsApp) is not the client reading it.
  if (/automated/i.test(agentLabel)) return;
  const first = await repo.stampFirstView(c, row.quotation_id);
  if (!first) return;
  await emitEvent(c, {
    eventTypeKey: events.VIEWED, moduleKey: events.MODULE, entityRef: entityRef(row.quotation_id), actorUserId: null,
    payload: { client_id: row.client_id || null, lead_id: row.lead_id || null, doc_number: row.doc_number || null, via: "LINK" },
  });
  await tellOwnerOfFirstView(c, row);
}

/** What the page needs to offer an answer, or nothing when it cannot be answered. */
async function answering(c, row, lang) {
  if (row.status !== "SENT" || !rules.answerable(row)) return { open: false, signing: { available: false, cards: [] }, decline_reasons: [] };
  const cards = (await recipientOf(c, row)) ? await kit().digitalCards(c, langOf(lang)) : [];
  return { open: true, signing: { available: cards.length > 0, cards }, decline_reasons: await declineReasons(c, langOf(lang)) };
}

/** The status the reader is shown: a sent offer past its day reads Expired. */
const shownStatus = (row) => (row.status === "SENT" && !rules.answerable(row) ? "EXPIRED" : row.status);

/** Read the link without recording anything (the page head's preview card). */
async function peek(c, token) {
  const row = await resolve(c, token);
  return { title: row.title || row.doc_number || null, doc_number: row.doc_number || null, summary: null };
}

/**
 * Open the link. `language` is the reader's pick (EN or FR); a quotation
 * offered in one language only answers in it. `output` is the one chosen at
 * send, never the reader's: the switch is the sender's decision.
 */
async function open(c, { token, language = null, ip = null, ua = "" }) {
  const row = await resolve(c, token);
  const lang = rules.pickLanguage(row, language);
  const rendered = await quotationDocument.render(c, { id: row.quotation_id, output: row.default_output, language: lang });
  await record(c, row, "VIEW", { ip, ua });
  const data = rendered.data || {};
  const reply = await answering(c, row, lang);
  return {
    quotation: {
      doc_number: row.doc_number || null,
      title: row.title || null,
      status: shownStatus(row),
      output: row.default_output || "FULL",
      version: row.version || 1,
      currency: row.currency || "XAF",
      valid_until: rules.isoDay(row.valid_until),
      sent_at: row.sent_at || null,
      answered_at: row.answered_at || null,
      decline_reason: row.status === "REJECTED" ? row.decline_reason || null : null,
      totals: data.totals || null,
      party: data.party ? { name: data.party.name } : null,
    },
    language: lang,
    languages: rules.languagesOf(row),
    html: rendered.html,
    signature: ["ACCEPTED", "CONVERTED"].includes(row.status) ? await kit().signatureOf(c, row.quotation_id) : null,
    ...reply,
  };
}

/** Download PDF: the same render, vaulted. */
async function download(c, { token, language = null, ip = null, ua = "" }) {
  const row = await resolve(c, token);
  const out = await quotationDocument.pdf(c, { id: row.quotation_id, output: row.default_output, language: rules.pickLanguage(row, language) });
  await record(c, row, "DOWNLOAD", { ip, ua });
  return { buffer: out.buffer, filename: out.name };
}

/** The person accepting, as the signature programme sees them: their name, the address it was sent to. */
async function signerOf(c, row, { fullName }) {
  const email = await recipientOf(c, row);
  if (!email) throw new AppError("ESIGN_UNAVAILABLE", "This quotation cannot be accepted online. Reply to the email it came with.", 409);
  return { email, full_name: String(fullName).trim().slice(0, 200), portal_user_id: null };
}

/** Accept, step 1: name and role, and the code emailed to the address it was sent to. */
async function startAccept(c, { token, fullName, role = null, lang = "en", tenantName = "" }) {
  const row = await resolve(c, token);
  assertAnswerable(row);
  const me = await signerOf(c, row, { fullName });
  const out = await kit().start(c, {
    row, id: row.quotation_id, me, lang: langOf(lang), tenantName, sourceRef: `quotation_sent_to:${row.quotation_id}`,
  });
  await audit(c, { actorUserId: null, action: "quotation.accept_started", moduleKey: events.MODULE, entityRef: entityRef(row.quotation_id), after: { by_name: me.full_name, role } });
  return out;
}

async function resendCode(c, { token, lang = "en", tenantName = "" }) {
  const row = await resolve(c, token);
  assertAnswerable(row);
  const email = await recipientOf(c, row);
  return kit().resend(c, { id: row.quotation_id, me: { email }, lang: langOf(lang), tenantName });
}

/**
 * Accept, step 2: the code, then the stamp or drawn mark. The programme
 * re-derives the document's hash, so an offer edited since the code was sent
 * is refused. Then the one acceptance.
 */
async function completeAccept(c, { token, code, presetCode, fullName, role = null, markImageB64 = null, ip = null, userAgent = null, lang = "en", origin = null }) {
  const row = await resolve(c, token);
  assertAnswerable(row);
  const me = await signerOf(c, row, { fullName });
  const signed = await kit().sign(c, {
    id: row.quotation_id, me, code, presetCode, fullName: me.full_name, partyRole: role, markImageB64, ip, userAgent, lang: langOf(lang), origin,
  });
  await quotationService.accept(c, { id: row.quotation_id, convert: false, actor: {}, by: { name: me.full_name, email: me.email, role }, via: "LINK" });
  await audit(c, {
    actorUserId: null, action: "quotation.accepted_on_link", moduleKey: events.MODULE, entityRef: entityRef(row.quotation_id),
    after: { by: me.email, by_name: me.full_name, role, signed: true, verify_code: signed.verify_code || null }, ip,
  });
  return { accepted: true, signature: await kit().signatureOf(c, row.quotation_id) };
}

/** Accept without a signature: only where the tenant offers no digital card. */
async function confirmAccept(c, { token, fullName, role = null, ip = null, lang = "en" }) {
  const row = await resolve(c, token);
  assertAnswerable(row);
  const me = await signerOf(c, row, { fullName });
  if ((await kit().digitalCards(c, langOf(lang))).length) {
    throw new AppError("SIGNATURE_REQUIRED", "This quotation is accepted by signing it", 409);
  }
  await quotationService.accept(c, { id: row.quotation_id, convert: false, actor: {}, by: { name: me.full_name, email: me.email, role }, via: "LINK" });
  await audit(c, {
    actorUserId: null, action: "quotation.accepted_on_link", moduleKey: events.MODULE, entityRef: entityRef(row.quotation_id),
    after: { by: me.email, by_name: me.full_name, role, signed: false }, ip,
  });
  return { accepted: true, signature: null };
}

/** Decline with a reason from the controlled list; an open signing request is declined with it. */
async function decline(c, { token, reasonCode, note = null, lang = "en" }) {
  const row = await resolve(c, token);
  assertAnswerable(row);
  const chosen = await chosenReason(c, reasonCode);
  const email = await recipientOf(c, row);
  if (email) await kit().declineOpen(c, { id: row.quotation_id, me: { email }, reasonCode, note, lang: langOf(lang) });
  const reason = `${langOf(lang) === "fr" ? chosen.label_fr : chosen.label_en}${note ? `: ${String(note).slice(0, 400)}` : ""}`;
  await quotationService.decline(c, { id: row.quotation_id, reasonCode, reason, by: { name: null, email }, via: "LINK" });
  return { declined: true };
}

module.exports = {
  resolve, peek, open, download, startAccept, resendCode, completeAccept, confirmAccept, decline,
  recipientOf, visitorHash, shownStatus,
};
