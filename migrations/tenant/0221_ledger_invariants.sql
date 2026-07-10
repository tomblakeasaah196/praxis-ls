-- ============================================================================
-- TENANT DB — 0221 additional ledger invariants (KB §23), defence-in-depth on
-- top of the app-layer checks in finance/journal_entry. Idempotent.
-- ============================================================================

-- §23.11 — a VALIDATED entry must carry its supporting document (source_doc_ref).
-- The service enforces this too; the trigger guarantees it regardless of caller.
CREATE OR REPLACE FUNCTION assert_source_doc_on_validate() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'validated' AND (NEW.source_doc_ref IS NULL OR btrim(NEW.source_doc_ref) = '') THEN
    RAISE EXCEPTION 'a validated entry requires source_doc_ref (KB §23.11)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_entry_source_doc ON journal_entry;
CREATE TRIGGER trg_entry_source_doc
  BEFORE INSERT OR UPDATE ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION assert_source_doc_on_validate();
