-- ============================================================================
-- TENANT DB — 0662 The certificate behind a registration.
--
-- THE GAP. A registration row is an identifier: NIU M042116033580Q, RCCM
-- RC/DLA/2021/B/206, a VAT number, an EORI. Every one of them was ISSUED to us
-- on a piece of paper — the attestation d'immatriculation, the RCCM extract, the
-- VAT certificate — and there was nowhere to put that paper. The number sat in
-- the register with `verified`/`verified_by`/`verified_at` beside it and no way
-- for the person ticking that box to look at the evidence they were attesting
-- to, which makes the verification a matter of memory.
--
-- WHY A SCAN ON THE ROW, RATHER THAN A LINK TO A DOCUMENT RECORD. The obvious
-- alternative is to file the certificate in `entity_document` / the party KYC
-- register and point the registration at it. It was rejected because these
-- tables ALREADY carry their own evidence workflow: `verified`, `verified_by`,
-- `verified_at` have been on both since 0511/0515. Splitting one decision across
-- two rows — the attestation on a document, the verification of it on the
-- registration — means neither row is answerable on its own, and the two can
-- disagree the first time somebody replaces one of them.
--
-- The registration is the record that says "this identifier is ours and we have
-- checked it". The proof belongs to that record.
--
-- This is deliberately ADDITIVE and narrow: one nullable reference, no new
-- status column. A registration with no scan is still a valid registration
-- (the identifier is on the invoice whether or not we have filed the
-- certificate), so nothing here is NOT NULL and nothing backfills. If a link to
-- a full document record is wanted later, it can be added beside this without
-- unpicking it.
--
-- ROLLBACK: ALTER TABLE … DROP COLUMN vault_id, on both tables. No data is
-- migrated in, so dropping loses only what was uploaded after this ran.
-- ============================================================================

-- The entity's own identifiers (0515).
ALTER TABLE entity_registration
  ADD COLUMN IF NOT EXISTS vault_id uuid REFERENCES document_vault(doc_id);

-- The client's / supplier's identifiers (0511). One table, one column: the
-- CHECK constraint already guarantees exactly one party owns each row.
ALTER TABLE party_registration
  ADD COLUMN IF NOT EXISTS vault_id uuid REFERENCES document_vault(doc_id);

COMMENT ON COLUMN entity_registration.vault_id IS
  'Scan of the certificate this identifier was issued on (document_vault, MOD-64). Optional.';
COMMENT ON COLUMN party_registration.vault_id IS
  'Scan of the certificate this identifier was issued on (document_vault, MOD-64). Optional.';
