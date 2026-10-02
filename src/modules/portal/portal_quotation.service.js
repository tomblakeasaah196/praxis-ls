/**
 * Commercial quotations in the client portal (tenant review, meeting 6, PR 4 —
 * item 4.1; owner decisions G3 and G4).
 *
 * The portal listed Sales PROPOSALS only, so a quotation the team prepared —
 * including the ones priced from an emailed request — never reached the
 * client. This is the client's side of a quotation:
 *
 *   list     a card per offer the client may see (SENT / ACCEPTED / REJECTED /
 *            EXPIRED / CONVERTED — never a DRAFT), waiting-for-you first;
 *   get      the offer page: service, route, Incoterm, validity, payment
 *            terms, the FAMILIES exactly as the PDF prints them, HT / VAT /
 *            TTC, and the ways to answer it;
 *   pdf      the QUOTATION template's PDF, rendered on demand and kept;
 *   sign     accept by e-signature — the signature programme's flow, shared
 *            with proposals (`portal_signing.js`), bound to the quotation's
 *            canonical hash; then the quotation's own `accept` (convert stays
 *            a staff decision);
 *   accept   a confirmed accept, only where the tenant offers no digital card;
 *   decline  with a reason from the DECLINE list (G4: "Decline asks for a
 *            reason").
 *
 * The client comes from the GRANT, never from a parameter (portal.controller).
 */
"use strict";

const repo = require("../commercial/quotation/quotation.repo");
const quotationService = require("../commercial/quotation/quotation.service");
const quotationEvents = require("../commercial/quotation/quotation.events");
const notificationRepo = require("../notification/notification.repo");
const vault = require("../vault/document_vault/document_vault.service");
const { groupLines } = require("../../services/documents/templates/client-headings");
const { signingKit, declineReasons, chosenReason, langOf } = require("./portal_signing");
const { audit } = require("../../shared/events/emit");
const { AppError } = require("../../utils/errors");

const DOC_TYPE = "QUOTATION";
/** What a client may see. A DRAFT is the team's until it is sent. */
const VISIBLE = ["SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CONVERTED"];
const entityRef = (id) => `quotation:${id}`;
const today = () => new Date().toISOString().slice(0, 10);
const isoDay = (d) => (d ? (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10) : null);

/** SENT but past its validity reads as EXPIRED — nothing to answer any more. */
const shownStatus = (row) => (row.status === "SENT" && row.valid_until && isoDay(row.valid_until) < today() ? "EXPIRED" : row.status);

/** A quotation of THIS client that the client may see. */
async function owned(c, { clientId, quotationId }) {
  const row = await repo.get(c, quotationId);
  if (!row || row.client_id !== clientId || !VISIBLE.includes(row.status)) {
    throw new AppError("NOT_FOUND", "Quotation not found", 404);
  }
  return row;
}

function assertOpen(row) {
  if (row.status !== "SENT") {
    throw new AppError("QUOTATION_ANSWERED", "This quotation has already been answered", 409, { status: row.status });
  }
  if (shownStatus(row) === "EXPIRED") {
    throw new AppError("QUOTATION_EXPIRED", "This quotation is no longer valid. Ask for an updated one.", 409);
  }
}

/**
 * Who stands behind the signing request: whoever sent the quotation, as the
 * ledger remembers it; else the CEO. A signature request is always somebody's
 * (`created_by` is NOT NULL, guide §6.3), and a client cannot be that somebody.
 */
async function sender(c, row) {
  const first = await notificationRepo.requesterFor(c, entityRef(row.quotation_id)).catch(() => null);
  if (first) return first;
  const { rows } = await c.query(
    `SELECT u.user_id
       FROM app_user u
       JOIN user_role ur ON ur.user_id = u.user_id
       JOIN role r ON r.role_id = ur.role_id
      WHERE r.code = 'CEO' AND u.status = 'ACTIVE'
      ORDER BY u.created_at ASC LIMIT 1`,
  );
  if (rows[0]) return rows[0].user_id;
  throw new AppError("NO_SENDER", "This quotation cannot be signed online. Contact your account manager.", 409);
}

