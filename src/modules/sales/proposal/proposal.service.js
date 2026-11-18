/**
 * Proposals (MOD-23), retired into quotations (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md
 * §4.6, §5.1; owner decision D6: one document, called Quotation).
 *
 * 14542 carried every proposal into the quotation it is: its lines, its
 * narratives as sections, its share link. From this release a proposal is
 * READ ONLY:
 *
 *   list, get     still answer, from the proposal tables (which PR 7 drops), so
 *                 the Proposals tab keeps showing what was there until PR 6
 *                 removes it; each row names the quotation it became
 *   every write   refused with 410 PROPOSAL_RETIRED, naming that quotation, so
 *                 nothing is written to a record that has a newer copy, and no
 *                 new proposal is made. A new offer is a quotation.
 *
 * The portal's Proposals screen and the public proposal link read the
 * migrated quotation (portal_proposal.service, proposal_public.service).
 */
"use strict";
const repo = require("./proposal.repo");
const { AppError } = require("../../../utils/errors");

/** The quotation 14542 made from a proposal (or the one it was already converted into). */
async function quotationOf(client, proposalId) {
  if (!proposalId) return null;
  const { rows } = await client.query("SELECT quotation_id FROM quotation WHERE source_proposal_id = $1 LIMIT 1", [proposalId]);
  return rows[0] ? rows[0].quotation_id : null;
}

/** The one refusal every proposal write gets. */
async function retired(client, id = null) {
  const quotationId = id ? await quotationOf(client, id) : null;
  throw new AppError(
    "PROPOSAL_RETIRED",
    "Proposals are now quotations. Open the quotation instead, or create a new quotation.",
    410,
    { quotation_id: quotationId, open: quotationId ? `/sales/quotations?focus=${quotationId}` : "/sales/quotations" },
  );
}

const createDraft = (client) => retired(client);
const updateDraft = (client, { id }) => retired(client, id);
const transition = (client, { id }) => retired(client, id);
const accept = (client, { id }) => retired(client, id);
const share = (client, { id }) => retired(client, id);
const revokeShare = (client, { id }) => retired(client, id);
const generate = (client, { proposalId }) => retired(client, proposalId);

async function get(client, id) {
  const p = await repo.get(client, id);
  if (!p) return null;
  const { share_token_hash: _hash, ...row } = p;
  row.lines = await repo.listLines(client, id);
  row.narratives = await repo.listNarratives(client, id);
  row.quotation_id = await quotationOf(client, id);
  row.retired = true;
  return row;
}

async function list(client, q) {
  const rows = await repo.list(client, q);
  if (!rows.length) return rows;
  const { rows: links } = await client.query(
    "SELECT source_proposal_id, quotation_id FROM quotation WHERE source_proposal_id = ANY($1::uuid[])",
    [rows.map((r) => r.proposal_id)],
  );
  const byProposal = new Map(links.map((l) => [l.source_proposal_id, l.quotation_id]));
  return rows.map(({ share_token_hash: _hash, ...r }) => ({ ...r, quotation_id: byProposal.get(r.proposal_id) || null, retired: true }));
}

module.exports = { createDraft, updateDraft, transition, accept, share, revokeShare, generate, get, list, quotationOf };
