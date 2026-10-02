-- ============================================================================
-- TENANT DB — 14382 Search that finds everything (tenant review, meeting 6,
-- PR 4 — item 4.5, owner decision G5).
--
-- ⌘K now searches RECORDS — clients, files, quotations, invoices, employees… —
-- through one `/search` endpoint that fans out to a provider per module
-- (`src/modules/**/<module>.search.js`). Each provider matches its columns as
-- `search_fold(col) LIKE search_fold('%term%')`, and, for a term of four
-- letters or more, `search_fold(term) <% search_fold(col)` — trigram word
-- similarity, which is what lets "Ngeuma" still find "Nguema".
--
-- ── search_fold: ACCENT- AND CASE-INSENSITIVE, AND INDEXABLE ───────────────
--
-- 10733 already ships `unaccent_safe()`, and it is the right tool for a
-- trigger. It is the wrong one for an INDEX: `unaccent()` is STABLE (its
-- dictionary can be reloaded), and 10733 says in so many words that labelling a
-- wrapper of it IMMUTABLE "is how a wrong answer gets cached in an index".
--
-- `translate()` has no dictionary. It is IMMUTABLE in fact, so a function built
-- only from `lower()` and `translate()` can be declared IMMUTABLE honestly, and
-- a GIN trigram index on `search_fold(col)` is then legitimate. The table below
-- covers the Latin letters a French/English corpus carries (é è ê ë à â ä î ï
-- ô ö ù û ü ç ÿ ñ…); œ and æ fold to their first letter because translate()
-- maps one character to one. The client folds a query with the SAME table
-- (`packages/shared/schemas/search.js`, tested against this file), so the two sides
-- cannot disagree about what "the same word" means.
--
-- ── THE INDEXES ────────────────────────────────────────────────────────────
--
-- One GIN trigram index per column a provider searches, on `search_fold(col)`.
-- Same guards as 0504: pg_trgm is resolved in whatever schema it actually lives
-- in, a missing extension skips the indexes with a WARNING (search still works
-- — a sequential scan over a LIMITed query), and a column that does not exist
-- in this schema is skipped rather than aborting the migration.
--
-- Plain CREATE INDEX, not CONCURRENTLY: the migrator sends each file as one
-- statement batch (see 0504's header for the full reasoning).
-- ============================================================================

CREATE OR REPLACE FUNCTION search_fold(t text) RETURNS text AS $$
  SELECT translate(
    lower(COALESCE(t, '')),
    'àáâãäåāăąçćĉċčďđèéêëēĕėęěĝğġģĥħìíîïĩīĭįıĵķĺļľŀłñńņňòóôõöøōŏőœŕŗřśŝşšţťŧùúûüũūŭůűųŵýÿŷźżžæ',
    'aaaaaaaaacccccddeeeeeeeeegggghhiiiiiiiiijklllllnnnnoooooooooorrrsssstttuuuuuuuuuuwyyyzzza'
  );
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

COMMENT ON FUNCTION search_fold(text) IS
  'Lower-case and strip accents with translate() only, so it is IMMUTABLE and can back a trigram index. ⌘K record search (meeting 6, PR 4). The palette and the API fold with the same table: packages/shared/schemas/search.js.';

CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;

DO $$
DECLARE
  pair   text[];
  pairs  text[][] := ARRAY[
    -- Parties
    ARRAY['client_master',     'name'],
    ARRAY['client_master',     'legal_name'],
    ARRAY['client_master',     'ref'],
    ARRAY['client_contact',    'name'],
    ARRAY['client_contact',    'email'],
    ARRAY['supplier_master',   'name'],
    ARRAY['supplier_master',   'legal_name'],
    ARRAY['supplier_master',   'ref'],
    ARRAY['supplier_contact',  'name'],
    ARRAY['supplier_contact',  'email'],
    ARRAY['corporate_entity',  'legal_name'],
    ARRAY['corporate_entity',  'code'],
    ARRAY['employee',          'full_name'],
    ARRAY['employee',          'staff_no'],
    -- Sales
    ARRAY['lead',              'company_name'],
    ARRAY['lead',              'public_ref'],
    ARRAY['quote_request',     'public_ref'],
    ARRAY['quote_request',     'requester_company'],
    ARRAY['quote_request',     'requester_name'],
    ARRAY['opportunity',       'name'],
    ARRAY['proposal',          'doc_number'],
    ARRAY['proposal',          'title'],
    ARRAY['quotation',         'doc_number'],
    -- Operations and costing
    ARRAY['dossier',           'ref'],
    ARRAY['dossier',           'title'],
    ARRAY['dossier',           'bl_mawb'],
    ARRAY['transit_order',     'ot_number'],
    ARRAY['delivery_note',     'doc_number'],
    ARRAY['costing',           'doc_number'],
    ARRAY['cash_request',      'doc_number'],
    -- Money
    ARRAY['invoice',           'doc_number'],
    ARRAY['purchase_order',    'doc_number'],
    ARRAY['purchase_order',    'supplier_name'],
    ARRAY['supplier_invoice',  'doc_number'],
    ARRAY['supplier_invoice',  'supplier_ref'],
    ARRAY['treasury_account',  'label'],
    ARRAY['treasury_account',  'bank_name'],
    -- Reference data and documents
    ARRAY['dictionary_item',   'code'],
    ARRAY['dictionary_item',   'label_en'],
    ARRAY['dictionary_item',   'label_fr'],
    ARRAY['service_type',      'name_en'],
    ARRAY['service_type',      'name_fr'],
    ARRAY['document_vault',    'original_name'],
    ARRAY['vehicle',           'registration']
  ];
  tbl      text;
  col      text;
  idx      text;
  ext_ns   text;
  made     int := 0;
  skipped  int := 0;
BEGIN
  SELECT n.nspname INTO ext_ns
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
   WHERE e.extname = 'pg_trgm';

  IF ext_ns IS NULL THEN
    RAISE WARNING '[14382] %: pg_trgm is not installed — search_fold trigram indexes skipped. Record search still works, as a bounded sequential scan.', current_schema();
    RETURN;
  END IF;

  FOREACH pair SLICE 1 IN ARRAY pairs LOOP
    tbl := pair[1];
    col := pair[2];

    IF NOT EXISTS (
      SELECT 1
        FROM information_schema.columns c
       WHERE c.table_schema = current_schema()
         AND c.table_name   = tbl
         AND c.column_name  = col
         AND c.data_type IN ('text', 'character varying', 'character', 'USER-DEFINED')
    ) THEN
      skipped := skipped + 1;
      RAISE NOTICE '[14382] skipped %.% — no such text column in %', tbl, col, current_schema();
      CONTINUE;
    END IF;

    idx := format('ix_search_%s_%s', tbl, col);
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
       WHERE schemaname = current_schema() AND indexname = idx
    ) THEN
      EXECUTE format(
        'CREATE INDEX %I ON %I.%I USING gin (%I.search_fold(%I::text) %I.gin_trgm_ops)',
        idx, current_schema(), tbl, current_schema(), col, ext_ns
      );
      made := made + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '[14382] search_fold trigram indexes: % created, % skipped, in schema %',
    made, skipped, current_schema();
END $$;

-- DOWN
-- DO $$
-- DECLARE i record;
-- BEGIN
--   FOR i IN SELECT indexname FROM pg_indexes
--             WHERE schemaname = current_schema() AND indexname LIKE 'ix_search_%' LOOP
--     EXECUTE format('DROP INDEX IF EXISTS %I', i.indexname);
--   END LOOP;
-- END $$;
-- DROP FUNCTION IF EXISTS search_fold(text);
-- -- pg_trgm is left installed: 0504 and others use it.
