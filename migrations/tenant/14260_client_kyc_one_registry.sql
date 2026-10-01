-- ============================================================================
-- TENANT DB — 14260 One list of what a client is asked for, and an accepted
-- upload that lands on the Client 360 (tenant review of 29 Sep 2026, PR 1,
-- register items 1.1 and 1.2, owner decisions D1 and D2).
--
-- ── THE TWO REGISTRIES THAT NEVER MET ──────────────────────────────────────
--
-- The portal asked a client for `document_requirement` codes, named in
-- `dictionary_ref(kind = 'DOCUMENT_TYPE')`: RCCM, NIU, ID_SIGNATORY,
-- BANK_DETAILS (10747, 14150). Client ACTIVATION checks `party_document_type`:
-- BUSINESS_LICENSE, TAXPAYER_CARD, IDENTIFICATION, and the tenant's own
-- "Attestation de Conformité Fiscale" (0511, 13900, 14030). Nothing joined the
-- two, so:
--
--   · an RCCM a client sent and staff accepted never cleared "Missing Business
--     Licence / RCCM" — nothing wrote `client_document`, the only table the
--     360 and the compliance engine read;
--   · the portal never asked for the Attestation that blocks activation,
--     because no requirement code names it.
--
-- ── THE LINK ───────────────────────────────────────────────────────────────
--
-- A CLIENT-LEVEL request now carries the client document type it satisfies,
-- `client_request.party_document_type_id`. A tenant-created type is then
-- requestable as it is, with no twin row in the dictionary. File-level
-- (shipment) requests keep their dictionary codes — a bill of lading is not a
-- KYC document and has no `party_document_type`.
--
-- The column is PLAIN, not a foreign key: `client_request` already exists, and
-- a constraint added to a pre-existing table above 13791 aborts provisioning a
-- new tenant (tests/unit/migration-constraint-ordering.test.js). The service
-- refuses an id that is not an active CLIENT/BOTH type, which is the rule the
-- foreign key would have enforced.
--
-- `party_document_type.portal_doc_code` is the bridge for the requirement
-- rules and for every request written before this: the dictionary code a
-- portal request for that type has used. Seeded for the three system pairs,
-- and the existing client-level requests are back-filled through it, so an
-- RCCM request that is OPEN today resolves to BUSINESS_LICENSE tomorrow.
--
--   RCCM          → BUSINESS_LICENSE  (Business Licence / RCCM)
--   NIU           → TAXPAYER_CARD     (Taxpayer Card (NIU))
--   ID_SIGNATORY  → IDENTIFICATION    (Identification (ID / Passport))
--   BANK_DETAILS  → BANK_RIB          (Bank RIB) — so bank details a client
--                                       sends UNPROMPTED file under their type
--                                       when accepted. The portal never ASKS
--                                       for them (below); the pair is for
--                                       filing only.
--
-- `client_request.client_document_id` records the `client_document` row an
-- accepted upload was filed as, so the request, the vault file and the 360
-- record point at each other.
--
-- ── NEVER BANK DETAILS ─────────────────────────────────────────────────────
--
-- #471 (14030) took the Bank RIB out of ACTIVATION, but 10747's GLOBAL rule
-- still asked every client for BANK_DETAILS through the portal. A client's bank
-- details are not needed to onboard them — only for a refund or to match an
-- incoming transfer — so the portal stops asking: the rule is switched off, and
-- every OPEN request it generated is cancelled. Requests a client already
-- answered (SUBMITTED, ACCEPTED, REJECTED) are left alone: they are a record of
-- something that happened. The rule sync excludes bank details by code as
-- well (portal_client.repo NEVER_ASK), so a tenant that switches the rule back
-- on does not bring the question back. A client can still send bank details
-- unprompted.
--
-- ── ADDITIVE + IDEMPOTENT ──────────────────────────────────────────────────
--
-- Plain columns on existing tables, a partial unique index, and UPDATEs
-- guarded on the value they set: the migrator applies the set twice and
-- asserts a no-op.
-- ============================================================================

-- ── 1. The bridge: a client document type's portal code ───────────────────
ALTER TABLE party_document_type
  ADD COLUMN IF NOT EXISTS portal_doc_code text;

