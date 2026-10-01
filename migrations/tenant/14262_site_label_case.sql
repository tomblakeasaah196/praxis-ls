-- ============================================================================
-- TENANT DB — 14262 Label capitalisation on the public website and portal
-- (tenant review of 29 Sep 2026, PR 1, register item 1.11, owner decision D5).
--
-- The owner made Title Case the standard for every LABEL the website and the
-- client portal render — nav and footer links, buttons, headings, eyebrows,
-- card titles, tabs, field labels, pills — in English and French. It is
-- applied at render (public-web/src/lib/label-case.ts), so no copy is
-- rewritten and nothing here touches a string.
--
-- What a tenant can choose is whether the standard applies to THEIR site:
--   TITLE       "Title Case (standard)" — the default, for every tenant.
--   AS_WRITTEN  the words exactly as the dictionary and the copy editor hold
--               them.
--
-- It lives on `site_theme` because it is the same kind of decision as the
-- faces and the radius: how the tenant's front door reads, set once on
-- Website › Theme, served to strangers by `GET /public/site/theme`.
--
-- A plain column with a default, and no CHECK: one may not be added to a
-- pre-existing table above 13791 (it aborts provisioning a new tenant —
-- tests/unit/migration-constraint-ordering.test.js). The two values are
-- enforced where the column is written — `siteSettings.theme` in
-- packages/shared, which the API validates the PUT with — and the reader
-- treats anything but AS_WRITTEN as the standard.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; re-running changes nothing.
-- ============================================================================

ALTER TABLE site_theme ADD COLUMN IF NOT EXISTS label_case text NOT NULL DEFAULT 'TITLE';

COMMENT ON COLUMN site_theme.label_case IS
  'Label capitalisation on the public website and client portal: TITLE (Title Case, the standard — owner decision D5) or AS_WRITTEN. Enforced by siteSettings.theme in packages/shared.';

-- DOWN
-- ALTER TABLE site_theme DROP COLUMN IF EXISTS label_case;
