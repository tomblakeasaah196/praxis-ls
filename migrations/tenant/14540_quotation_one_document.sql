-- ============================================================================
-- TENANT DB — 14540 Sales lean revamp, PR 4: the quotation is the ONE priced
-- document (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.4, §4.6; owner decisions D6
-- and D7).
--
-- A proposal and a quotation were two documents with two prices for one offer
-- (gap 6). The quotation keeps its engine (VAT, débours, costing import,
-- target margin) and takes on what only the proposal had: the narrative, the
-- language, a share link, a view log. One switch prints it as a Full Proposal
-- or a Commercial Extract; the switch changes which sections print, never a
-- number.
--
-- ── quotation (existing table: PLAIN COLUMNS ONLY, the 13791 rule) ─────────
--
--   lead_id             the company row a PROSPECT quotation is for. A
--                       quotation names a client or a lead (or both, once the
--                       prospect becomes a client); the service refuses one
--                       with neither.
--   title               what the offer is called on its cover
--   language            EN | FR | BILINGUAL. NULL on a quotation from before
--                       this file: it prints in the tenant's default, as it did.
--   template_id         the quotation_template its section texts were copied
--                       from (copied, so editing a template never changes a
--                       quotation already made)
--   default_output      FULL | EXTRACT, the switch. FULL by default.
--   profile_version_id  the Company Profile version pinned at send: About Us
--                       prints what was published that day, for good.
--   share_token_hash    the public link (/q/<token>): sha256 of the token,
--   share_expires_at    which is shown once and never stored. Expires with
--   share_revoked_at    the offer (valid_until); revoked by a revision.
--   downloaded_at       first download of the PDF from the link
--   version             1, 2, 3: Revise copies a sent quotation into the next
--   supersedes_id       version, which names the one it replaces. Sending it
--   superseded_at       revokes the old link and expires the old offer.
--   sent_to             who Send mailed it to, the copies and the subject
--   sent_cc
--   sent_subject
--   sent_by             the user who sent it (notified of the first open)
--   source_proposal_id  the proposal 14542 migrated into this quotation, so an
--                       old proposal link or reference still finds it
--
--   sent_at, viewed_at and answered_at already exist (14380); they are now
--   stamped by every path (Send, the link, the portal, staff).
--
-- No CHECK and no FOREIGN KEY is added to quotation. The vocabularies are held
-- by commercial/quotation (quotation.rules LANGUAGES, OUTPUTS) and by
-- @praxis/shared quotation, the one place both sides read them.
--
-- ── three new tables (new, so they may carry their own constraints) ───────
--
--   quotation_section   one row per section of a quotation: on or off, its
--                       words in English and in French, and for Case Stories
--                       the stories picked.
--   quotation_template  the section library's defaults: which sections are on
--                       and the default text per language. Seeded with
--                       Standard in 14541.
--   quotation_view      every open of the shared link: when, a coarse browser
--                       label and a hashed visitor (never an address).
-- ============================================================================

-- ── 1. quotation ───────────────────────────────────────────────────────────

ALTER TABLE quotation ADD COLUMN IF NOT EXISTS lead_id uuid;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS language text;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS template_id uuid;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS default_output text NOT NULL DEFAULT 'FULL';
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS profile_version_id uuid;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS share_token_hash text;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS share_expires_at timestamptz;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS share_revoked_at timestamptz;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS downloaded_at timestamptz;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS supersedes_id uuid;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS sent_to text;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS sent_cc text[];
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS sent_subject text;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS sent_by uuid;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS source_proposal_id uuid;

COMMENT ON COLUMN quotation.lead_id IS
  'The company row a prospect quotation is for (14540). Plain uuid (13791 rule): the quotation service requires client_id or lead_id.';
COMMENT ON COLUMN quotation.language IS
  'EN | FR | BILINGUAL (14540), held by quotation.rules. NULL prints in the tenant default, as before.';
COMMENT ON COLUMN quotation.default_output IS
  'FULL (Full Proposal) | EXTRACT (Commercial Extract). Changes which sections print, never a number (14540).';
COMMENT ON COLUMN quotation.profile_version_id IS
  'The Company Profile version pinned at send; About Us prints it for good (14540).';
COMMENT ON COLUMN quotation.share_token_hash IS
  'sha256 of the public /q/<token> link. The token itself is never stored (14540).';
COMMENT ON COLUMN quotation.version IS
  'Revise copies a sent quotation into version + 1, which names it in supersedes_id; sending the new one revokes the old link (14540).';