let kitOnce = null;
function kit() {
  if (!kitOnce) kitOnce = signingKit({ docType: DOC_TYPE, refOf: entityRef, senderOf: sender });
  return kitOnce;
}

/**
 * The context a card and the page are read with: the request it answers, its
 * service (the request's, else the file's), its route and Incoterm.
 */
const CONTEXT_SELECT = `
  SELECT q.quotation_id, q.doc_number, q.status, q.currency, q.total_ht, q.total_ttc, q.valid_until,
         q.sent_at, q.created_at, q.updated_at, q.answered_at, q.decline_reason, q.quote_request_id,
         qr.public_ref AS request_ref,
         COALESCE(qst.name_en, dst.name_en, qst.name_fr, dst.name_fr) AS service_en,
         COALESCE(qst.name_fr, dst.name_fr, qst.name_en, dst.name_en) AS service_fr,
         COALESCE(NULLIF(qr.origin_location, ''), d.pol) AS origin,
         COALESCE(NULLIF(qr.destination_location, ''), d.pod) AS destination,
         CASE WHEN qr.incoterm IS NOT NULL AND qr.incoterm NOT IN ('TBD', 'N/A') THEN qr.incoterm ELSE d.incoterm END AS incoterm,
         d.ref AS dossier_ref
    FROM quotation q
    LEFT JOIN quote_request qr ON qr.quote_request_id = q.quote_request_id
    LEFT JOIN service_type qst ON qst.service_type_id = qr.service_type_id
    LEFT JOIN dossier_visible d ON d.dossier_id = q.dossier_id
    LEFT JOIN service_type dst ON dst.service_type_id = d.service_type_id`;

function cardOf(r, lang) {
  const status = shownStatus(r);
  return {
    quotation_id: r.quotation_id,
    doc_number: r.doc_number || null,
    status,
    waiting: status === "SENT",
    currency: r.currency || "XAF",
    total_ht: Number(r.total_ht || 0),
    total: Number(r.total_ttc || 0),
    service: (langOf(lang) === "fr" ? r.service_fr : r.service_en) || null,
    route: r.origin || r.destination ? { from: r.origin || null, to: r.destination || null } : null,
    incoterm: r.incoterm || null,
    valid_until: isoDay(r.valid_until),
    sent_on: r.sent_at || r.updated_at || r.created_at,
    request: r.quote_request_id ? { quote_request_id: r.quote_request_id, public_ref: r.request_ref || null } : null,
    dossier_ref: r.dossier_ref || null,
  };
}

/** Every offer the client may see — waiting-for-you first, then newest. */
async function list(c, { clientId, lang = "en" }) {
  const { rows } = await c.query(
    `${CONTEXT_SELECT}
      WHERE q.client_id = $1 AND q.status = ANY($2::text[])
      ORDER BY CASE WHEN q.status = 'SENT' AND (q.valid_until IS NULL OR q.valid_until >= CURRENT_DATE) THEN 0 ELSE 1 END,
               COALESCE(q.sent_at, q.updated_at) DESC
      LIMIT 100`,
    [clientId, VISIBLE],
  );
  return rows.map((r) => cardOf(r, lang));
}

/** How many quotations wait for this client's answer — the menu's count and Home. */
async function pendingCount(c, { clientId }) {
  const { rows } = await c.query(
    `SELECT COUNT(*)::int AS n FROM quotation
      WHERE client_id = $1 AND status = 'SENT' AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)`,
    [clientId],
  );
  return rows[0] ? rows[0].n : 0;
}

/**
 * The families exactly as the PDF prints them: the QUOTATION template's own
 * record (template.service loadRecord) grouped by the template's own
 * `groupLines`, in the document's family order — the same two functions the
 * printer calls, so the page and the download cannot disagree.
 */
