-- ============================================================================
-- TENANT — 14700 The AI profile: what AI assistants read about the company.
--
-- ── WHY A RECORD AND NOT THE ABOUT PAGE ────────────────────────────────────
-- ChatGPT, Claude, Gemini and Perplexity describe a company from what their
-- crawlers can read, and those crawlers run no JavaScript. The website now
-- prints each page's text into the HTML they receive, but a page is written
-- for a visitor: its facts are spread over six screens, half of them in
-- photographs and cards. This record is the same facts written ONCE, plainly,
-- for a machine that will repeat them: who the company is, the names people
-- search it by, where it is, what it does and, as much, what it does not.
--
-- It is served at /llms.txt and /llms-full.txt (llmstxt.org) and feeds the
-- Organization structured data on every page. An empty profile publishes
-- nothing: /llms.txt answers 404 rather than a file of invented text.
--
-- ── ONE ROW, SEEDED ─────────────────────────────────────────────────────────
-- The same singleton shape as `site_careers` (13792), and seeded for the same
-- reason: the save is an UPDATE ... WHERE singleton = true, and with no row to
-- match it would report success and write nothing.
--
-- ── ENGLISH ONLY ────────────────────────────────────────────────────────────
-- One language, on purpose. The readers are language models, which translate
-- for their own users; two copies of every fact is two chances to disagree.
-- ============================================================================

CREATE TABLE IF NOT EXISTS site_ai_profile (
  site_ai_profile_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton          boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton),

  -- One paragraph: who the company is and what it does. The `> ` line of
  -- /llms.txt and the Organization `description`. Empty means no profile.
  summary            text,
  -- The names people search the company by that the website does not print:
  -- a former name, an abbreviation. Organization `alternateName`.
  alternate_names    text[] NOT NULL DEFAULT '{}',
  founded            text,
  offices            text,
  services_summary   text,
  -- Organization `knowsAbout`.
  sectors            text[] NOT NULL DEFAULT '{}',
  -- Organization `areaServed`.
  areas_served       text[] NOT NULL DEFAULT '{}',
  credentials        text,
  leadership         text,
  -- What the company does NOT do, so an assistant stops offering it.
  not_offered        text,
  contact            text,
  -- When somebody last read the whole profile and confirmed it is true.
  reviewed_on        date,

  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES app_user(user_id)
);

COMMENT ON TABLE site_ai_profile IS
  'What AI assistants read about the company: served at /llms.txt and /llms-full.txt and folded into the Organization structured data. One row. An empty summary publishes nothing.';

INSERT INTO site_ai_profile (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;

-- ============================================================================
-- VERIFY
--   SELECT count(*) FROM site_ai_profile;   -- 1
--
-- DOWN
--   DROP TABLE IF EXISTS site_ai_profile;
-- ============================================================================
