/**
 * Discarding a draft client (meeting 6, register 3.6) — the SQL.
 *
 * Two questions and one answer:
 *
 *   history(id)   what this client has done that a delete would erase. Any
 *                 count above zero refuses the discard ("Deactivate instead").
 *   children(id)  what is the client's OWN — the rows that exist only to
 *                 describe it — for the snapshot taken before they go.
 *   removeAll(id) the delete itself, inside the caller's transaction.
 *
 * WHAT COUNTS AS HISTORY. The register names operations files, invoices,
 * receipts, journal lines, quote requests, proposals, quotations and portal
 * activity. Every other business record that points at a client is counted
 * too (advances, CRM, warehouse, signatures, change requests, documents filed
 * against it elsewhere, a client merged into it): a delete that had to guess
 * whether a record mattered would be guessing with the audit trail. A table
 * whose FK is ON DELETE CASCADE and which holds activity (portal messages,
 * requests, payment proofs) is counted here precisely BECAUSE the delete would
 * otherwise take it silently.
 *
 * A journal line carries no client id: a client's lines are the lines on its
 * auxiliary (411…) or advance account, which a DRAFT normally does not have.
 */
"use strict";

/** Plain-language names for the refusal, keyed as `history` returns them. */
const HISTORY_LABELS = {
  operations_files: "operations files",
  invoices: "invoices",
  receipts: "receipts",
  advances: "advances",
  journal_lines: "journal lines",
  quote_requests: "quote requests",
  proposals: "proposals",
  quotations: "quotations",
  portal_activity: "portal activity",
  crm: "leads, opportunities or meetings",
  warehouse: "warehouse stock or orders",
  signatures: "signatures",
  change_requests: "change requests",
  other_documents: "documents filed against it",
  related_parties: "linked suppliers, merged clients or people",
  published: "success stories, message groups or published invoices",
};

async function history(c, clientId) {
  const { rows } = await c.query(
    `WITH cm AS (
       SELECT client_id, coa_aux_account, coa_advance_account FROM client_master WHERE client_id = $1
     ),
     granted AS (
       SELECT lower(subject_email) AS email FROM portal_access WHERE client_id = $1
     ),
     own_docs AS (
       SELECT vault_id FROM client_document WHERE client_id = $1 AND vault_id IS NOT NULL
       UNION
       SELECT vault_id FROM client_beneficial_owner WHERE client_id = $1 AND vault_id IS NOT NULL
     )
     SELECT
       (SELECT count(*) FROM dossier WHERE client_id = $1)::int AS operations_files,
       (SELECT count(*) FROM invoice WHERE client_id = $1)::int AS invoices,
       (SELECT count(*) FROM payment_receipt WHERE client_id = $1)::int AS receipts,
       (SELECT count(*) FROM advance WHERE client_id = $1)::int AS advances,
       (SELECT count(*) FROM journal_line jl, cm
         WHERE jl.account_code IN (cm.coa_aux_account, cm.coa_advance_account))::int AS journal_lines,
       (SELECT count(*) FROM quote_request WHERE client_id = $1)::int AS quote_requests,
       (SELECT count(*) FROM proposal WHERE client_id = $1 OR converted_client_id = $1)::int AS proposals,
       (SELECT count(*) FROM quotation WHERE client_id = $1)::int AS quotations,
       ((SELECT count(*) FROM client_message WHERE client_id = $1)
        + (SELECT count(*) FROM client_request WHERE client_id = $1)
        + (SELECT count(*) FROM payment_proof WHERE client_id = $1)
        + (SELECT count(*) FROM portal_notify_sent WHERE client_id = $1)
        + (SELECT count(*) FROM portal_session ps
             JOIN portal_user pu ON pu.portal_user_id = ps.portal_user_id
            WHERE lower(pu.email) IN (SELECT email FROM granted)))::int AS portal_activity,
       ((SELECT count(*) FROM lead WHERE client_id = $1)
        + (SELECT count(*) FROM opportunity WHERE client_id = $1)
        + (SELECT count(*) FROM meeting WHERE client_id = $1))::int AS crm,
       ((SELECT count(*) FROM outbound_order WHERE client_id = $1)
        + (SELECT count(*) FROM inventory_item WHERE owner_client_id = $1))::int AS warehouse,
       ((SELECT count(*) FROM signature_party WHERE party_id = $1)
        + (SELECT count(*) FROM qes_envelope WHERE party_id = $1)
        + (SELECT count(*) FROM signature_otp WHERE party_id = $1)
        + (SELECT count(*) FROM signature_print_job WHERE party_id = $1))::int AS signatures,
       (SELECT count(*) FROM party_change_request
         WHERE lower(party_kind) = 'client' AND party_id = $1)::int AS change_requests,
       (SELECT count(*) FROM document_vault
         WHERE client_id = $1 AND doc_id NOT IN (SELECT vault_id FROM own_docs))::int AS other_documents,
       ((SELECT count(*) FROM supplier_master WHERE linked_client_id = $1)
        + (SELECT count(*) FROM client_master WHERE merged_into_id = $1)
        + (SELECT count(*) FROM entity_person WHERE client_id = $1))::int AS related_parties,
       ((SELECT count(*) FROM success_story WHERE client_id = $1)
        + (SELECT count(*) FROM comms_group WHERE client_id = $1)
        + (SELECT count(*) FROM invoice_client_bundle WHERE client_id = $1))::int AS published`,
    [clientId],
  );
  return rows[0];
}

