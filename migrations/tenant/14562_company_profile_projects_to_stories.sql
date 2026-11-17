-- ============================================================================
-- TENANT DB — 14562 Company Profile: past projects become draft Success Stories
-- (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.7 and §4.7).
--
-- Success Stories is now the one source of case stories, for the Company
-- Profile, the Full Proposal and the website Portfolio. The profile's own
-- `company_profile_project` rows were a second, unpublishable copy of the same
-- idea, so each becomes a DRAFT story:
--
--   name_en          -> title
--   description_en   -> executive_summary (and summary)
--   name_fr,         -> operations_execution (and body): a story is written in
--   description_fr      one language, so the French text is kept there for the
--                       team to rework rather than dropped
--   metrics          -> kpis, at most four {label, value}
--
-- Nothing is published. A project names no client, so the story has none and
-- the client's consent stays NOT_ASKED; publishing goes through Success
-- Stories' own sign-off, which also asks for the operations files behind it.
--
-- The slug is derived from the project's id, so a re-run lands on the same
-- slug and `ON CONFLICT` skips it. The table itself is dropped in PR 7.
-- ============================================================================

INSERT INTO success_story (
  title, slug, summary, body, executive_summary, operations_execution, kpis,
  ai_generated, is_published, created_at
)
SELECT
  left(btrim(pp.name_en), 300),
  'profile-project-' || left(pp.company_profile_project_id::text, 8)
    || COALESCE('-' || NULLIF(regexp_replace(left(regexp_replace(lower(btrim(pp.name_en)),
         '[^a-z0-9]+', '-', 'g'), 60), '(^-+|-+$)', '', 'g'), ''), ''),
  NULLIF(btrim(pp.description_en), ''),
  NULLIF(concat_ws(E'\n\n', NULLIF(btrim(pp.name_fr), ''), NULLIF(btrim(pp.description_fr), '')), ''),
  NULLIF(btrim(pp.description_en), ''),
  NULLIF(concat_ws(E'\n\n', NULLIF(btrim(pp.name_fr), ''), NULLIF(btrim(pp.description_fr), '')), ''),
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object('label', left(m.key, 80), 'value', left(m.value, 80)))
      FROM (
        SELECT key, value
          FROM jsonb_each_text(CASE WHEN jsonb_typeof(pp.metrics) = 'object'
                                    THEN pp.metrics ELSE '{}'::jsonb END)
         WHERE btrim(key) <> '' AND btrim(COALESCE(value, '')) <> ''
         ORDER BY key
         LIMIT 4
      ) m
  ), '[]'::jsonb),
  false,
  false,
  now()
FROM company_profile_project pp
WHERE btrim(COALESCE(pp.name_en, '')) <> ''
ON CONFLICT DO NOTHING;

-- DOWN
-- DELETE FROM success_story WHERE slug LIKE 'profile-project-%' AND is_published = false;