COMMENT ON COLUMN quotation.source_proposal_id IS
  'The proposal 14542 migrated into this quotation, so old proposal links and references resolve to it.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_quotation_share_token_hash
  ON quotation (share_token_hash) WHERE share_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_quotation_lead
  ON quotation (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_quotation_supersedes
  ON quotation (supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_quotation_source_proposal
  ON quotation (source_proposal_id) WHERE source_proposal_id IS NOT NULL;
-- The nightly expiry reads SENT offers past their date.
CREATE INDEX IF NOT EXISTS ix_quotation_sent_valid_until
  ON quotation (valid_until) WHERE status = 'SENT';

-- ── 2. quotation_section ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quotation_section (
  quotation_section_id uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id         uuid        NOT NULL REFERENCES quotation(quotation_id) ON DELETE CASCADE,
  section_key          text        NOT NULL CHECK (section_key IN (
                                     'cover', 'about_us', 'needs', 'solution', 'scope',
                                     'pricing', 'terms', 'case_stories', 'next_steps')),
  enabled              boolean     NOT NULL DEFAULT true,
  body_en              text        CHECK (body_en IS NULL OR char_length(body_en) <= 20000),
  body_fr              text        CHECK (body_fr IS NULL OR char_length(body_fr) <= 20000),
  story_ids            uuid[]      NOT NULL DEFAULT '{}',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- Pricing is always on: a quotation that hides its prices is not one.
  CONSTRAINT ck_quotation_section_pricing_on CHECK (section_key <> 'pricing' OR enabled),
  CONSTRAINT ck_quotation_section_stories CHECK (cardinality(story_ids) <= 3),
  CONSTRAINT ux_quotation_section UNIQUE (quotation_id, section_key)
);

COMMENT ON TABLE quotation_section IS
  'The sections of a quotation (14540): the fixed library, fixed order, each on or off with its words per language. Pricing is always on; Cover and Next Steps are automatic.';

-- ── 3. quotation_template ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quotation_template (
  template_id      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  service_type_ids uuid[]      NOT NULL DEFAULT '{}',
  is_default       boolean     NOT NULL DEFAULT false,
  -- key → { enabled, body_en, body_fr }, for the library's keys only.
  sections         jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(sections) = 'object'),
  active           boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_quotation_template_default_active CHECK (NOT is_default OR active)
);

-- One default, ever.
CREATE UNIQUE INDEX IF NOT EXISTS ux_quotation_template_default
  ON quotation_template (is_default) WHERE is_default;
CREATE UNIQUE INDEX IF NOT EXISTS ux_quotation_template_name
  ON quotation_template (lower(name)) WHERE active;

COMMENT ON TABLE quotation_template IS
  'The leanest template builder (14540, §3.5): which sections are on by default and their default text in EN and FR. No ordering, no custom sections, no merge fields. Its text is COPIED into a quotation when the quotation is created.';

-- ── 4. quotation_view ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quotation_view (
  quotation_view_id uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id      uuid        NOT NULL REFERENCES quotation(quotation_id) ON DELETE CASCADE,
  opened_at         timestamptz NOT NULL DEFAULT now(),
  kind              text        NOT NULL DEFAULT 'VIEW' CHECK (kind IN ('VIEW', 'DOWNLOAD')),
  via               text        NOT NULL DEFAULT 'LINK' CHECK (via IN ('LINK', 'PORTAL')),
  agent_label       text        CHECK (agent_label IS NULL OR char_length(agent_label) <= 80),
  visitor_hash      text        CHECK (visitor_hash IS NULL OR char_length(visitor_hash) <= 128)
);

CREATE INDEX IF NOT EXISTS ix_quotation_view_quotation ON quotation_view (quotation_id, opened_at DESC);

COMMENT ON TABLE quotation_view IS
  'Every open of a quotation''s shared link or portal page (14540): when, a coarse browser label and a hashed visitor. No address is kept.';

-- ── 5. updated_at ──────────────────────────────────────────────────────────

CREATE OR REPLACE TRIGGER trg_quotation_section_updated BEFORE UPDATE ON quotation_section
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE OR REPLACE TRIGGER trg_quotation_template_updated BEFORE UPDATE ON quotation_template
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
-- DROP TRIGGER IF EXISTS trg_quotation_template_updated ON quotation_template;
-- DROP TRIGGER IF EXISTS trg_quotation_section_updated ON quotation_section;
-- DESTRUCTIVE: the view log, the templates and every quotation's sections go with their tables
-- DROP TABLE IF EXISTS quotation_view;
-- DROP TABLE IF EXISTS quotation_template;
-- DROP TABLE IF EXISTS quotation_section;
-- DROP INDEX IF EXISTS ix_quotation_sent_valid_until;
-- DROP INDEX IF EXISTS ux_quotation_source_proposal;
-- DROP INDEX IF EXISTS ix_quotation_supersedes;
-- DROP INDEX IF EXISTS ix_quotation_lead;
-- DROP INDEX IF EXISTS ux_quotation_share_token_hash;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS source_proposal_id;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS sent_by;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS sent_subject;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS sent_cc;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS sent_to;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS superseded_at;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS supersedes_id;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS version;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS downloaded_at;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS share_revoked_at;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS share_expires_at;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS share_token_hash;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS profile_version_id;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS default_output;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS template_id;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS language;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS title;
-- ALTER TABLE quotation DROP COLUMN IF EXISTS lead_id;
