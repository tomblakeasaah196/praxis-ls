-- ============================================================================
-- TENANT DB — 14601 French stops being the language the database insists on
-- (website v2, PR 1; doc/smartls-website/ENGINEERING_GUIDE.md §4 PR 1, item 2).
--
-- Four website columns were NOT NULL in French alone, from the days French was
-- the required language for every tenant:
--
--   site_page.title_fr                 12753
--   service_type_web_group.name_fr     12755
--   service_type_web_faq.question_fr   12745
--   service_type_web_faq.answer_fr     12745
--
-- Which language a field needs is now the tenant's (14600 `site_switches`, and
-- packages/shared/rules/site-languages.js): English on an English-only site,
-- French where French is offered. The services check it on every write,
-- including that a title or a name is present in one language at least; no
-- CHECK is added here, because a constraint on a table with live rows is a
-- deploy that can fail on data (migration-constraint-ordering.test.js). No row
-- is changed.
-- ============================================================================

ALTER TABLE IF EXISTS site_page ALTER COLUMN title_fr DROP NOT NULL;
ALTER TABLE IF EXISTS service_type_web_group ALTER COLUMN name_fr DROP NOT NULL;
ALTER TABLE IF EXISTS service_type_web_faq ALTER COLUMN question_fr DROP NOT NULL;
ALTER TABLE IF EXISTS service_type_web_faq ALTER COLUMN answer_fr DROP NOT NULL;
ALTER TABLE IF EXISTS service_type_web_faq ALTER COLUMN question_en DROP NOT NULL;
ALTER TABLE IF EXISTS service_type_web_faq ALTER COLUMN answer_en DROP NOT NULL;

-- DOWN
-- IRREVERSIBLE: NOT NULL on the French columns can only come back once every
-- row carries French, and an English-only tenant's rows will not. Back-fill the
-- French first, then, per column:
-- ALTER TABLE site_page ALTER COLUMN title_fr SET NOT NULL;