async function printedLines(c, quotationId, lang) {
  const template = require("../documents/template/template.service");
  const rec = await template.loadRecord(c, DOC_TYPE, quotationId);
  if (!rec) return { lines: [], totals: null };
  const display = (rec.data.lines || []).map((l) => (l && l.tax_rate !== undefined ? { ...l, tax: l.tax_rate } : l));
  const grouped = groupLines(display, langOf(lang), rec.data.client_headings, rec.data.family_order);
  return {
    lines: grouped.map((g) => ({ label: g.label, amount: g.amount, vat_rate: g.tax, is_disbursement: g.is_disbursement === true })),
    totals: rec.data.totals,
  };
}

async function get(c, { clientId, quotationId, lang = "en" }) {
  const row = await owned(c, { clientId, quotationId });
  const [ctx, printed, clientRows] = await Promise.all([
    c.query(`${CONTEXT_SELECT} WHERE q.quotation_id = $1`, [quotationId]),
    printedLines(c, quotationId, lang),
    c.query("SELECT COALESCE(name, legal_name) AS name, payment_terms_days FROM client_master WHERE client_id = $1", [clientId]),
  ]);
  const card = cardOf(ctx.rows[0] || row, lang);
  // "Viewed" is telemetry for sales: the first open only, never a reason to fail the read.
  if (!row.viewed_at) {
    await c.query("UPDATE quotation SET viewed_at = now() WHERE quotation_id = $1 AND viewed_at IS NULL", [quotationId]).catch(() => {
      /* @silent:storage — telemetry, as for proposals */
    });
  }
  const open = row.status === "SENT" && card.status === "SENT";
  const cards = open ? await kit().digitalCards(c, langOf(lang)) : [];
  const terms = clientRows.rows[0] ? clientRows.rows[0].payment_terms_days : null;
  const vat = Math.round((Number(row.total_ttc || 0) - Number(row.total_ht || 0)) * 100) / 100;
  return {
    quotation: {
      ...card,
      payment_terms_days: terms === null || terms === undefined ? null : Number(terms),
      totals: { ht: Number(row.total_ht || 0), vat, ttc: Number(row.total_ttc || 0) },
      lines: printed.lines,
      decline_reason: row.status === "REJECTED" ? row.decline_reason || null : null,
      answered_at: row.answered_at || null,
    },
    signature: ["ACCEPTED", "CONVERTED"].includes(row.status) ? await kit().signatureOf(c, quotationId) : null,
    signing: { available: cards.length > 0, cards },
    decline_reasons: open ? await declineReasons(c, langOf(lang)) : [],
  };
}

/**
 * The PDF — the QUOTATION template, rendered on demand and KEPT: the vaulted
 * copy is served again until the quotation changes (a signature, an answer),
 * and then rendered again so it carries the seal it now has.
 */
async function pdf(c, { clientId, quotationId, lang = "en", origin = null, env = "live" }) {
  const row = await owned(c, { clientId, quotationId });
  if (row.pdf_vault_id) {
    const { rows } = await c.query("SELECT created_at, storage_path FROM document_vault WHERE doc_id = $1", [row.pdf_vault_id]);
    const kept = rows[0];
    if (kept && kept.storage_path && !String(kept.storage_path).startsWith("pending://") && new Date(kept.created_at) >= new Date(row.updated_at)) {
      const out = await vault.fetchBytes(c, row.pdf_vault_id);
      return { buffer: out.buffer, name: `${row.doc_number || "quotation"}.pdf`, type: "application/pdf" };
    }
  }
  const template = require("../documents/template/template.service");
  const made = await template.generate(c, { docType: DOC_TYPE, recordId: quotationId, actor: {}, origin, language: langOf(lang), env });
  // Not through the repo: its update touches updated_at, which would make the
  // copy just kept look stale on the next download.
  await c.query("UPDATE quotation SET pdf_vault_id = $2 WHERE quotation_id = $1", [quotationId, made.doc_id]);
  const out = await vault.fetchBytes(c, made.doc_id);
  return { buffer: out.buffer, name: `${row.doc_number || "quotation"}.pdf`, type: "application/pdf" };
}

/* ── answering ────────────────────────────────────────────────────────────── */

