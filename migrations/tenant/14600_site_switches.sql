-- ============================================================================
-- TENANT DB — 14600 The website's switches (website v2, PR 1;
-- doc/smartls-website/ENGINEERING_GUIDE.md §4 PR 1, owner answer 9).
--
-- `public-web` is ONE build serving every tenant, so a section removed in code
-- is removed for everybody. The first tenant's review (24 Nov 2026) asked for
-- a top rail, the portfolio, the corridor and network scenes, the case notes
-- and the French version to go, and the owner's answer was "switches, default
-- off": nothing leaves the product, and each tenant turns on what it wants.
--
--   languages             what the site OFFERS. English always; French opt-in.
--                         Also decides which language a bilingual field
--                         REQUIRES (packages/shared/rules/site-languages.js).
--   top_rail              the thin strip above the header (track, language).
--   portfolio             the case-notes pages and their nav item.
--   corridors             the corridor and network scenes on the homepage.
--   case_notes            the case-notes band on the homepage.
--   careers_in_header     Careers in the header nav. The footer link stays.
--   visitor_theme_switch  the light/dark control a visitor can press.
--
-- EVERY OPTIONAL SWITCH IS FALSE AND THE LANGUAGE IS ENGLISH, FOR EVERY TENANT.
-- Nothing tenant-specific is written here: a tenant's own choices are made on
-- Settings › Website › Options after deploy, by a person.
--
-- `updated_by` carries no foreign key on purpose. Identity is pinned to the
-- LIVE schema and this row exists in Test too, so an FK would refuse a
-- perfectly valid user saving in Test (DATA 2.4).
-- ============================================================================

CREATE TABLE IF NOT EXISTS site_switches (
  singleton             boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  languages             text[]  NOT NULL DEFAULT ARRAY['en']::text[],
  top_rail              boolean NOT NULL DEFAULT false,
  portfolio             boolean NOT NULL DEFAULT false,
  corridors             boolean NOT NULL DEFAULT false,
  case_notes            boolean NOT NULL DEFAULT false,
  careers_in_header     boolean NOT NULL DEFAULT false,
  visitor_theme_switch  boolean NOT NULL DEFAULT false,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid,
  CONSTRAINT ck_site_switches_languages CHECK (
    'en' = ANY (languages) AND languages <@ ARRAY['en', 'fr']::text[]
  )
);

COMMENT ON TABLE site_switches IS
  'What the shared public-web build shows for this tenant. Every optional section off until a person turns it on in Settings › Website › Options.';
COMMENT ON COLUMN site_switches.languages IS
  'Languages the website offers. English always; French opt-in. English only means English is required on every bilingual website field and French is never served.';

INSERT INTO site_switches (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;

-- DOWN
-- DROP TABLE IF EXISTS site_switches;