/**
 * The client's own rows, for the snapshot. Portal invites are the unused ones
 * of people whose ONLY grant is this client — an invite to a portal that will
 * grant nothing; a person who also sees another client keeps theirs.
 */
async function children(c, clientId) {
  const q = async (sql) => (await c.query(sql, [clientId])).rows;
  return {
    contacts: await q("SELECT * FROM client_contact WHERE client_id = $1"),
    addresses: await q("SELECT * FROM client_address WHERE client_id = $1"),
    bank_accounts: await q("SELECT * FROM client_bank_account WHERE client_id = $1"),
    beneficial_owners: await q("SELECT * FROM client_beneficial_owner WHERE client_id = $1"),
    registrations: await q("SELECT * FROM party_registration WHERE client_id = $1"),
    documents: await q("SELECT * FROM client_document WHERE client_id = $1"),
    vault_documents: await q(
      "SELECT doc_id, doc_type, storage_path, content_hash, status, entity_ref, original_name FROM document_vault WHERE client_id = $1",
    ),
    onboarding_steps: await q("SELECT * FROM client_onboarding_step WHERE client_id = $1"),
    portal_grants: await q("SELECT * FROM portal_access WHERE client_id = $1"),
    portal_invites: await q(
      `SELECT pi.invite_id, pi.portal_user_id, pi.purpose, pi.expires_at, pi.created_at
         FROM portal_invite pi
         JOIN portal_user pu ON pu.portal_user_id = pi.portal_user_id
        WHERE pi.used_at IS NULL
          AND lower(pu.email) IN (SELECT lower(subject_email) FROM portal_access WHERE client_id = $1)
          AND NOT EXISTS (
            SELECT 1 FROM portal_access other
             WHERE lower(other.subject_email) = lower(pu.email) AND other.client_id <> $1
          )`,
    ),
    portal_notify_settings: await q("SELECT * FROM portal_notify_setting WHERE client_id = $1"),
    aliases: await q("SELECT * FROM party_alias WHERE lower(party_kind) = 'client' AND party_id = $1"),
    verified_domains: await q("SELECT * FROM party_verified_domain WHERE lower(party_kind) = 'client' AND party_id = $1"),
  };
}

/**
 * The delete. Children with ON DELETE CASCADE (contacts, addresses, banks,
 * beneficial owners, registrations, documents, onboarding steps, notification
 * settings and queue, read cursors) go with the client row; the rest are
 * removed first by hand.
 *
 * Vault files are ARCHIVED and detached, not deleted: the vault has no delete
 * path by design — it is the archive (attachment_outbox archives an orphan the
 * same way). The row keeps its `entity_ref`, so the file stays traceable to the
 * snapshot in the audit trail.
 */
async function removeAll(c, clientId, inviteIds) {
  if (inviteIds.length) await c.query("DELETE FROM portal_invite WHERE invite_id = ANY($1::uuid[])", [inviteIds]);
  await c.query("DELETE FROM portal_access WHERE client_id = $1", [clientId]);
  await c.query("DELETE FROM party_alias WHERE lower(party_kind) = 'client' AND party_id = $1", [clientId]);
  await c.query("DELETE FROM party_verified_domain WHERE lower(party_kind) = 'client' AND party_id = $1", [clientId]);
  await c.query(
    "UPDATE document_vault SET status = 'ARCHIVED', client_id = NULL, entity_ref = COALESCE(entity_ref, 'client:' || $1::text) WHERE client_id = $1",
    [clientId],
  );
  const { rowCount } = await c.query("DELETE FROM client_master WHERE client_id = $1 AND registration_status = 'DRAFT'", [clientId]);
  return rowCount;
}

module.exports = { HISTORY_LABELS, history, children, removeAll };
