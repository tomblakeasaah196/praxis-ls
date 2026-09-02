-- ============================================================================
-- TENANT DB — 12766 What a generated contract has to remember about itself.
--
-- ── THE GAP ────────────────────────────────────────────────────────────────
--
-- `hr_contract` stores `body_md` — the agreed text — and the terms behind it.
-- That was enough while the text was written from scratch by a model each time.
-- It is not enough now that the text is COMPOSED from a versioned clause
-- library, because three questions become askable and unanswerable:
--
--   "Which wording was this generated from?"  There was no library, so no
--   version. A contract issued in March and one issued in September were
--   indistinguishable even if the CDI library had been amended between them.
--
--   "In which language?"  `kit.js` defaults every document to `bilingual`, and
--   the drafter wrote English. A contract is signed in ONE language — a
--   side-by-side instrument raises which-version-governs — so the language is
--   a property of the contract, not of the render.
--
--   "Who was this person, when they signed?"  The identification clause names a
--   date of birth, both parents, a CNI and its issue place. Those live on
--   `employee`, which HR edits. Reading them live means a correction typed in
--   2027 silently rewrites the identification clause of a contract signed in
--   2026 — the document says one thing and the PDF renders another.
--
-- ── SNAPSHOTS ARE THE POINT ────────────────────────────────────────────────
--
-- `employee_snapshot` and `pay_snapshot` freeze the facts AS THEY WERE when the
-- contract was composed. The same argument `document_signature.content_payload`
-- already makes for signatures (10771): the portal renders the as-signed
-- snapshot, never the live record. A contract is the same kind of object.
--
-- ADDITIVE ONLY.
-- ============================================================================

