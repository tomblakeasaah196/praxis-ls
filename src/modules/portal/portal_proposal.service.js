/**
 * Proposals in the client portal (client portal redesign PR 2): read one,
 * download it, decline it with a reason, or accept it with an e-signature.
 *
 * ── THE SIGNATURE IS THE SIGNATURE PROGRAMME'S, NOT A SECOND ONE ───────────
 *
 * The flow — a request with the portal user as the ON-FILE counterparty, an
 * emailed code bound to the document's hash, a stamp or a drawn mark — lives
 * in `portal_signing.js`, shared with the portal's commercial quotations
 * (meeting 6, G4: "exactly like proposals"). This file says what a PROPOSAL is
 * to it: which ones a client may see, when one is still open, who sent it, and
 * what accepting or declining one does.
 *
 * ── WHEN THE TENANT HAS E-SIGNATURE OFF ────────────────────────────────────
 *
 * The menu for PROPOSAL (tenant policy + feature flags, `presets.resolveMenu`)
 * may offer no digital card. Accepting a proposal is still the business event
 * the client came to do, so the portal then offers a confirmed "Accept" —
 * recorded with the portal identity in the audit ledger, and never called a
 * signature anywhere.
 */
"use strict";

const proposalRepo = require("../sales/proposal/proposal.repo");
const proposalService = require("../sales/proposal/proposal.service");
const proposalEvents = require("../sales/proposal/proposal.events");
const presentation = require("../sales/proposal/proposal.presentation");
const { languageRef } = require("../sales/proposal_public/proposal_public.service");
const vault = require("../vault/document_vault/document_vault.service");
const { signingKit, declineReasons, chosenReason, DIGITAL } = require("./portal_signing");
const notificationRepo = require("../notification/notification.repo");
const { emitEvent, audit } = require("../../shared/events/emit");
const { AppError } = require("../../utils/errors");

const DOC_TYPE = "PROPOSAL";
const VISIBLE = ["SENT", "ACCEPTED", "REJECTED"];
const entityRef = (id) => `proposal:${id}`;
const langOf = (lang) => (String(lang || "").toLowerCase().startsWith("fr") ? "fr" : "en");

/** A proposal of THIS client that the client may see: sent, or already answered. */
async function owned(c, { clientId, proposalId }) {
  const row = await proposalRepo.get(c, proposalId);
  if (!row || row.client_id !== clientId || !VISIBLE.includes(row.status)) {
    throw new AppError("NOT_FOUND", "Proposal not found", 404);
  }
  return row;
}

const totalOf = (lines) => lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0);