async function startSigning(c, { clientId, quotationId, me, grantId = null, lang = "en", tenantName = "" }) {
  const row = await owned(c, { clientId, quotationId });
  assertOpen(row);
  return kit().start(c, { row, id: quotationId, me, grantId, lang: langOf(lang), tenantName });
}

async function resendCode(c, { clientId, quotationId, me, lang = "en", tenantName = "" }) {
  const row = await owned(c, { clientId, quotationId });
  assertOpen(row);
  return kit().resend(c, { id: quotationId, me, lang: langOf(lang), tenantName });
}

/**
 * Verify the code, sign, accept. The quotation's `accept` runs with who at the
 * client signed it; convert stays a staff decision (`quotation.convert`).
 */
async function completeSigning(c, { clientId, quotationId, me, code, presetCode, fullName = null, partyRole = null, markImageB64 = null, ip = null, userAgent = null, lang = "en", origin = null, slug = null }) {
  const row = await owned(c, { clientId, quotationId });
  assertOpen(row);
  const signed = await kit().sign(c, {
    id: quotationId, me, code, presetCode, fullName, partyRole, markImageB64, ip, userAgent, lang: langOf(lang), origin, slug,
  });
  await quotationService.accept(c, { id: quotationId, convert: false, actor: {}, by: { name: me.full_name || null, email: me.email || null }, via: "PORTAL" });
  await audit(c, {
    actorUserId: null, action: "quotation.accepted_in_portal", moduleKey: quotationEvents.MODULE,
    entityRef: entityRef(quotationId),
    after: { by: me.email, by_name: me.full_name || null, signed: true, verify_code: signed.verify_code || null },
    ip,
  });
  return { accepted: true, signature: await kit().signatureOf(c, quotationId) };
}

/** Accept without a signature — only where the tenant offers no digital card. */
async function accept(c, { clientId, quotationId, me, ip = null, lang = "en" }) {
  const row = await owned(c, { clientId, quotationId });
  assertOpen(row);
  if ((await kit().digitalCards(c, langOf(lang))).length) {
    throw new AppError("SIGNATURE_REQUIRED", "This quotation is accepted by signing it", 409);
  }
  await quotationService.accept(c, { id: quotationId, convert: false, actor: {}, by: { name: me.full_name || null, email: me.email || null }, via: "PORTAL" });
  await audit(c, {
    actorUserId: null, action: "quotation.accepted_in_portal", moduleKey: quotationEvents.MODULE,
    entityRef: entityRef(quotationId), after: { by: me.email, by_name: me.full_name || null, signed: false }, ip,
  });
  return { accepted: true, signature: null };
}

/** Decline with a reason from the controlled list; an open signing request is declined with it. */
async function decline(c, { clientId, quotationId, me, reasonCode, note = null, lang = "en" }) {
  const row = await owned(c, { clientId, quotationId });
  assertOpen(row);
  const chosen = await chosenReason(c, reasonCode);
  await kit().declineOpen(c, { id: quotationId, me, reasonCode, note, lang: langOf(lang) });
  const reason = `${langOf(lang) === "fr" ? chosen.label_fr : chosen.label_en}${note ? ` — ${String(note).slice(0, 400)}` : ""}`;
  await quotationService.decline(c, { id: quotationId, reasonCode, reason, by: { name: me.full_name || null, email: me.email || null } });
  return { declined: true };
}

/**
 * The client's offers that answer one of their requests — for the request
 * page (PR 2 left the place): newest first.
 */
async function forRequest(c, { clientId, quoteRequestId, lang = "en" }) {
  const { rows } = await c.query(
    `${CONTEXT_SELECT}
      WHERE q.client_id = $1 AND q.quote_request_id = $2 AND q.status = ANY($3::text[])
      ORDER BY COALESCE(q.sent_at, q.updated_at) DESC LIMIT 5`,
    [clientId, quoteRequestId, VISIBLE],
  );
  return rows.map((r) => cardOf(r, lang));
}

module.exports = { list, get, pdf, startSigning, resendCode, completeSigning, accept, decline, pendingCount, forRequest, VISIBLE, shownStatus };
