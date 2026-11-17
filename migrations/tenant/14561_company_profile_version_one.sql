-- ============================================================================
-- TENANT DB — 14561 Company Profile: the fact sheet becomes version 1
-- (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §4.7).
--
-- The declared columns of `company_profile` (0691) move into version 1's nine
-- sections, in the shape 14560 defines: facts and switches in `structure`,
-- words in `text_en` / `text_fr` keyed by the ids in it.
--
--   slogan              -> Cover, tagline
--   positioning         -> Who We Are, positioning
--   certifications,     -> Certifications & Memberships, one item each, held
--   memberships
--   service_promises    -> Why Choose Us, at most six, title and body
--   operating_regions,  -> Capacity & Network, one editable line, because the
--   gateways               section's figures are now DERIVED from the tenant's
--                          own records and a declared list is not one of them;
--                          the line keeps what was typed so nothing is lost
--   published service   -> Services, each switched on
--   types
--
-- The old values were typed in one language, so each lands in both `text_en`
-- and `text_fr`; the editor shows the French as needing a look.
--
-- A fact sheet somebody had confirmed (`declared_confirmed_at`) was already
-- what proposals were grounded in, so version 1 is PUBLISHED with that person
-- and date. An unconfirmed one stays a DRAFT. Either way nothing is lost, and
-- the declared columns stay readable until PR 7 drops them.
--
-- Runs once: it does nothing when any version exists.
-- ============================================================================

DO $$
DECLARE
  p            company_profile%ROWTYPE;
  v_id         uuid;
  v_cert_items jsonb;
  v_cert_text  jsonb;
  v_why_items  jsonb;
  v_why_text   jsonb;
  v_services   jsonb;
  v_network_en text;
  v_network_fr text;