/** Valid until: the day it was sent plus its validity, when it has one. */
function validUntil(row) {
  const days = Number(row.validity_days);
  if (!Number.isFinite(days) || days <= 0) return null;
  const from = new Date(row.sent_at || row.updated_at || row.created_at);
  if (Number.isNaN(from.getTime())) return null;
  return new Date(from.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** The client's signature on a proposal, if one exists — for "Signed by … on …". */
const signatureOf = (c, proposalId) => kit().signatureOf(c, proposalId);

async function list(c, { clientId }) {
  const { rows } = await c.query(
    `SELECT p.proposal_id, p.doc_number, p.title, p.status, p.currency, p.validity_days,
            p.created_at, p.updated_at, p.origin_location, p.destination_location,
            COALESCE(t.total, 0) AS total
       FROM proposal p
       LEFT JOIN (SELECT proposal_id, SUM(COALESCE(qty, 1) * COALESCE(unit_price, 0)) AS total
                    FROM proposal_line GROUP BY proposal_id) t ON t.proposal_id = p.proposal_id
      WHERE p.client_id = $1 AND p.status = ANY($2::text[])
      ORDER BY CASE p.status WHEN 'SENT' THEN 0 ELSE 1 END, p.updated_at DESC
      LIMIT 100`,
    [clientId, VISIBLE],
  );
  return rows.map((r) => ({
    proposal_id: r.proposal_id,
    doc_number: r.doc_number || null,
    title: r.title,
    status: r.status,
    currency: r.currency || "XAF",
    total: Number(r.total || 0),
    route: [r.origin_location, r.destination_location].filter(Boolean).join(" → ") || null,
    sent_on: r.updated_at,
    valid_until: validUntil(r),
  }));
}

/** What the tenant lets a signed-in client sign this with, right now. */
const digitalCards = (c, lang) => kit().digitalCards(c, lang);

async function get(c, { clientId, proposalId, lang = "en" }) {
  const row = await owned(c, { clientId, proposalId });
  const [lines, narratives, clientRows] = await Promise.all([
    proposalRepo.listLines(c, proposalId),
    proposalRepo.listNarratives(c, proposalId),
    c.query("SELECT name, legal_name FROM client_master WHERE client_id = $1", [clientId]),
  ]);
  const model = presentation.build({
    proposal: row, lines, narratives, client: clientRows.rows[0] || null,
    language: langOf(lang) === "fr" ? "FR" : "EN",
  });
  await proposalRepo.stampViewed(c, proposalId).catch(() => {
    /* @silent:storage — "viewed" is telemetry for sales, never a reason to fail the read */
  });
  const cards = row.status === "SENT" ? await digitalCards(c, langOf(lang)) : [];
  const reasonsOffered = row.status === "SENT" ? await declineReasons(c, langOf(lang)) : [];
  return {
    proposal: {
      proposal_id: row.proposal_id,
      doc_number: row.doc_number || null,
      title: row.title,
      status: row.status,
      currency: row.currency || "XAF",
      total: totalOf(lines),
      valid_until: validUntil(row),
    },
    presentation: model,
    signature: row.status === "ACCEPTED" ? await signatureOf(c, proposalId) : null,
    signing: { available: cards.length > 0, cards },
    decline_reasons: reasonsOffered,
  };
}

/** The PDF, in the language asked for when the proposal was issued in both. */
async function pdf(c, { clientId, proposalId, lang = "en" }) {
  const row = await owned(c, { clientId, proposalId });
  const selected = presentation.selectedLanguage(row, langOf(lang) === "fr" ? "FR" : "EN");
  const exact = await vault.getByRef(c, languageRef(row.proposal_id, selected));
  const docId = (exact && exact.doc_id) || row.pdf_vault_id;
  if (!docId) throw new AppError("NOT_READY", "The document is still being prepared", 409);
  const out = await vault.fetchBytes(c, docId);
  await proposalRepo.stampDownloaded(c, proposalId).catch(() => {
    /* @silent:storage — telemetry, as above */
  });
  return { buffer: out.buffer, name: `${row.doc_number || "proposal"}.pdf`, type: "application/pdf" };
}

/* ── signing ─────────────────────────────────────────────────────────────── */

function assertOpen(row) {
  if (row.status !== "SENT") {
    throw new AppError("PROPOSAL_ANSWERED", "This proposal has already been answered", 409, { status: row.status });
  }
  const until = validUntil(row);
  if (until && until < new Date().toISOString().slice(0, 10)) {
    throw new AppError("PROPOSAL_EXPIRED", "This proposal is no longer valid. Ask for an updated one.", 409);
  }
}

/**
 * Who stands behind the request: the person who sent the proposal, as the
 * ledger remembers it; else its reviewer; else the MD. A signature request is
 * always somebody's (`created_by` is NOT NULL, guide §6.3), and a client
 * cannot be that somebody.
 */
async function sender(c, row) {
  const first = await notificationRepo.requesterFor(c, entityRef(row.proposal_id)).catch(() => null);
  if (first) return first;
  if (row.reviewed_by) return row.reviewed_by;
  // The MD is the CEO role (as auth derives is_ceo — app_user has no column).
  const { rows } = await c.query(
    `SELECT u.user_id
       FROM app_user u
       JOIN user_role ur ON ur.user_id = u.user_id
       JOIN role r ON r.role_id = ur.role_id
      WHERE r.code = 'CEO' AND u.status = 'ACTIVE'
      ORDER BY u.created_at ASC LIMIT 1`,
  );
  if (rows[0]) return rows[0].user_id;
  throw new AppError("NO_SENDER", "This proposal cannot be signed online. Contact your account manager.", 409);
}

/** The signature programme's flow for a PROPOSAL (portal_signing.js). */
let kitOnce = null;
function kit() {
  if (!kitOnce) kitOnce = signingKit({ docType: DOC_TYPE, refOf: entityRef, senderOf: sender });
  return kitOnce;
}

/** Open (or reuse) the signing request and email the code. */
async function startSigning(c, { clientId, proposalId, me, grantId = null, lang = "en", tenantName = "" }) {
  const row = await owned(c, { clientId, proposalId });
  assertOpen(row);
  return kit().start(c, { row, id: proposalId, me, grantId, lang: langOf(lang), tenantName });
}

/** Send the code again (the same row; the programme caps resends). */
async function resendCode(c, { clientId, proposalId, me, lang = "en", tenantName = "" }) {
  const row = await owned(c, { clientId, proposalId });
  assertOpen(row);
  return kit().resend(c, { id: proposalId, me, lang: langOf(lang), tenantName });
}

/**
 * Verify the code, sign, and accept. The order is the programme's: the code
 * is checked against THIS payload, `complete` re-derives the hash (a proposal
 * edited since the code was sent is refused), then the proposal moves.
 */
async function completeSigning(c, { clientId, proposalId, me, code, presetCode, fullName = null, partyRole = null, markImageB64 = null, ip = null, userAgent = null, lang = "en", origin = null, slug = null }) {
  const row = await owned(c, { clientId, proposalId });
  assertOpen(row);
  const signed = await kit().sign(c, {
    id: proposalId, me, code, presetCode, fullName, partyRole, markImageB64, ip, userAgent, lang: langOf(lang), origin, slug,
  });

  await proposalService.accept(c, { id: proposalId, actor: {}, by: { name: me.full_name || null, email: me.email || null } });
  await audit(c, {
    actorUserId: null, action: "proposal.accepted_in_portal", moduleKey: proposalEvents.MODULE,
    entityRef: entityRef(proposalId),
    after: { by: me.email, by_name: me.full_name || null, signed: true, verify_code: signed.verify_code || null },
    ip,
  });
  return { accepted: true, signature: await signatureOf(c, proposalId) };
}

/** Accept without a signature — only where the tenant offers no digital card. */
async function accept(c, { clientId, proposalId, me, ip = null, lang = "en" }) {
  const row = await owned(c, { clientId, proposalId });
  assertOpen(row);
  if ((await digitalCards(c, langOf(lang))).length) {
    throw new AppError("SIGNATURE_REQUIRED", "This proposal is accepted by signing it", 409);
  }
  await proposalService.accept(c, { id: proposalId, actor: {}, by: { name: me.full_name || null, email: me.email || null } });
  await audit(c, {
    actorUserId: null, action: "proposal.accepted_in_portal", moduleKey: proposalEvents.MODULE,
    entityRef: entityRef(proposalId), after: { by: me.email, by_name: me.full_name || null, signed: false }, ip,
  });
  return { accepted: true, signature: null };
}

/**
 * Decline with a reason from the controlled list (the signing programme's
 * DECLINE vocabulary, so sales reads one set of reasons wherever a client said
 * no). An open signing request is declined with it.
 */
async function decline(c, { clientId, proposalId, me, reasonCode, note = null, lang = "en" }) {
  const row = await owned(c, { clientId, proposalId });
  assertOpen(row);
  const chosen = await chosenReason(c, reasonCode);
  await kit().declineOpen(c, { id: proposalId, me, reasonCode, note, lang: langOf(lang) });
  await proposalService.transition(c, { id: proposalId, to: "REJECTED", actor: {} });
  const reason = `${langOf(lang) === "fr" ? chosen.label_fr : chosen.label_en}${note ? ` — ${String(note).slice(0, 400)}` : ""}`;
  await audit(c, {
    actorUserId: null, action: "proposal.declined_in_portal", moduleKey: proposalEvents.MODULE,
    entityRef: entityRef(proposalId), after: { by: me.email, by_name: me.full_name || null, reason_code: reasonCode, reason },
  });
  // Sales hears it with the reason, not just that the status changed.
  await emitEvent(c, {
    eventTypeKey: "proposal.declined_by_client", moduleKey: proposalEvents.MODULE, entityRef: entityRef(proposalId),
    actorUserId: null,
    payload: {
      client_id: clientId, doc_number: row.doc_number, reason_code: reasonCode, reason,
      by: { name: me.full_name || null, email: me.email || null },
    },
  });
  return { declined: true };
}

/** How many proposals wait for this client's answer — the Home card. */
async function pendingCount(c, { clientId }) {
  const { rows } = await c.query(
    "SELECT COUNT(*)::int AS n FROM proposal WHERE client_id = $1 AND status = 'SENT'",
    [clientId],
  );
  return rows[0] ? rows[0].n : 0;
}

module.exports = {
  list, get, pdf, startSigning, resendCode, completeSigning, accept, decline, pendingCount, validUntil, DIGITAL,
};
