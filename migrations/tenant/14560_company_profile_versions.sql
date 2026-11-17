-- ============================================================================
-- TENANT DB — 14560 Company Profile, versioned, shareable, bilingual
-- (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.6 and §4.7, owner decision D9).
--
-- The profile stops being one row of declared facts typed as JSON and becomes
-- a document with versions.
--
--   company_profile_version     one row per version. One DRAFT at a time, at
--                               most one PUBLISHED; publishing supersedes the
--                               previous one. A published version is never
--                               edited: the trigger below refuses it, so no
--                               code path can, not only the service.
--   company_profile_section     the nine fixed sections of a version. FACTS
--                               ONCE, WORDS PER LANGUAGE: `structure` holds
--                               ids, order, switches and links; `text_en` and
--                               `text_fr` hold the words keyed by those ids, so
--                               English and French cannot disagree on a fact.
--   company_profile_logo        the client logo library. Retired, never
--                               deleted, so a published version that showed a
--                               logo keeps showing it.
--   company_profile_share       a per-recipient link. Only the token's hash is
--                               stored. `lead_id` is kept for every share
--                               raised from a lead; `version_id` pins a version
--                               or, when NULL, follows the published one.
--   company_profile_share_open  every open of a link: time, a coarse browser
--                               label and a hashed visitor, never an address.
--
-- The singleton `company_profile` keeps only its DERIVED columns (fleet,
-- warehouse, clients, lanes, computed_at), plus the four added here for the
-- Capacity & Network section. Its declared columns move into version 1 in
-- 14561 and are dropped in PR 7 with `company_profile_project`.
-- ============================================================================

