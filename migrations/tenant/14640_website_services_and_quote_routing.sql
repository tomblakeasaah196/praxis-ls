-- ============================================================================
-- TENANT — 14640 Website services over ERP service types, and the routing
-- rules the quote engine reads (SmartLS website v2, PR 3).
--
-- ── WHY ────────────────────────────────────────────────────────────────────
-- The ERP keeps import, export and end to end as separate service types
-- (Sea Freight Import, Sea Freight Export, End-to-End Sea Freight): the file,
-- its milestones, its charges, its numbering and its quotation all hang off
-- that choice, and their keys are referenced from a dozen tables. A visitor
-- does not think in those types. The website therefore offers WEBSITE
-- SERVICES ("Sea Freight"), each standing over one or more ERP types, and the
-- quote engine (`@praxis/shared` rules/quote-engine.js) picks the exact one
-- from what the visitor answers. The ERP types and their keys are untouched.
--
-- ── A WEBSITE SERVICE IS A PUBLISHED PROFILE, PLUS ITS MEMBERS ─────────────
-- `service_type_web_profile` already holds everything a website service is:
-- slug, copy, cover, accent, closing line (`claim_*`), family (`group_id`)
-- and order. What it lacked:
--
--   web_name_en / web_name_fr  the name the website shows ("Sea Freight"),
--                              where the ERP name is "Sea Freight Import".
--                              Blank means "use the service type's name".
--   is_featured                drawn on the homepage band.
--   service_type_web_member    the OTHER ERP types this website service
--                              quotes for. The profile's own type is always a
--                              member; a type belongs to one website service
--                              at most, so a request routes one way only.
--
-- ── ROUTING RULES ARE DATA ─────────────────────────────────────────────────
-- `quote_route_rule` maps (direction, span of the work) to the flow a member
-- must have (END_TO_END, IMPORT, EXPORT), to one named member (TYPE), or to
-- the desk. A row with no website_service_id is the generic rule; a row with
-- one overrides that cell for that service only. The twelve generic rows are
-- inserted below and are the engine's DEFAULT_RULES, term for term
-- (tests/unit/quote-engine.test.js reads this file to hold them together).
-- They name no service type and no tenant data, so they are the same for
-- every tenant; a tenant changes them in Master Data.
--
-- ── WHAT A QUOTE REQUEST NOW RECORDS ───────────────────────────────────────
-- So the desk sees WHY a request landed on its type: the website service it
-- came through, the trade direction, how the Incoterm was reached (picked,
-- derived from plain answers, not sure, not applicable), the scope of work
-- and the engine's full answer (outcome, reason, span, the sentence the
-- visitor was shown, the answers). Plain columns only: quote_request and
-- service_type_web_profile are older than 13791, so neither may gain a
-- CHECK or FK here (tests/unit/migration-constraint-ordering.test.js). The
-- vocabularies are held by the shared schema and the engine.
-- ============================================================================

ALTER TABLE service_type_web_profile
  ADD COLUMN IF NOT EXISTS web_name_en text;
ALTER TABLE service_type_web_profile
  ADD COLUMN IF NOT EXISTS web_name_fr text;
ALTER TABLE service_type_web_profile
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN service_type_web_profile.web_name_en IS
  'The website''s name for this service (14640). Blank: the service type''s own name.';
COMMENT ON COLUMN service_type_web_profile.is_featured IS
  'Drawn on the homepage services band (14640).';

CREATE TABLE IF NOT EXISTS service_type_web_member (
  -- The website service: the profile that is published.
  service_type_id         uuid NOT NULL REFERENCES service_type_web_profile(service_type_id) ON DELETE CASCADE,
  -- Another ERP type it quotes for.
  member_service_type_id  uuid NOT NULL REFERENCES service_type(service_type_id) ON DELETE CASCADE,
  sort_order              integer NOT NULL DEFAULT 100,
  created_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service_type_id, member_service_type_id),
  CONSTRAINT ck_stwm_not_self CHECK (service_type_id <> member_service_type_id)
);

-- One website service per ERP type, so a request can only route one way.
CREATE UNIQUE INDEX IF NOT EXISTS ux_stwm_member
  ON service_type_web_member(member_service_type_id);

