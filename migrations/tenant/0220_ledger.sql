-- ============================================================================
-- TENANT DB — 0220 the double-entry ledger (MOD-55/56) + the KB §23 invariants
-- enforced in the DB (CHECK + triggers) so a bad write is rejected regardless of
-- which service issues it. KB governs; where PRD and KB disagree, KB wins.
-- ============================================================================

CREATE TABLE accounting_period (
  period_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid NOT NULL REFERENCES corporate_entity(entity_id),
  code             text NOT NULL,                    -- '2026-01' | '2026'
  starts_on        date NOT NULL,
  ends_on          date NOT NULL,
  status           text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','FROZEN','CLOSED')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, code)
);

CREATE TABLE journal (
  journal_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             citext NOT NULL,                  -- 'VT'|'AC'|'BQ'|'PAIE'|'OD'
  name             text NOT NULL,                    -- Ventes / Achats / Banque / Paie / Opérations diverses
  entity_id        uuid REFERENCES corporate_entity(entity_id),
  UNIQUE (entity_id, code)
);

CREATE TABLE journal_entry (
  entry_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id       uuid NOT NULL REFERENCES journal(journal_id),
  entity_id        uuid NOT NULL REFERENCES corporate_entity(entity_id),
  period_id        uuid NOT NULL REFERENCES accounting_period(period_id),
  entry_no         integer NOT NULL,                 -- gap-free, monotonic per journal/period
  entry_date       date NOT NULL,
  description      text,
  source_doc_ref   text,                             -- link to MOD-64 vault (Art. 22 — required to validate)
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','validated')),
  source           text NOT NULL DEFAULT 'SYSTEM_AUTO'
                     CHECK (source IN ('SYSTEM_AUTO','SYSTEM_RULE','HUMAN_MANUAL','HUMAN_CORRECTION')),
  review_status    text NOT NULL DEFAULT 'UNREVIEWED'
                     CHECK (review_status IN ('UNREVIEWED','ATTESTED','FLAGGED','CORRECTED')),
  corrects_entry_id uuid REFERENCES journal_entry(entry_id),  -- reversal target (never edit in place)
  reversal_reason  text,
  attested_by      uuid REFERENCES app_user(user_id),
  attested_at      timestamptz,
  created_by       uuid REFERENCES app_user(user_id),
  ip               inet,
  validated_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (journal_id, period_id, entry_no)
);
CREATE INDEX ix_entry_period ON journal_entry(period_id, status);
CREATE INDEX ix_entry_date   ON journal_entry(entry_date);

CREATE TABLE journal_line (
  line_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id         uuid NOT NULL REFERENCES journal_entry(entry_id) ON DELETE CASCADE,
  account_code     text NOT NULL REFERENCES chart_of_accounts(code),
  debit            numeric(18,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit           numeric(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  dossier_id       uuid,                             -- analytical dimension (§6.7); FK added in 0310
  dictionary_item_id uuid REFERENCES dictionary_item(dictionary_item_id),
  is_debours       boolean NOT NULL DEFAULT false,
  tax_code_id      uuid REFERENCES tax_code(tax_code_id),
  currency         char(3) NOT NULL DEFAULT 'XAF',
  fx_rate          numeric(18,8) NOT NULL DEFAULT 1,
  line_no          integer,
  -- §23.2 exactly one side > 0
  CONSTRAINT chk_one_side CHECK ( (debit > 0) <> (credit > 0) )
);
CREATE INDEX ix_line_entry   ON journal_line(entry_id);
CREATE INDEX ix_line_account ON journal_line(account_code);
CREATE INDEX ix_line_dossier ON journal_line(dossier_id) WHERE dossier_id IS NOT NULL;

-- ── INVARIANTS ─────────────────────────────────────────────────────────────

-- §23.3 postable-leaf-only · §23.4 débours never class 6/7 · §23.5 no VAT on
-- débours · §23.10 analytical completeness on requires_analytic accounts.
CREATE OR REPLACE FUNCTION assert_line_valid() RETURNS trigger AS $$
DECLARE acc RECORD;
BEGIN
  SELECT class, is_postable, requires_analytic INTO acc
    FROM chart_of_accounts WHERE code = NEW.account_code;
  IF acc IS NULL THEN
    RAISE EXCEPTION 'unknown account %', NEW.account_code;
  END IF;
  IF NOT acc.is_postable THEN
    RAISE EXCEPTION 'account % is not postable (KB §23.3)', NEW.account_code;
  END IF;
  IF NEW.is_debours AND acc.class IN (6,7) THEN
    RAISE EXCEPTION 'débours line may not post to class 6/7 (account %, KB §23.4)', NEW.account_code;
  END IF;
  IF NEW.is_debours AND NEW.tax_code_id IS NOT NULL THEN
    RAISE EXCEPTION 'no VAT/tax may attach to a débours line (KB §23.5)';
  END IF;
  IF acc.requires_analytic AND NEW.dossier_id IS NULL THEN
    RAISE EXCEPTION 'account % requires a dossier_id (analytical completeness, KB §23.10)', NEW.account_code;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_line_valid BEFORE INSERT OR UPDATE ON journal_line
  FOR EACH ROW EXECUTE FUNCTION assert_line_valid();

-- §23.1 balanced entries (Σ Dr = Σ Cr). DEFERRABLE constraint trigger fires at
-- COMMIT, so an entry + all its lines can be built inside one transaction.
CREATE OR REPLACE FUNCTION assert_entry_balanced() RETURNS trigger AS $$
DECLARE d numeric(18,2); c numeric(18,2); n integer;
BEGIN
  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0), COUNT(*)
    INTO d, c, n FROM journal_line WHERE entry_id = NEW.entry_id;
  IF n < 2 THEN
    RAISE EXCEPTION 'entry % must have at least two lines', NEW.entry_id;
  END IF;
  IF d <> c THEN
    RAISE EXCEPTION 'entry % not balanced: Dr % <> Cr % (KB §23.1)', NEW.entry_id, d, c;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER trg_entry_balanced
  AFTER INSERT OR UPDATE ON journal_entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.status = 'validated')
  EXECUTE FUNCTION assert_entry_balanced();

-- §23.8/23.16 immutability: a validated entry may never be edited in place or
-- deleted — only attestation/review fields may change; corrections are a linked
-- reversal + replacement. Same for its lines.
CREATE OR REPLACE FUNCTION protect_validated_entry() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'validated' THEN
      RAISE EXCEPTION 'validated entry % cannot be deleted — reverse it (KB §23.8/§23.16)', OLD.entry_id;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'validated' THEN
    IF NEW.journal_id      IS DISTINCT FROM OLD.journal_id
       OR NEW.entry_date   IS DISTINCT FROM OLD.entry_date
       OR NEW.entry_no     IS DISTINCT FROM OLD.entry_no
       OR NEW.description   IS DISTINCT FROM OLD.description
       OR NEW.source_doc_ref IS DISTINCT FROM OLD.source_doc_ref
       OR NEW.status       IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'validated entry % is immutable — only review/attestation may change (KB §23.16)', OLD.entry_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_entry_immutable BEFORE UPDATE OR DELETE ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION protect_validated_entry();

CREATE OR REPLACE FUNCTION protect_validated_lines() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM journal_entry
    WHERE entry_id = COALESCE(NEW.entry_id, OLD.entry_id);
  IF st = 'validated' THEN
    RAISE EXCEPTION 'lines of a validated entry are immutable — reverse instead (KB §23.16)';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_lines_immutable BEFORE INSERT OR UPDATE OR DELETE ON journal_line
  FOR EACH ROW EXECUTE FUNCTION protect_validated_lines();
