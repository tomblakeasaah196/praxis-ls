-- ============================================================================
-- TENANT DB — 14594 Sales lean revamp, PR 7: the old fact sheet goes
-- (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §4.7, §4.8; owner decision D9).
--
-- 14561 moved the declared columns of `company_profile` (0691) into version
-- 1's sections, and 14562 made every `company_profile_project` a draft Success
-- Story. Both said PR 7 drops the originals, and PR 5's code has read neither
-- since it merged: the singleton is read for its DERIVED figures only
-- (company_profile.repo DERIVED_COLUMNS), and case stories come from Success
-- Stories.
--
--   company_profile_project      0691's project list, now draft Success Stories
--   company_profile.slogan, positioning, operating_regions, gateways,
--   memberships, certifications, service_promises, source_document_id,
--   declared_confirmed_at, declared_confirmed_by
--                                the declared columns, now version 1's Cover,
--                                Who We Are, Capacity & Network, Certifications
--                                & Memberships and Why Choose Us
--
-- WHAT STAYS: the singleton row and its derived columns (fleet, warehouse,
-- clients, lanes, vertical mix, clearance hours, turnover band, offices,
-- gateways, regions, computed_at), which the Capacity & Network section reads.
-- ============================================================================

-- DESTRUCTIVE: every project became a draft Success Story in 14562
DROP TABLE IF EXISTS company_profile_project;

-- DESTRUCTIVE: moved into version 1's Cover section (tagline) in 14561
ALTER TABLE IF EXISTS company_profile DROP COLUMN IF EXISTS slogan;
-- DESTRUCTIVE: moved into version 1's Who We Are section in 14561
ALTER TABLE IF EXISTS company_profile DROP COLUMN IF EXISTS positioning;
-- DESTRUCTIVE: moved into version 1's Capacity & Network line in 14561; regions are derived now
ALTER TABLE IF EXISTS company_profile DROP COLUMN IF EXISTS operating_regions;
-- DESTRUCTIVE: moved into version 1's Capacity & Network line in 14561; gateways are derived now (gateway_list)
ALTER TABLE IF EXISTS company_profile DROP COLUMN IF EXISTS gateways;
-- DESTRUCTIVE: moved into version 1's Certifications & Memberships section in 14561
ALTER TABLE IF EXISTS company_profile DROP COLUMN IF EXISTS memberships;
-- DESTRUCTIVE: moved into version 1's Certifications & Memberships section in 14561
ALTER TABLE IF EXISTS company_profile DROP COLUMN IF EXISTS certifications;
-- DESTRUCTIVE: moved into version 1's Why Choose Us section in 14561
ALTER TABLE IF EXISTS company_profile DROP COLUMN IF EXISTS service_promises;
-- DESTRUCTIVE: the fact sheet's source document; the vault keeps the document itself
ALTER TABLE IF EXISTS company_profile DROP COLUMN IF EXISTS source_document_id;
-- DESTRUCTIVE: a confirmed sheet became version 1, PUBLISHED with this date, in 14561
ALTER TABLE IF EXISTS company_profile DROP COLUMN IF EXISTS declared_confirmed_at;
-- DESTRUCTIVE: a confirmed sheet became version 1, PUBLISHED by this person, in 14561
ALTER TABLE IF EXISTS company_profile DROP COLUMN IF EXISTS declared_confirmed_by;

-- DOWN
-- IRREVERSIBLE: the values live on in version 1's sections (14561) and in the
-- draft Success Stories (14562); the originals are in the pre-deploy dump. To
-- restore only the SHAPES, re-run 0691's company_profile_project CREATE and
-- re-add the ten columns as 0691 declares them (empty).