CREATE TABLE IF NOT EXISTS quote_route_rule (
  rule_id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL: the generic rule. Set: this website service's own rule for the cell.
  website_service_id      uuid REFERENCES service_type_web_profile(service_type_id) ON DELETE CASCADE,
  direction               text NOT NULL,
  span                    text NOT NULL,
  outcome                 text NOT NULL,
  -- Only for outcome TYPE: the member named outright.
  service_type_id         uuid REFERENCES service_type(service_type_id) ON DELETE CASCADE,
  note                    text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid,
  CONSTRAINT ck_qrr_direction CHECK (direction IN ('IMPORT', 'EXPORT')),
  CONSTRAINT ck_qrr_span CHECK (span IN ('O', 'M', 'D', 'OM', 'MD', 'OMD')),
  CONSTRAINT ck_qrr_outcome CHECK (outcome IN ('END_TO_END', 'IMPORT', 'EXPORT', 'DESK', 'TYPE')),
  CONSTRAINT ck_qrr_type CHECK ((outcome = 'TYPE') = (service_type_id IS NOT NULL)),
  CONSTRAINT ck_qrr_type_scoped CHECK (outcome <> 'TYPE' OR website_service_id IS NOT NULL),
  CONSTRAINT ck_qrr_flow_direction CHECK (
    NOT (outcome = 'IMPORT' AND direction = 'EXPORT') AND NOT (outcome = 'EXPORT' AND direction = 'IMPORT')
  )
);

-- One rule per cell: generic, or per website service.
CREATE UNIQUE INDEX IF NOT EXISTS ux_qrr_generic_cell
  ON quote_route_rule(direction, span) WHERE website_service_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_qrr_service_cell
  ON quote_route_rule(website_service_id, direction, span) WHERE website_service_id IS NOT NULL;

CREATE OR REPLACE TRIGGER trg_qrr_updated
  BEFORE UPDATE ON quote_route_rule
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The generic rules (= quote-engine.js DEFAULT_RULES). Idempotent by the
-- partial unique index: a cell a tenant already changed is left as they set it.
INSERT INTO quote_route_rule (website_service_id, direction, span, outcome)
VALUES
  (NULL, 'IMPORT', 'O',   'DESK'),
  (NULL, 'IMPORT', 'M',   'IMPORT'),
  (NULL, 'IMPORT', 'D',   'IMPORT'),
  (NULL, 'IMPORT', 'OM',  'IMPORT'),
  (NULL, 'IMPORT', 'MD',  'IMPORT'),
  (NULL, 'IMPORT', 'OMD', 'END_TO_END'),
  (NULL, 'EXPORT', 'O',   'EXPORT'),
  (NULL, 'EXPORT', 'M',   'EXPORT'),
  (NULL, 'EXPORT', 'D',   'DESK'),
  (NULL, 'EXPORT', 'OM',  'EXPORT'),
  (NULL, 'EXPORT', 'MD',  'EXPORT'),
  (NULL, 'EXPORT', 'OMD', 'END_TO_END')
ON CONFLICT (direction, span) WHERE website_service_id IS NULL DO NOTHING;

ALTER TABLE quote_request
  ADD COLUMN IF NOT EXISTS website_service_id uuid;
ALTER TABLE quote_request
  ADD COLUMN IF NOT EXISTS trade_direction text;
ALTER TABLE quote_request
  ADD COLUMN IF NOT EXISTS incoterm_source text;
ALTER TABLE quote_request
  ADD COLUMN IF NOT EXISTS service_scope jsonb;
ALTER TABLE quote_request
  ADD COLUMN IF NOT EXISTS quote_routing jsonb;

COMMENT ON COLUMN quote_request.website_service_id IS
  'The website service the request came through (14640): a published service_type_web_profile. No FK (older table); the intake resolves it.';
COMMENT ON COLUMN quote_request.trade_direction IS
  'IMPORT | EXPORT, as the visitor answered (14640). Held by @praxis/shared quote-engine DIRECTIONS.';
COMMENT ON COLUMN quote_request.incoterm_source IS
  'How the Incoterm was reached (14640): PICKED | DERIVED | NOT_SURE | NOT_APPLICABLE.';
COMMENT ON COLUMN quote_request.service_scope IS
  'The work, as six booleans (14640): origin_pickup, export_clearance, main_carriage, import_clearance, duties_taxes, final_delivery.';
COMMENT ON COLUMN quote_request.quote_routing IS
  'The quote engine''s answer (14640): outcome RESOLVED | DESK, reason, span, explanation {en, fr}, party, answers.';

-- ============================================================================
-- VERIFY
--   SELECT direction, span, outcome FROM quote_route_rule
--    WHERE website_service_id IS NULL ORDER BY direction, span;   -- 12 rows
--   \d service_type_web_member
--
-- DOWN
--   ALTER TABLE quote_request DROP COLUMN IF EXISTS quote_routing,
--     DROP COLUMN IF EXISTS service_scope, DROP COLUMN IF EXISTS incoterm_source,
--     DROP COLUMN IF EXISTS trade_direction, DROP COLUMN IF EXISTS website_service_id;
--   DROP TRIGGER IF EXISTS trg_qrr_updated ON quote_route_rule;
--   DROP TABLE IF EXISTS quote_route_rule;
--   DROP TABLE IF EXISTS service_type_web_member;
--   ALTER TABLE service_type_web_profile DROP COLUMN IF EXISTS is_featured,
--     DROP COLUMN IF EXISTS web_name_fr, DROP COLUMN IF EXISTS web_name_en;
-- ============================================================================