CREATE TABLE IF NOT EXISTS company_profile_version (
  version_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number         integer NOT NULL UNIQUE CHECK (number > 0),
  status         text NOT NULL DEFAULT 'DRAFT'
                 CHECK (status IN ('DRAFT', 'PUBLISHED', 'SUPERSEDED')),
  change_note    text CHECK (change_note IS NULL OR char_length(change_note) <= 500),
  created_by     uuid REFERENCES app_user(user_id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  published_by   uuid REFERENCES app_user(user_id),
  published_at   timestamptz,
  superseded_at  timestamptz,
  CONSTRAINT ck_cpv_published_stamped
    CHECK (status = 'DRAFT' OR published_at IS NOT NULL)
);

-- One draft at a time, and at most one published version.
CREATE UNIQUE INDEX IF NOT EXISTS ux_cpv_one_draft
  ON company_profile_version ((true)) WHERE status = 'DRAFT';
CREATE UNIQUE INDEX IF NOT EXISTS ux_cpv_one_published
  ON company_profile_version ((true)) WHERE status = 'PUBLISHED';

CREATE TABLE IF NOT EXISTS company_profile_section (
  section_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id   uuid NOT NULL REFERENCES company_profile_version(version_id) ON DELETE CASCADE,
  section_key  text NOT NULL CHECK (section_key IN (
                 'cover', 'who_we_are', 'services', 'capacity', 'certifications',
                 'case_stories', 'clients', 'why_us', 'contact')),
  structure    jsonb NOT NULL DEFAULT '{}'::jsonb,
  text_en      jsonb NOT NULL DEFAULT '{}'::jsonb,
  text_fr      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by   uuid REFERENCES app_user(user_id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_cps_version_section UNIQUE (version_id, section_key),
  CONSTRAINT ck_cps_structure_object CHECK (jsonb_typeof(structure) = 'object'),
  CONSTRAINT ck_cps_text_en_object CHECK (jsonb_typeof(text_en) = 'object'),
  CONSTRAINT ck_cps_text_fr_object CHECK (jsonb_typeof(text_fr) = 'object')
);

CREATE TABLE IF NOT EXISTS company_profile_logo (
  logo_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  storage_key   text NOT NULL,
  content_type  text NOT NULL,
  -- The hash of the master the image pipeline STORED, never of the bytes it
  -- received (image-pipeline.service.js, "HASHING").
  content_hash  text NOT NULL,
  bytes         integer NOT NULL DEFAULT 0,
  retired_at    timestamptz,
  retired_by    uuid REFERENCES app_user(user_id),
  created_by    uuid REFERENCES app_user(user_id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_cpl_active ON company_profile_logo (name) WHERE retired_at IS NULL;

CREATE TABLE IF NOT EXISTS company_profile_share (
  share_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash       text NOT NULL UNIQUE,
  recipient_name   text CHECK (recipient_name IS NULL OR char_length(recipient_name) <= 160),
  recipient_email  citext,
  lead_id          uuid REFERENCES lead(lead_id) ON DELETE SET NULL,
  -- NULL follows whichever version is published when the link is opened.
  version_id       uuid REFERENCES company_profile_version(version_id),
  language         text NOT NULL DEFAULT 'EN' CHECK (language IN ('EN', 'FR')),
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz,
  revoked_by       uuid REFERENCES app_user(user_id),
  created_by       uuid REFERENCES app_user(user_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  first_opened_at  timestamptz,
  last_opened_at   timestamptz,
  open_count       integer NOT NULL DEFAULT 0,
  downloaded_at    timestamptz,
  CONSTRAINT ck_cpsh_someone
    CHECK (lead_id IS NOT NULL OR recipient_name IS NOT NULL OR recipient_email IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_cpsh_lead ON company_profile_share (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cpsh_created ON company_profile_share (created_at DESC);

CREATE TABLE IF NOT EXISTS company_profile_share_open (
  open_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id      uuid NOT NULL REFERENCES company_profile_share(share_id) ON DELETE CASCADE,
  kind          text NOT NULL DEFAULT 'VIEW' CHECK (kind IN ('VIEW', 'DOWNLOAD')),
  opened_at     timestamptz NOT NULL DEFAULT now(),
  agent_label   text,
  visitor_hash  text
);
CREATE INDEX IF NOT EXISTS ix_cpso_share ON company_profile_share_open (share_id, opened_at DESC);

-- Capacity & Network reads these. Computed by the nightly refresh from the
-- tenant's own records, so the profile states what the data says.
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS warehouse_count integer NOT NULL DEFAULT 0;
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS office_list jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS gateway_list jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS region_list jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ── A published version is never edited ────────────────────────────────────
--
-- The service refuses it first, with a message a person can act on. These
-- triggers are the floor under that: a version that has left DRAFT cannot gain,
-- change or lose a section, and a version moves only forward
-- (DRAFT -> PUBLISHED -> SUPERSEDED), keeping its publication stamp.

CREATE OR REPLACE FUNCTION company_profile_section_frozen() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status
    FROM company_profile_version
   WHERE version_id = COALESCE(OLD.version_id, NEW.version_id);
  IF v_status IS NOT NULL AND v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'company profile version is % and is never edited', v_status
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE TRIGGER trg_cps_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON company_profile_section
  FOR EACH ROW EXECUTE FUNCTION company_profile_section_frozen();

CREATE OR REPLACE FUNCTION company_profile_version_forward() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.status = 'PUBLISHED' AND NEW.status NOT IN ('PUBLISHED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'a published company profile version can only be superseded'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'SUPERSEDED' AND NEW.status <> 'SUPERSEDED' THEN
    RAISE EXCEPTION 'a superseded company profile version is history'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'DRAFT' AND (
       NEW.number IS DISTINCT FROM OLD.number
    OR NEW.change_note IS DISTINCT FROM OLD.change_note
    OR NEW.published_at IS DISTINCT FROM OLD.published_at
    OR NEW.published_by IS DISTINCT FROM OLD.published_by) THEN
    RAISE EXCEPTION 'a published company profile version is never edited'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE TRIGGER trg_cpv_forward
  BEFORE UPDATE ON company_profile_version
  FOR EACH ROW EXECUTE FUNCTION company_profile_version_forward();

-- The events this module raises, so the workflow and notification designers
-- can see them (the 9030 rule).
INSERT INTO event_type (key, module_key, name, is_security_critical, is_approvable) VALUES
  ('company_profile.published',     'MOD-26', 'Company profile published',          false, false),
  ('company_profile.shared',        'MOD-26', 'Company profile shared by link',     false, false),
  ('company_profile.share_opened',  'MOD-26', 'A shared company profile was opened', false, false),
  ('company_profile.share_revoked', 'MOD-26', 'A company profile link was revoked',  false, false)
ON CONFLICT (key) DO NOTHING;

-- DOWN
-- DELETE FROM event_type WHERE key IN ('company_profile.published', 'company_profile.shared',
--   'company_profile.share_opened', 'company_profile.share_revoked');
-- DROP TRIGGER IF EXISTS trg_cpv_forward ON company_profile_version;
-- DROP FUNCTION IF EXISTS company_profile_version_forward();
-- DROP TRIGGER IF EXISTS trg_cps_frozen ON company_profile_section;
-- DROP FUNCTION IF EXISTS company_profile_section_frozen();
-- ALTER TABLE company_profile DROP COLUMN IF EXISTS region_list;
-- ALTER TABLE company_profile DROP COLUMN IF EXISTS gateway_list;
-- ALTER TABLE company_profile DROP COLUMN IF EXISTS office_list;
-- ALTER TABLE company_profile DROP COLUMN IF EXISTS warehouse_count;
-- DROP TABLE IF EXISTS company_profile_share_open;
-- DROP TABLE IF EXISTS company_profile_share;
-- DROP TABLE IF EXISTS company_profile_logo;
-- DROP TABLE IF EXISTS company_profile_section;
-- DROP TABLE IF EXISTS company_profile_version;
