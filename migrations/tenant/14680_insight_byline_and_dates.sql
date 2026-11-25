-- ============================================================================
-- TENANT — 14680 Insights: a byline written on the article, an editable date,
-- and English or French (doc/smartls-website/ENGINEERING_GUIDE.md, PR 5).
--
-- ── DEPENDENCIES ─────────────────────────────────────────────────────────────
-- 12757  insight_article
-- 13784  insight_article.kind
--
-- ── WHY THE BYLINE IS TEXT AND NO LONGER ONLY A FOREIGN KEY ─────────────────
-- 12757 made the author an `app_user`, so the name came from the staff record.
-- That holds for a piece written this week by somebody with a login. It does
-- not hold for a library that runs from 2021: several authors have left, some
-- never had an account, and a role is DATED. A finance head who signed a piece
-- in 2023 signed it as Head of Finance and Strategy, and a join to today's HR
-- record would re-title a three-year-old article every time somebody is
-- promoted. So the byline is what was printed: a name and a role, written on
-- the article. `author_user_id` stays as the OPTIONAL link to a staff record,
-- and `byline_photo_vault_id` holds an optional photograph.
--
-- ── PLAIN COLUMNS ONLY (tests/unit/migration-constraint-ordering.test.js) ────
-- insight_article predates 13791, so this file adds no CHECK and no foreign
-- key to it: a constraint here breaks provisioning of a fresh tenant's sandbox.
-- What would have been constraints is enforced where it can name the field:
--   · "a headline in English or French" in `insight.validator` (create) and
--     `insight.service.update` (the row that results);
--   · `byline_photo_vault_id` is written only by `setBylinePhoto`, with a
--     document it has just created, and the public media read joins the vault
--     fail-closed, so a dangling id serves nothing.
--
-- ── WHY title_fr IS NO LONGER REQUIRED ──────────────────────────────────────
-- An English-only tenant had to type a French headline to create an article.
-- Dropping NOT NULL is not a constraint 13791 copies (it copies contype c and
-- f; NOT NULL lives in pg_attribute).
--
-- ── published_at ────────────────────────────────────────────────────────────
-- No column change: it already exists. What changes is that an editor may now
-- write it (past allowed, a future date schedules), and the public reads only
-- serve a row whose date has arrived.
-- ============================================================================

ALTER TABLE insight_article
  ADD COLUMN IF NOT EXISTS byline_name           text,
  ADD COLUMN IF NOT EXISTS byline_role           text,
  ADD COLUMN IF NOT EXISTS byline_photo_vault_id uuid;

ALTER TABLE insight_article ALTER COLUMN title_fr DROP NOT NULL;

COMMENT ON COLUMN insight_article.byline_name IS
  'The name printed on the article. Wins over the linked staff record, because a byline is what was signed, not who the person is today.';
COMMENT ON COLUMN insight_article.byline_role IS
  'The role printed beside the name, as held on the article''s date.';
COMMENT ON COLUMN insight_article.byline_photo_vault_id IS
  'Optional photograph of the byline: a document_vault id (no FK, see the header), scoped INSIGHT/LEADER, the vault''s existing role for a person''s portrait, and served only while the article is live.';
COMMENT ON COLUMN insight_article.title_fr IS
  'Optional since 14680. At least one of title_en and title_fr is required, enforced by the validator and the service.';
COMMENT ON COLUMN insight_article.published_at IS
  'The article''s date. Set by an editor (past allowed) or stamped on first publish. A future date schedules: public reads serve the row only once it has arrived.';

-- ============================================================================
-- VERIFY
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'insight_article'
--      AND column_name IN ('byline_name','byline_role','byline_photo_vault_id');  -- 3 rows
--   INSERT INTO insight_article (title_en) VALUES ('English only');               -- ok
--
-- DOWN
--   UPDATE insight_article SET title_fr = COALESCE(title_fr, title_en, '');
--   ALTER TABLE insight_article ALTER COLUMN title_fr SET NOT NULL;
--   ALTER TABLE insight_article DROP COLUMN IF EXISTS byline_photo_vault_id;
--   ALTER TABLE insight_article DROP COLUMN IF EXISTS byline_role;
--   ALTER TABLE insight_article DROP COLUMN IF EXISTS byline_name;
-- ============================================================================
