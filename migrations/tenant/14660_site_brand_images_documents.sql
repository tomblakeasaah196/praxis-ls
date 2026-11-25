-- ============================================================================
-- TENANT — 14660 Website brand: image slots, trust documents, the About page's
-- sections, membership numbers and the partner desk
-- (doc/smartls-website/ENGINEERING_GUIDE.md, PR 4).
--
-- ── DEPENDENCIES ─────────────────────────────────────────────────────────────
-- 13782  site_partner          13785  site_about
-- 13786  site_leader           13788  document_vault public media scope/role
-- 13789  provenance, and ck_vault_generated_is_atmosphere_only
--
-- ── site_image: ONE ROW PER PHOTOGRAPHIC SLOT ON THE PUBLIC SITE ────────────
-- The homepage steps, the About bands, the partners and trust bands are all
-- photographs that belong to no other row: there is no leader, partner or
-- entity they picture. Until now they were either absent or baked into the
-- build, which on a white-label site means every tenant shows the same
-- harbour. A slot is named by a stable key from the product's registry
-- (`siteBrand.SITE_IMAGE_SLOTS` in @praxis/shared); the row is created the
-- first time an editor uploads into it, so this migration seeds nothing and
-- names no tenant.
--
-- The image itself is a document_vault row with scope SITE and role
-- ATMOSPHERE, the role 13789 already reserves for scene-setting imagery. A
-- generated image is therefore allowed here and nowhere near a person or a
-- company's mark, by the constraint that already exists.
--
-- ── site_document: THE TRUST DOCUMENTS, WITH A DRAFT AND A PUBLISHED STATE ──
-- A policy is read by a procurement officer deciding whether to hand over
-- cargo. What they read must be what the company approved, not whatever an
-- editor typed this morning. So the editable columns are the DRAFT, and
-- `published` is a frozen copy taken by the Publish button. Editing a
-- published policy changes nothing on the site until it is published again.
-- `pdf_key` is the storage key of the designed PDF rendered from that copy;
-- it is cleared on every publish and re-rendered from the snapshot.
--
-- German columns exist because the Impressum's companion, the privacy policy,
-- is owed in German to a German reader. Policies use English and French.
--
-- ── PLAIN COLUMNS ON OLD TABLES (tests/unit/migration-constraint-ordering) ──
-- site_about, site_partner and site_leader predate 13791, so nothing here adds
-- a CHECK or a foreign key to them. The shapes are enforced by the shared
-- schema (`siteBrand`) at the API.
-- ============================================================================

CREATE TABLE IF NOT EXISTS site_image (
  slot_key    text PRIMARY KEY,
  image_id    uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  vault_id    uuid REFERENCES document_vault(doc_id),
  alt_en      text,
  alt_fr      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,
  CONSTRAINT ck_site_image_slot_key CHECK (slot_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

COMMENT ON TABLE site_image IS
  'One photograph per named slot on the public site (homepage steps, About bands, partners and trust bands). Keys come from siteBrand.SITE_IMAGE_SLOTS; rows are created on first upload.';
COMMENT ON COLUMN site_image.image_id IS
  'The owner id the shared website-media upload addresses, so this slot uses the same vault pipeline (sniffing, AVIF/WebP derivatives, archive on replace) as every other website image.';
COMMENT ON COLUMN site_image.updated_by IS
  'app_user id, without a foreign key: identity lives in the LIVE schema and this row may be written in the sandbox (check-actor-fk-guard).';

CREATE TABLE IF NOT EXISTS site_document (
  document_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_key        text NOT NULL UNIQUE,
  kind           text NOT NULL DEFAULT 'POLICY',
  sort_order     integer NOT NULL DEFAULT 0,
  title_en       text,
  title_fr       text,
  title_de       text,
  summary_en     text,
  summary_fr     text,
  summary_de     text,
  body_en        text,
  body_fr        text,
  body_de        text,
  version_label  text,
  effective_on   date,
  approved_by    text,
  published      jsonb,
  published_at   timestamptz,
  published_by   uuid,
  pdf_key        text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  CONSTRAINT ck_site_document_kind CHECK (kind IN ('POLICY', 'LEGAL')),
  CONSTRAINT ck_site_document_key CHECK (doc_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT ck_site_document_published_pair
    CHECK ((published IS NULL) = (published_at IS NULL))
);

CREATE INDEX IF NOT EXISTS ix_site_document_published
  ON site_document (kind, sort_order) WHERE published IS NOT NULL;

COMMENT ON TABLE site_document IS
  'Trust documents on the public site (Quality, HSE, ESG, Code of Conduct, Anti-Corruption, the privacy policy). The columns are the draft; `published` is the frozen copy the site serves.';
COMMENT ON COLUMN site_document.published IS
  'The copy taken by Publish: {title, summary, body, version_label, effective_on, approved_by} per language. The public site reads only this. NULL means never published or withdrawn.';
COMMENT ON COLUMN site_document.approved_by IS
  'The ROLE that approved the document ("Managing Director"), printed on the page and the PDF. A role, not a signature: the owner decided the documents carry no signatures.';
COMMENT ON COLUMN site_document.pdf_key IS
  'Storage key of the designed PDF rendered from `published`. Cleared on publish; written by the first render after it.';

ALTER TABLE site_about
  ADD COLUMN IF NOT EXISTS sections jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN site_about.sections IS
  'The About page''s editorial sections since 14660: hero eyebrow, credentials row, story, principles title, the leader''s message, office labels, sectors, standards, closing band and the search snippet. Shape: siteBrand.aboutSections.';

ALTER TABLE site_partner
  ADD COLUMN IF NOT EXISTS member_number text;

COMMENT ON COLUMN site_partner.member_number IS
  'For kind = network: the membership number printed beside the network''s name, so a forwarder can check it in the network''s own directory.';

ALTER TABLE site_leader
  ADD COLUMN IF NOT EXISTS email         text,
  ADD COLUMN IF NOT EXISTS phone         text,
  ADD COLUMN IF NOT EXISTS partner_desk  boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN site_leader.partner_desk IS
  'Shown as a named contact on the For Partners page, with the email and phone on this row. Off by default: a person is published as a contact only when somebody decides to.';

-- ============================================================================
-- VERIFY
--   SELECT to_regclass('site_image'), to_regclass('site_document');      -- both set
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'site_leader' AND column_name IN ('email','phone','partner_desk');  -- 3
--   INSERT INTO site_document (doc_key, kind) VALUES ('Bad Key', 'POLICY'); -- fails the key check
--
-- DOWN
--   ALTER TABLE site_leader DROP COLUMN IF EXISTS partner_desk;
--   ALTER TABLE site_leader DROP COLUMN IF EXISTS phone;
--   ALTER TABLE site_leader DROP COLUMN IF EXISTS email;
--   ALTER TABLE site_partner DROP COLUMN IF EXISTS member_number;
--   ALTER TABLE site_about DROP COLUMN IF EXISTS sections;
--   DROP TABLE IF EXISTS site_document;
--   DROP TABLE IF EXISTS site_image;
-- ============================================================================
