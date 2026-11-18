/**
 * Proposals in the client portal, after the lean revamp
 * (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.8 "Portal › Proposals: removed;
 * Portal › Quotations lists every quotation").
 *
 * Every proposal became a quotation in 14542, and the portal's Quotations
 * screen already lists them. Until PR 6 removes the Proposals screen, this
 * keeps it honest rather than showing the same offer twice:
 *
 *   list / pendingCount   nothing: the offers are under Quotations now, where
 *                         one answer counts
 *   get / pdf             a proposal id still opens (an old notification, a
 *                         bookmarked page): it reads the QUOTATION it became, in
 *                         the proposal page's shape
 *   sign / accept /       the QUOTATION's own portal flow (portal_quotation),
 *   decline               so a yes given here is the same yes, signed on the
 *                         quotation's hash, and wins the request through
 *                         `quotation.accepted` like every other
 *
 * The client comes from the GRANT, never from a parameter (portal.controller).
 */
"use strict";

const quotations = require("./portal_quotation.service");
const quotationRepo = require("../commercial/quotation/quotation.repo");
const quotationSections = require("../commercial/quotation/quotation.sections");
const presentation = require("../sales/proposal/proposal.presentation");
const { DIGITAL } = require("./portal_signing");
const { AppError } = require("../../utils/errors");

const langOf = (lang) => (String(lang || "").toLowerCase().startsWith("fr") ? "fr" : "en");

/** The quotation this client's proposal became, or the uniform 404. */
async function migrated(c, { clientId, proposalId }) {
  const { rows } = await c.query(
    "SELECT quotation_id FROM quotation WHERE source_proposal_id = $1 AND client_id = $2",
    [proposalId, clientId],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", "Proposal not found", 404);
  return rows[0].quotation_id;
}

/** A quotation status as the proposal page names it (it knew three). */
const proposalStatus = (s) => (s === "CONVERTED" ? "ACCEPTED" : s === "EXPIRED" ? "REJECTED" : s);

/** The offers are listed under Quotations now: one place, one answer. */
async function list() {
  return [];
}

async function pendingCount() {
  return 0;
}

async function get(c, { clientId, proposalId, lang = "en" }) {
  const quotationId = await migrated(c, { clientId, proposalId });
  const view = await quotations.get(c, { clientId, quotationId, lang });
  const [row, lines, sections] = await Promise.all([
    quotationRepo.get(c, quotationId),
    quotationRepo.listLines(c, quotationId),
    quotationSections.read(c, quotationId),
  ]);
  const { rows } = await c.query("SELECT COALESCE(legal_name, name) AS name FROM client_master WHERE client_id = $1", [clientId]);
  const q = view.quotation;
  return {
    proposal: {
      proposal_id: proposalId,
      quotation_id: quotationId,
      doc_number: q.doc_number,
      title: row.title || "",
      status: proposalStatus(q.status),
      currency: q.currency,
      total: q.totals ? q.totals.ttc : q.total,
      valid_until: q.valid_until,
    },
    presentation: presentation.fromQuotation({
      quotation: row, lines, sections, partyName: rows[0] ? rows[0].name : "", language: langOf(lang) === "fr" ? "FR" : "EN",
    }),
    signature: view.signature,
    signing: view.signing,
    decline_reasons: view.decline_reasons,
  };
}

async function pdf(c, { clientId, proposalId, lang = "en", origin = null, env = "live" }) {
  const quotationId = await migrated(c, { clientId, proposalId });
  return quotations.pdf(c, { clientId, quotationId, lang, origin, env });
}

async function startSigning(c, { clientId, proposalId, ...rest }) {
  return quotations.startSigning(c, { clientId, quotationId: await migrated(c, { clientId, proposalId }), ...rest });
}

async function resendCode(c, { clientId, proposalId, ...rest }) {
  return quotations.resendCode(c, { clientId, quotationId: await migrated(c, { clientId, proposalId }), ...rest });
}

async function completeSigning(c, { clientId, proposalId, ...rest }) {
  return quotations.completeSigning(c, { clientId, quotationId: await migrated(c, { clientId, proposalId }), ...rest });
}

async function accept(c, { clientId, proposalId, ...rest }) {
  return quotations.accept(c, { clientId, quotationId: await migrated(c, { clientId, proposalId }), ...rest });
}

async function decline(c, { clientId, proposalId, ...rest }) {
  return quotations.decline(c, { clientId, quotationId: await migrated(c, { clientId, proposalId }), ...rest });
}

/** Valid until, as the proposal page computed it (kept for its callers). */
function validUntil(row) {
  const days = Number(row.validity_days);
  if (!Number.isFinite(days) || days <= 0) return null;
  const from = new Date(row.sent_at || row.updated_at || row.created_at);
  if (Number.isNaN(from.getTime())) return null;
  return new Date(from.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

module.exports = {
  list, get, pdf, startSigning, resendCode, completeSigning, accept, decline, pendingCount, validUntil, DIGITAL, migrated,
};