COMMENT ON COLUMN party_document_type.portal_doc_code IS
  'The dictionary_ref DOCUMENT_TYPE code a client-portal request for this type uses (RCCM for BUSINESS_LICENSE). NULL for a type the portal requests by its own id. One type per code.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_party_document_type_portal_code
  ON party_document_type (portal_doc_code) WHERE portal_doc_code IS NOT NULL;

UPDATE party_document_type SET portal_doc_code = 'RCCM'
 WHERE code = 'BUSINESS_LICENSE' AND portal_doc_code IS NULL
   AND NOT EXISTS (SELECT 1 FROM party_document_type t WHERE t.portal_doc_code = 'RCCM');
UPDATE party_document_type SET portal_doc_code = 'NIU'
 WHERE code = 'TAXPAYER_CARD' AND portal_doc_code IS NULL
   AND NOT EXISTS (SELECT 1 FROM party_document_type t WHERE t.portal_doc_code = 'NIU');
UPDATE party_document_type SET portal_doc_code = 'ID_SIGNATORY'
 WHERE code = 'IDENTIFICATION' AND portal_doc_code IS NULL
   AND NOT EXISTS (SELECT 1 FROM party_document_type t WHERE t.portal_doc_code = 'ID_SIGNATORY');
UPDATE party_document_type SET portal_doc_code = 'BANK_DETAILS'
 WHERE code = 'BANK_RIB' AND portal_doc_code IS NULL
   AND NOT EXISTS (SELECT 1 FROM party_document_type t WHERE t.portal_doc_code = 'BANK_DETAILS');

-- ── 2. The link on the request ────────────────────────────────────────────
ALTER TABLE client_request
  ADD COLUMN IF NOT EXISTS party_document_type_id uuid,
  ADD COLUMN IF NOT EXISTS client_document_id uuid;

COMMENT ON COLUMN client_request.party_document_type_id IS
  'The client document type (party_document_type) a CLIENT-LEVEL request satisfies; accepting it files a client_document of this type. NULL on shipment requests. Plain column (13791 rule) — the service checks it names an active CLIENT/BOTH type.';
COMMENT ON COLUMN client_request.client_document_id IS
  'The client_document row an accepted upload was filed as (14260). Plain column, written by the service in the accept transaction.';

-- Every client-level request written before this, resolved through the bridge.
UPDATE client_request r
   SET party_document_type_id = t.document_type_id
  FROM party_document_type t
 WHERE r.dossier_id IS NULL
   AND r.party_document_type_id IS NULL
   AND r.doc_type_code IS NOT NULL
   AND t.portal_doc_code = r.doc_type_code;

-- One materialised rule request per client and client document type — the
-- type-keyed twin of 14150's ux_client_request_rule, for a type that has no
-- dictionary code.
CREATE UNIQUE INDEX IF NOT EXISTS ux_client_request_rule_party_type
  ON client_request (client_id, party_document_type_id)
  WHERE source = 'RULE' AND dossier_id IS NULL AND party_document_type_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_client_request_party_type
  ON client_request (client_id, party_document_type_id)
  WHERE party_document_type_id IS NOT NULL;

-- ── 3. Never bank details ─────────────────────────────────────────────────
UPDATE document_requirement
   SET is_active = false
 WHERE scope_kind = 'GLOBAL' AND applies_to = 'CLIENT'
   AND doc_type_code = 'BANK_DETAILS' AND is_active;

UPDATE client_request
   SET status = 'CANCELLED'
 WHERE source = 'RULE' AND dossier_id IS NULL
   AND doc_type_code = 'BANK_DETAILS' AND status = 'OPEN';

-- DOWN
-- The cancelled BANK_DETAILS requests are not re-opened: the product rule is
-- that the portal never asks for them, and re-opening would put the question
-- back on every client's phone. Everything else reverses.
--
--   UPDATE document_requirement SET is_active = true
--    WHERE scope_kind = 'GLOBAL' AND applies_to = 'CLIENT' AND doc_type_code = 'BANK_DETAILS';
--   DROP INDEX IF EXISTS ix_client_request_party_type;
--   DROP INDEX IF EXISTS ux_client_request_rule_party_type;
--   ALTER TABLE client_request DROP COLUMN IF EXISTS client_document_id;
--   ALTER TABLE client_request DROP COLUMN IF EXISTS party_document_type_id;
--   DROP INDEX IF EXISTS ux_party_document_type_portal_code;
--   ALTER TABLE party_document_type DROP COLUMN IF EXISTS portal_doc_code;
