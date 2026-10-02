-- ============================================================================
-- TENANT DB — 14380 Quotations from a costing to the client's portal (tenant
-- review, meeting 6, PR 4 — items 4.1, 4.3, 4.4; owner decisions G1–G4).
--
-- ── quotation ──────────────────────────────────────────────────────────────
--
--   quote_request_id   the request this quotation answers (4.1, G3). Set when
--                      the quotation comes from a request — through the
--                      opportunity the request became, or picked by staff
--                      (quotation.service resolveQuoteRequest). The portal's
--                      request page shows its quotation; the quotation shows
--                      its request.
--   family_order       the order this document prints its client families in
--                      (G2): a JSON array of heading keys (a CLIENT_HEADING
--                      code, or "custom:<text>" for a family made up on this
--                      document). NULL = the registry's default order.
--   created_from       COSTING | SIMULATION | MANUAL — how the draft was born.
--                      COSTING is G1's one-click path, priced directly.
--   own_cost_total     the costing's own-cost lines, which are NOT billed and
--                      set the floor the services must cover (G1). Kept on the
--                      quotation so the pricer sees it on the draft without
--                      opening the workings.
--   sent_at            when it went to the client — the portal's "newest
--                      first" and its validity both read it.
--   viewed_at          the first time the client opened it in the portal.
--   answered_*         who at the client answered, how, and when (G4) — the
--                      portal identity, which is not an app_user and so cannot
--                      be an actor id.
--   decline_reason*    the reason a client gave for declining (G4: "Decline
--                      asks for a reason"), from the signature programme's
--                      DECLINE vocabulary, plus their own words.
--
-- ── margin_simulation ──────────────────────────────────────────────────────
--
--   origin                 NULL for a simulation a pricer built; COSTING_DIRECT
--                          for the workings G1 keeps behind a quotation priced
--                          straight from a costing ("the pricer is not walked
--                          through it").
--   target_margin_percent  the margin the services were priced at.
--
-- ── family_order on costing and invoice ────────────────────────────────────
--
-- The same per-document order (G2): set on the costing, it crosses to the
-- quotation; set on the quotation, it crosses to the invoice the quotation is
-- converted into — so the printed invoice reads in the order the client
-- accepted.
--
-- ── client_message.ref_entity ──────────────────────────────────────────────
--
-- "Ask about this quotation" (G3) opens the chat with the quotation
-- referenced: `quotation:<uuid>` on the message, shown as a chip on both sides
-- and a link in the Client inbox. Plain text, validated in portal_chat.service
-- (the client may reference only an offer of their own).
--
-- ── PLAIN COLUMNS ONLY (13791 rule) ────────────────────────────────────────
--
-- Every table here exists before this file, so no FK and no CHECK is added
-- (tests/unit/migration-constraint-ordering.test.js). The vocabularies are held
-- by the services that write them. Idempotent: ADD COLUMN IF NOT EXISTS and
-- CREATE INDEX IF NOT EXISTS throughout.
-- ============================================================================

ALTER TABLE quotation ADD COLUMN IF NOT EXISTS quote_request_id uuid;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS family_order jsonb;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS created_from text;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS own_cost_total numeric(18,2);
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS viewed_at timestamptz;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS answered_at timestamptz;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS answered_via text;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS answered_by_name text;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS answered_by_email text;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS decline_reason_code text;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS decline_reason text;

COMMENT ON COLUMN quotation.quote_request_id IS
  'The quote request this quotation answers (meeting 6, PR 4). Plain uuid (13791 rule); set through the opportunity the request became, or picked by staff.';
COMMENT ON COLUMN quotation.family_order IS
  'Per-document order of the client families (JSON array of heading keys). NULL = the CLIENT_HEADING registry''s default order.';
COMMENT ON COLUMN quotation.created_from IS
  'COSTING (priced directly from a costing, G1) | SIMULATION (quoted from an approved margin simulation) | MANUAL. NULL on rows older than 14380.';
COMMENT ON COLUMN quotation.own_cost_total IS
  'Own-cost lines of the costing this was priced from: not billed, the floor the services must cover (G1).';
COMMENT ON COLUMN quotation.answered_via IS
  'PORTAL (the client answered online) | STAFF (recorded by the team).';

-- The request page reads "the quotation that answered me"; the portal lists a
-- client's offers by status. Both are new reads.
CREATE INDEX IF NOT EXISTS ix_quotation_quote_request
  ON quotation (quote_request_id) WHERE quote_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_quotation_client_status
  ON quotation (client_id, status);

ALTER TABLE margin_simulation ADD COLUMN IF NOT EXISTS origin text;
ALTER TABLE margin_simulation ADD COLUMN IF NOT EXISTS target_margin_percent numeric(9,4);

COMMENT ON COLUMN margin_simulation.origin IS
  'NULL = built by a pricer in the simulator; COSTING_DIRECT = the workings kept behind a quotation priced straight from a costing (meeting 6, G1).';

ALTER TABLE costing ADD COLUMN IF NOT EXISTS family_order jsonb;
ALTER TABLE invoice ADD COLUMN IF NOT EXISTS family_order jsonb;

COMMENT ON COLUMN costing.family_order IS
  'Per-document order of the client families; crosses to the quotation priced from this costing (G2).';
COMMENT ON COLUMN invoice.family_order IS
  'Per-document order of the client families, carried from the accepted quotation (G2).';

ALTER TABLE client_message ADD COLUMN IF NOT EXISTS ref_entity text;

COMMENT ON COLUMN client_message.ref_entity IS
  'What the message is about, as <type>:<uuid> — "Ask about this quotation" (G3). Validated in portal_chat.service.';

-- The two events PR 4 adds, so the workflow and notification designers can
-- see them (the 9030 rule). `quotation.sent` / `quotation.accepted` exist.
INSERT INTO event_type (key, module_key, name, is_security_critical, is_approvable) VALUES
 ('quotation.created_from_costing',  'MOD-27', 'Quotation priced from a costing', false, false),
 ('quotation.declined_by_client',    'MOD-27', 'A client declined a quotation',   false, false)
ON CONFLICT (key) DO NOTHING;

-- DOWN
-- DELETE FROM event_type WHERE key IN ('quotation.created_from_costing', 'quotation.declined_by_client');
-- ALTER TABLE client_message    DROP COLUMN IF EXISTS ref_entity;
-- ALTER TABLE invoice           DROP COLUMN IF EXISTS family_order;
-- ALTER TABLE costing           DROP COLUMN IF EXISTS family_order;
-- ALTER TABLE margin_simulation DROP COLUMN IF EXISTS target_margin_percent;
-- ALTER TABLE margin_simulation DROP COLUMN IF EXISTS origin;
-- DROP INDEX IF EXISTS ix_quotation_client_status;
-- DROP INDEX IF EXISTS ix_quotation_quote_request;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS decline_reason;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS decline_reason_code;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS answered_by_email;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS answered_by_name;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS answered_via;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS answered_at;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS viewed_at;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS sent_at;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS own_cost_total;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS created_from;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS family_order;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS quote_request_id;