BEGIN
  IF EXISTS (SELECT 1 FROM company_profile_version) THEN
    RETURN;
  END IF;

  SELECT * INTO p FROM company_profile WHERE singleton = true;

  INSERT INTO company_profile_version (number, status, change_note, created_by)
  VALUES (1, 'DRAFT', 'Carried over from the earlier fact sheet',
          (SELECT user_id FROM app_user WHERE user_id = p.declared_confirmed_by))
  ON CONFLICT (number) DO NOTHING
  RETURNING version_id INTO v_id;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  -- Certifications first, then memberships, in the order they were typed.
  WITH named AS (
    SELECT 'CERTIFICATION' AS kind, btrim(c.name) AS name, c.ord AS ord
      FROM unnest(COALESCE(p.certifications, '{}'::text[])) WITH ORDINALITY AS c(name, ord)
    UNION ALL
    SELECT 'MEMBERSHIP', btrim(m.name), 1000 + m.ord
      FROM unnest(COALESCE(p.memberships, '{}'::text[])) WITH ORDINALITY AS m(name, ord)
  ), numbered AS (
    SELECT 'c' || row_number() OVER (ORDER BY ord) AS id, kind, name, ord
      FROM named WHERE name <> ''
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'held', true,
                                               'document_id', NULL) ORDER BY ord), '[]'::jsonb),
         COALESCE(jsonb_object_agg(id, name), '{}'::jsonb)
    INTO v_cert_items, v_cert_text
    FROM numbered;

  WITH promises AS (
    SELECT 'w' || t.ord AS id, t.ord,
           btrim(COALESCE(t.e ->> 'title', '')) AS title,
           btrim(COALESCE(t.e ->> 'value', '')) AS body
      FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(p.service_promises) = 'array'
                  THEN p.service_promises ELSE '[]'::jsonb END
           ) WITH ORDINALITY AS t(e, ord)
     WHERE t.ord <= 6
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'on', true) ORDER BY ord), '[]'::jsonb),
         COALESCE(jsonb_object_agg(id || '.title', title), '{}'::jsonb)
           || COALESCE(jsonb_object_agg(id || '.body', body), '{}'::jsonb)
    INTO v_why_items, v_why_text
    FROM promises
   WHERE title <> '' OR body <> '';

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', st.service_type_id, 'on', true)
                            ORDER BY w.sort_order, st.service_type_id), '[]'::jsonb)
    INTO v_services
    FROM service_type st
    JOIN service_type_web_profile w ON w.service_type_id = st.service_type_id
   WHERE w.is_published = true AND st.is_active = true;

  v_network_en := NULLIF(concat_ws(' ',
    CASE WHEN cardinality(p.operating_regions) > 0
         THEN 'Regions: ' || array_to_string(p.operating_regions, ', ') || '.' END,
    CASE WHEN cardinality(p.gateways) > 0
         THEN 'Gateways: ' || array_to_string(p.gateways, ', ') || '.' END), '');
  v_network_fr := NULLIF(concat_ws(' ',
    CASE WHEN cardinality(p.operating_regions) > 0
         THEN 'Régions : ' || array_to_string(p.operating_regions, ', ') || '.' END,
    CASE WHEN cardinality(p.gateways) > 0
         THEN 'Points d''entrée : ' || array_to_string(p.gateways, ', ') || '.' END), '');

  INSERT INTO company_profile_section (version_id, section_key, structure, text_en, text_fr) VALUES
    (v_id, 'cover',
       jsonb_build_object('on', true, 'image_key', NULL),
       jsonb_strip_nulls(jsonb_build_object('tagline', NULLIF(btrim(p.slogan), ''))),
       jsonb_strip_nulls(jsonb_build_object('tagline', NULLIF(btrim(p.slogan), '')))),
    (v_id, 'who_we_are',
       '{"on": true, "show": {"positioning": true, "history": true, "mission": true}}'::jsonb,
       jsonb_strip_nulls(jsonb_build_object('positioning', NULLIF(btrim(p.positioning), ''))),
       jsonb_strip_nulls(jsonb_build_object('positioning', NULLIF(btrim(p.positioning), '')))),
    (v_id, 'services',
       jsonb_build_object('on', true, 'items', v_services),
       '{}'::jsonb, '{}'::jsonb),
    (v_id, 'capacity',
       '{"on": true, "figures": {"fleet_size": true, "fleet_mix": true, "warehouse": true, "offices": true, "gateways": true, "regions": true}}'::jsonb,
       jsonb_strip_nulls(jsonb_build_object('network', v_network_en)),
       jsonb_strip_nulls(jsonb_build_object('network', v_network_fr))),
    (v_id, 'certifications',
       jsonb_build_object('on', true, 'items', v_cert_items),
       v_cert_text, v_cert_text),
    (v_id, 'case_stories',
       '{"on": true, "story_ids": []}'::jsonb, '{}'::jsonb, '{}'::jsonb),
    (v_id, 'clients',
       '{"on": true, "logo_ids": []}'::jsonb, '{}'::jsonb, '{}'::jsonb),
    (v_id, 'why_us',
       jsonb_build_object('on', true, 'items', v_why_items),
       v_why_text, v_why_text),
    (v_id, 'contact',
       '{"on": true, "show": {"address": true, "phone": true, "email": true, "website": true}}'::jsonb,
       '{}'::jsonb, '{}'::jsonb)
  ON CONFLICT (version_id, section_key) DO NOTHING;

  IF p.declared_confirmed_at IS NOT NULL THEN
    UPDATE company_profile_version
       SET status = 'PUBLISHED',
           published_at = p.declared_confirmed_at,
           published_by = (SELECT user_id FROM app_user WHERE user_id = p.declared_confirmed_by)
     WHERE version_id = v_id;
  END IF;
END $$;

-- DOWN
-- Nothing old is changed or removed here (the declared columns stay until
-- PR 7), so undoing it is removing the copy:
-- DELETE FROM company_profile_share WHERE version_id IN (SELECT version_id FROM company_profile_version);
-- ALTER TABLE company_profile_section DISABLE TRIGGER trg_cps_frozen;
-- DELETE FROM company_profile_section;
-- ALTER TABLE company_profile_section ENABLE TRIGGER trg_cps_frozen;
-- DELETE FROM company_profile_version;
