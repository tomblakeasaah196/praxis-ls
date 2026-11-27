-- ============================================================================
-- TENANT — 14720 A vacancy can carry a photograph for the careers page.
--
-- ── DEPENDENCIES ─────────────────────────────────────────────────────────────
-- 0360   vacancy
-- 13788  document_vault public media scope/role (SITE, ATMOSPHERE)
-- 14661  media_attachment's owner list lives in code (OWNER_TABLES)
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- Every role on the careers page was the same plain row with a department
-- glyph, so a page of five roles read as one list item repeated. The owner
-- asked (27 Nov 2026) for each role to be able to carry a photograph: drawn
-- behind the role's title on the list card, as the header band of the role's
-- own page, and as the photograph on its share card. A role with no
-- photograph renders exactly as it did before.
--
-- ── THE PICTURE IS A WEBSITE IMAGE, NOT A NEW KIND OF FILE ──────────────────
-- It goes through the one website-media pipeline (site_settings.media.js,
-- slot `vacancy-cover`): sniffed type, size cap, AVIF and WebP derivatives,
-- the replaced picture archived, the attempt booked in the outbox. Its vault
-- row is scope SITE, role ATMOSPHERE: a scene behind a headline, never a
-- named person or another company's mark.
--
-- ── SERVABLE ONLY WHILE THE ROLE IS ON THE CAREERS PAGE ─────────────────────
-- The public media route joins this column and re-asserts the same predicate
-- the careers list uses (OPEN, published, not past its closing date). So the
-- photograph of a closed, paused or unpublished role stops being a public URL
-- the moment the role leaves the page, without anything having to archive it.
--
-- ── A PLAIN COLUMN (tests/unit/migration-constraint-ordering) ───────────────
-- `vacancy` predates 13791, so nothing here adds a foreign key or a CHECK to
-- it. The pointer is written only by the media pipeline, inside the same
-- transaction that scopes the vault row public.
-- ============================================================================

ALTER TABLE vacancy ADD COLUMN IF NOT EXISTS cover_vault_id uuid;

COMMENT ON COLUMN vacancy.cover_vault_id IS
  'The careers-page photograph: a document_vault row scoped SITE / ATMOSPHERE, written only by the website-media pipeline (slot vacancy-cover). Servable only while the role is OPEN, published and not past closes_on. No FK: vacancy predates 13791.';

-- ============================================================================
-- VERIFY
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'vacancy' AND column_name = 'cover_vault_id';   -- 1 row
--
-- DOWN
--   -- The photographs stay in the vault; only the pointer goes. Archive them
--   -- first if they should stop existing as well.
--   ALTER TABLE vacancy DROP COLUMN IF EXISTS cover_vault_id;
-- ============================================================================
