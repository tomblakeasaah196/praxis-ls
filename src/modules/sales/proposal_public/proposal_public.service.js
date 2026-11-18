"use strict";
/**
 * Proposal links from before the lean revamp (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md
 * §3.8 "existing proposal tokens resolve to their migrated quotation").
 *
 * Proposals became quotations in 14542, which carried each proposal's token
 * hash onto its quotation. So a link a client was sent still opens: the token
 * is looked up on the QUOTATION, and the answer keeps the proposal page's
 * shape (a presentation) until PR 6 replaces that page with /q/<token>. The
 * PDF is the quotation's one render. A link to anything else is the uniform
 * 404, exactly as before.
 *
 * Opening it is recorded on the quotation, as an open of the quotation's own
 * link is (commercial/quotation_public).
 */
const quotationPublic = require("../../commercial/quotation_public/quotation_public.service");
const quotationRepo = require("../../commercial/quotation/quotation.repo");
const quotationSections = require("../../commercial/quotation/quotation.sections");
const quotationDocument = require("../../commercial/quotation/quotation.document");
const rules = require("../../commercial/quotation/quotation.rules");
const presentation = require("../proposal/proposal.presentation");

async function partyName(client, row) {
  const { rows } = await client.query(
    `SELECT COALESCE(cm.legal_name, cm.name, l.company_name) AS name
       FROM quotation q
       LEFT JOIN client_master cm ON cm.client_id = q.client_id
       LEFT JOIN lead l ON l.lead_id = q.lead_id
      WHERE q.quotation_id = $1`,
    [row.quotation_id],
  );
  return rows[0] ? rows[0].name : "";
}

async function get(client, token, requestedLanguage = null, who = {}) {
  const row = await quotationPublic.resolve(client, token);
  const language = rules.pickLanguage(row, requestedLanguage);
  const [lines, sections, name] = await Promise.all([
    quotationRepo.listLines(client, row.quotation_id),
    quotationSections.read(client, row.quotation_id),
    partyName(client, row),
  ]);
  const model = presentation.fromQuotation({ quotation: row, lines, sections, partyName: name, language });
  await quotationRepo.insertView(client, { quotationId: row.quotation_id, kind: "VIEW", via: "LINK", agentLabel: who.agentLabel || null, visitorHash: who.visitorHash || null });
  await quotationRepo.stampFirstView(client, row.quotation_id);
  return { presentation: model };
}

async function download(client, token, requestedLanguage = null) {
  const row = await quotationPublic.resolve(client, token);
  const out = await quotationDocument.pdf(client, { id: row.quotation_id, output: row.default_output, language: rules.pickLanguage(row, requestedLanguage) });
  await quotationRepo.stampFirstDownload(client, row.quotation_id);
  return { doc: { doc_number: row.doc_number }, buffer: out.buffer };
}

module.exports = { get, download };