ALTER TABLE hr_contract
  -- One language. Never both. See the header.
  ADD COLUMN IF NOT EXISTS language char(2),
  -- Which of the eighteen libraries produced this, and at which revision.
  ADD COLUMN IF NOT EXISTS clause_library_key     text,
  ADD COLUMN IF NOT EXISTS clause_library_version text,
  -- The employment type the library was chosen from. Frozen here because
  -- `employee.employment_type` can change (a CDD converted to a CDI under
  -- art. 26) and that must not retro-label the contract that came before.
  ADD COLUMN IF NOT EXISTS employment_type text,
  -- The employer's signatory: an entity_person carrying LEGAL_REPRESENTATIVE or
  -- AUTHORISED_SIGNATORY. ON DELETE SET NULL — removing a director from the
  -- register must not delete the contracts they signed.
  ADD COLUMN IF NOT EXISTS employer_person_id uuid REFERENCES entity_person(person_id) ON DELETE SET NULL,
  -- The parties and the money, as at composition.
  ADD COLUMN IF NOT EXISTS employee_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS pay_snapshot      jsonb,
  -- 0700 gave the contract a `gross_salary`. Article 3 states a DECOMPOSITION —
  -- base plus each standing allowance — so the base is its own figure and the
  -- lines live in pay_snapshot. Without this the gross could not be checked
  -- against what it is made of.
  ADD COLUMN IF NOT EXISTS base_salary numeric(18,2),
  -- Where it was signed, and whose courts hear a dispute about it. Both are
  -- printed in the closing and the disputes clause; neither was derivable.
  ADD COLUMN IF NOT EXISTS place_signed      text,
  ADD COLUMN IF NOT EXISTS jurisdiction_city text,
  -- « Fait à Douala, le …, en deux (02) exemplaires originaux », and the two
  -- signature panels beneath it.
  --
  -- NOT part of `body_md`, and that is a rendering fact rather than a taste:
  -- the PDF cuts the body at its `##` headings, the closing carries none, so
  -- inside `body_md` it would print as the final paragraph of the disputes
  -- clause. Stored rather than recomposed at print time for the same reason
  -- `clause_library_version` is pinned — a revised library must not restate
  -- the closing of a contract already signed.
  ADD COLUMN IF NOT EXISTS closing_md        text,
  ADD COLUMN IF NOT EXISTS signature_labels  jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_hr_contract_language' AND conrelid = 'hr_contract'::regclass) THEN
    ALTER TABLE hr_contract ADD CONSTRAINT ck_hr_contract_language
      CHECK (language IS NULL OR language IN ('fr','en'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_hr_contract_base_salary' AND conrelid = 'hr_contract'::regclass) THEN
    ALTER TABLE hr_contract ADD CONSTRAINT ck_hr_contract_base_salary
      CHECK (base_salary IS NULL OR base_salary >= 0);
  END IF;
  -- A composed contract names its library AND its revision, or neither. A row
  -- claiming a library with no version cannot be traced to any wording, which
  -- is the whole reason the columns exist.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_hr_contract_library_pair' AND conrelid = 'hr_contract'::regclass) THEN
    ALTER TABLE hr_contract ADD CONSTRAINT ck_hr_contract_library_pair
      CHECK ((clause_library_key IS NULL     AND clause_library_version IS NULL)
          OR (clause_library_key IS NOT NULL AND clause_library_version IS NOT NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_hr_contract_library
  ON hr_contract (clause_library_key, clause_library_version)
  WHERE clause_library_key IS NOT NULL;

COMMENT ON COLUMN hr_contract.language IS
  'The one language this contract is written and signed in. Never bilingual — see 12766.';
COMMENT ON COLUMN hr_contract.employee_snapshot IS
  'The employee civil identity as at composition. The document renders from this, never from the live employee row — a correction typed later must not rewrite a signed contract.';
COMMENT ON COLUMN hr_contract.pay_snapshot IS
  'Base salary and the standing allowance lines as at composition, so Article 3''s decomposition still adds up years later.';

-- ── The signing cards an employment contract offers ────────────────────────
-- 10773 seeded every signable doc type with exactly
-- {"allowed":["STAMP","DRAWN"],"default":"STAMP"}, because CERTIFIED and
-- PRINT_SIGN had not shipped. They have. An employment contract is signed by
-- hand with a company cachet in this market, and it is also the document a
-- qualified signature exists for — so all four are offered, and the tenant
-- narrows them on the Signatures settings screen if it wants to.
--
-- ── AND THE DEFAULT CARD BECOMES DRAWN ─────────────────────────────────────
--
-- A STAMP is the COMPANY's mark. On every other document the signer is acting
-- for a business and a stamp is the right thing to pre-select; on an employment
-- contract the counterparty is a person signing for themselves, and an employee
-- has no cachet. Pre-selecting one asks them to produce something they do not
-- have, on the first screen they ever see of this product.
--
-- Guarded on the row STILL BEING 10773's seed, byte for byte. That is the only
-- way to tell an untouched default from one a tenant chose, and a migration
-- that overwrites a deliberate choice is worse than one that leaves a poor
-- default standing. A tenant that has tuned its policy gets the wider `allowed`
-- and keeps its own default.
UPDATE setting
   SET value = '{"allowed":["STAMP","DRAWN","CERTIFIED","PRINT_SIGN"],"default":"DRAWN"}'::jsonb
 WHERE section = 'signature_policy'
   AND key = 'EMPLOYMENT_CONTRACT'
   AND value = '{"allowed":["STAMP","DRAWN"],"default":"STAMP"}'::jsonb;

-- Anything else: widen the menu, leave the tenant's chosen default alone.
UPDATE setting
   SET value = jsonb_set(value, '{allowed}', '["STAMP","DRAWN","CERTIFIED","PRINT_SIGN"]'::jsonb, true)
 WHERE section = 'signature_policy'
   AND key = 'EMPLOYMENT_CONTRACT'
   AND NOT (value -> 'allowed' @> '["PRINT_SIGN"]'::jsonb);

INSERT INTO setting (section, key, value)
VALUES ('signature_policy', 'EMPLOYMENT_CONTRACT',
        '{"allowed":["STAMP","DRAWN","CERTIFIED","PRINT_SIGN"],"default":"DRAWN"}'::jsonb)
ON CONFLICT (section, key) DO NOTHING;

-- DOWN
--   DROP INDEX IF EXISTS ix_hr_contract_library;
--   ALTER TABLE hr_contract
--     DROP CONSTRAINT IF EXISTS ck_hr_contract_language,
--     DROP CONSTRAINT IF EXISTS ck_hr_contract_base_salary,
--     DROP CONSTRAINT IF EXISTS ck_hr_contract_library_pair;
--   ALTER TABLE hr_contract
--     DROP COLUMN IF EXISTS language, DROP COLUMN IF EXISTS clause_library_key,
--     DROP COLUMN IF EXISTS clause_library_version, DROP COLUMN IF EXISTS employment_type,
--     DROP COLUMN IF EXISTS employer_person_id, DROP COLUMN IF EXISTS employee_snapshot,
--     DROP COLUMN IF EXISTS pay_snapshot, DROP COLUMN IF EXISTS base_salary,
--     DROP COLUMN IF EXISTS place_signed, DROP COLUMN IF EXISTS jurisdiction_city,
--     DROP COLUMN IF EXISTS closing_md, DROP COLUMN IF EXISTS signature_labels;
--   UPDATE setting SET value = jsonb_set(value, '{allowed}', '["STAMP","DRAWN"]'::jsonb, true)
--    WHERE section = 'signature_policy' AND key = 'EMPLOYMENT_CONTRACT';
