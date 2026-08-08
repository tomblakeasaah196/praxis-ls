-- ============================================================================
-- TENANT DB — 0519 treasury master data revamp (MOD-09).
--
-- WHAT THIS DOES
--
-- Two problems, one migration.
--
-- PROBLEM 1 — the row was a stub.
-- `treasury_account` had entity_id, kind, label, coa_code, currency, is_active
-- and nothing else. Enough to POST to; not enough to CREATE the way a treasurer
-- actually creates one. You could not record an IBAN. You could not record a
-- SWIFT. You could not name the person responsible for a petty cash float. You
-- could not distinguish "verified against a bank letter" from "someone typed it
-- in". The letterhead's `bank_block` jsonb filled the gap on the DOCUMENT side
-- and the treasury table filled it on the GL side, and the two drifted, which
-- is the bug 0516 §6 already promised to close.
--
-- PROBLEM 2 — the kind was frozen.
-- `kind IN ('BANK','CASH','MOMO')` was a CHECK. Which meant Airtel SmartCash
-- arriving in Cameroon required a schema migration; petty cash needed a
-- subtype hack; and a treasurer who thinks of "MTN MoMo" and "Orange Money" as
-- separate categories (they behave differently — different fees, different
-- reconciliation lag, different CoA sub-account) could not model them.
--
-- The right shape is a first-class REGISTRY: `treasury_category` — a table
-- of account types (BANK, CASH, PETTY_CASH, MTN_MOMO, ORANGE_MONEY, and
-- whatever the treasurer adds next), each pointing at a class-5 CoA parent.
-- treasury_account belongs to one category. The service auto-mints a 6-digit
-- leaf under `category.coa_parent_code` on create, so every account owns its
-- own leaf and the trial balance separates them.
--
-- The five seeded categories are `is_system=true` — they can be renamed or
-- deactivated but not deleted. Anything the treasurer adds is `is_system=false`.
--
-- CAPABILITY FLAGS on the category tell the UI which field groups to render:
-- BANK sets `is_bank_identity` (IBAN/SWIFT/bank/branch); MTN and Orange set
-- `is_momo_identity` (network number/till/agent); PETTY_CASH sets
-- `requires_custodian` (custodian is mandatory, float_limit is asked for).
-- Same account type → same fields; add a new category and the UI just works.
--
-- WHAT ABOUT THE OLD `kind` COLUMN?
-- Kept, denormalised, populated by the service from `category.legacy_kind`
-- so the migration is ADDITIVE and existing readers (finance/hub cash-position
-- donut, payment_receipt.method → treasury_account.kind, entity-360, letterhead)
-- keep working with no code change. New readers should use category_id. The
-- CHECK on kind is widened to allow the new values ('PETTY_CASH','MTN_MOMO',
-- 'ORANGE_MONEY') so the denormalised copy round-trips.
--
-- SUB-ACCOUNT AUTO-GENERATION IS IN THE SERVICE, NOT HERE.
-- The service layer already owns the transactional insert of the treasury
-- account and can co-write the CoA leaf in the same transaction. A trigger
-- would repeat the "next 6-digit child of parent" logic in SQL for no gain.
-- Keep it in JS where it's testable.
--
-- ADDITIVE ONLY. Every change is `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF
-- NOT EXISTS`, a widening of a CHECK, or a seed with `ON CONFLICT DO NOTHING`.
-- Existing rows are untouched; a best-effort backfill of category_id runs for
-- rows whose old `kind` maps cleanly to a seeded category. Idempotent — safe
-- to re-run.
--
-- SCHEMA-DUAL. Like every tenant migration this runs UNQUALIFIED, once per
-- schema (live, then sandbox). See migrations/tenant/0001_extensions.sql and
-- doc/DB_ARCHITECTURE.md.
-- ============================================================================

-- ── §0  A dedicated 5711 CoA leaf for petty cash ──────────────────────────
--
-- Seed 9000 gives us 571 (Caisse siège, non-postable parent) and 5211/5381/5382
-- as postable leaves. There is no parent for petty cash sub-accounts to hang
-- off. Create a 4-digit `5711` "Petty cash" node under 571 — non-postable
-- itself (parents are not postable), so treasury_account's petty-cash leaves
-- (5711nn) are what get posted to.
INSERT INTO chart_of_accounts
  (code, parent_code, label_fr, label_en, class, normal_balance, is_postable, requires_analytic)
VALUES
  ('5711', '571', 'Caisses régies (petites caisses)', 'Petty cash floats', 5, 'D', false, false)
ON CONFLICT (code) DO NOTHING;

-- ── §1  treasury_category — the user-editable registry ────────────────────
CREATE TABLE IF NOT EXISTS treasury_category (
  treasury_category_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             citext NOT NULL,                      -- 'BANK'|'CASH'|'PETTY_CASH'|'MTN_MOMO'|...
  label            text NOT NULL,                        -- 'Bank', 'Petty Cash', 'MTN Mobile Money'
  legacy_kind      text NOT NULL
    CHECK (legacy_kind IN ('BANK','CASH','MOMO')),      -- so the old `kind` column can be populated
  coa_parent_code  text NOT NULL REFERENCES chart_of_accounts(code),

  -- Capability flags — the UI reads these to decide which field groups to show
  -- on the create form. Data-driven so a new category doesn't need a code change.
  requires_custodian boolean NOT NULL DEFAULT false,     -- petty cash
  is_bank_identity   boolean NOT NULL DEFAULT false,     -- IBAN/SWIFT/bank/branch
  is_momo_identity   boolean NOT NULL DEFAULT false,     -- momo_number/till/agent

  is_system        boolean NOT NULL DEFAULT false,       -- seeded rows: not deletable
  is_active        boolean NOT NULL DEFAULT true,
  created_by       uuid REFERENCES app_user(user_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code)
);
CREATE INDEX IF NOT EXISTS ix_treasury_category_active ON treasury_category(is_active);

DROP TRIGGER IF EXISTS trg_treasury_category_updated ON treasury_category;
CREATE TRIGGER trg_treasury_category_updated
  BEFORE UPDATE ON treasury_category
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed the five categories every tenant starts with.
INSERT INTO treasury_category
  (code, label, legacy_kind, coa_parent_code, requires_custodian, is_bank_identity, is_momo_identity, is_system)
VALUES
  ('BANK',         'Bank',              'BANK', '521',  false, true,  false, true),
  ('CASH',         'Cash',              'CASH', '571',  false, false, false, true),
  ('PETTY_CASH',   'Petty Cash',        'CASH', '5711', true,  false, false, true),
  ('MTN_MOMO',     'MTN Mobile Money',  'MOMO', '5381', false, false, true,  true),
  ('ORANGE_MONEY', 'Orange Money',      'MOMO', '5382', false, false, true,  true)
ON CONFLICT (code) DO NOTHING;

-- ── §2  Extend treasury_account ───────────────────────────────────────────
--
-- Widen the `kind` CHECK so the denormalised copy of `category.legacy_kind`
-- can round-trip. (This CHECK was `BANK|CASH|MOMO`; the old values still fit,
-- and the new tenant-added categories carry one of those three via legacy_kind.)
-- We keep `kind` because 4+ modules already query on it (finance/hub,
-- payment_receipt.method mapping, entity-360). New consumers should use
-- category_id.
ALTER TABLE treasury_account DROP CONSTRAINT IF EXISTS treasury_account_kind_check;
ALTER TABLE treasury_account
  ADD CONSTRAINT treasury_account_kind_check
  CHECK (kind IN ('BANK','CASH','MOMO'));

ALTER TABLE treasury_account
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES treasury_category(treasury_category_id),

  -- Banking identity (BANK). None hard-required at the row level — a draft
  -- account is a legal state — but the service asks for them at VERIFICATION,
  -- because posting to an account whose IBAN you cannot state is exactly the
  -- shape of the fraud this refactor exists to prevent.
  ADD COLUMN IF NOT EXISTS bank_name        text,
  ADD COLUMN IF NOT EXISTS branch           text,
  ADD COLUMN IF NOT EXISTS account_number   text,
  ADD COLUMN IF NOT EXISTS iban             text,
  ADD COLUMN IF NOT EXISTS swift_bic        text,
  ADD COLUMN IF NOT EXISTS routing_code     text,
  ADD COLUMN IF NOT EXISTS holder_name      text,

  -- Opening balance is a treasurer-supplied number; it does NOT post to GL by
  -- itself (that stays a journal_entry so the ledger's balance always
  -- reconciles from postings). The 360's "Balance" tile shows
  -- `opening_balance + net movements since opening_date`.
  ADD COLUMN IF NOT EXISTS opening_balance  numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_date     date,

  -- Day of the month the bank issues a statement (1–31).
  ADD COLUMN IF NOT EXISTS statement_day    smallint
    CHECK (statement_day IS NULL OR (statement_day BETWEEN 1 AND 31)),

  -- Soft rule: one "primary" per (entity, category) is what the UI encourages.
  -- The letterhead and the default account picker read the flag; enforcement
  -- is in the service (POST /:id/primary clears the previous primary in the
  -- same category+entity in a transaction).
  ADD COLUMN IF NOT EXISTS is_primary       boolean NOT NULL DEFAULT false,

  -- Verification — treasurer confirmed the numbers against a bank letter.
  ADD COLUMN IF NOT EXISTS is_verified      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_by      uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS verified_at      timestamptz,

  -- CASH / PETTY_CASH.
  ADD COLUMN IF NOT EXISTS custodian_user_id uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS location         text,
  ADD COLUMN IF NOT EXISTS float_limit      numeric(18,2)
    CHECK (float_limit IS NULL OR float_limit >= 0),

  -- MoMo identity (MTN, Orange, and any tenant-added MoMo-style category).
  -- `momo_number` is the account phone/wallet; `momo_till` and `momo_agent`
  -- are the merchant identifiers where relevant.
  ADD COLUMN IF NOT EXISTS momo_number      text,
  ADD COLUMN IF NOT EXISTS momo_till        text,
  ADD COLUMN IF NOT EXISTS momo_agent       text,

  -- Audit surface.
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by       uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS created_by       uuid REFERENCES app_user(user_id);

-- updated_at trigger — set_updated_at is defined in 0100_identity.sql.
DROP TRIGGER IF EXISTS trg_treasury_account_updated ON treasury_account;
CREATE TRIGGER trg_treasury_account_updated
  BEFORE UPDATE ON treasury_account
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Coherence: verified requires verifier + timestamp.
ALTER TABLE treasury_account
  DROP CONSTRAINT IF EXISTS chk_treasury_verified_stamped;
ALTER TABLE treasury_account
  ADD CONSTRAINT chk_treasury_verified_stamped
  CHECK (is_verified = false OR (verified_by IS NOT NULL AND verified_at IS NOT NULL));

-- Useful indexes for the list and the 360.
CREATE INDEX IF NOT EXISTS ix_treasury_category   ON treasury_account(category_id) WHERE category_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_treasury_entity_cat ON treasury_account(entity_id, category_id);
CREATE INDEX IF NOT EXISTS ix_treasury_kind_active ON treasury_account(kind, is_active);
CREATE INDEX IF NOT EXISTS ix_treasury_custodian  ON treasury_account(custodian_user_id) WHERE custodian_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_treasury_primary    ON treasury_account(entity_id, category_id, is_primary) WHERE is_primary = true;

-- ── §3  Backfill category_id on existing rows ─────────────────────────────
--
-- The old model only distinguished BANK/CASH/MOMO. Best-effort mapping:
--   kind=BANK              → BANK
--   kind=CASH              → CASH   (existing CASH rows are Caisse Siège by
--                                    default — no custodian was ever collected,
--                                    so we cannot promote them to PETTY_CASH)
--   kind=MOMO, momo_network~'MTN'    → MTN_MOMO
--   kind=MOMO, momo_network~'ORANGE' → ORANGE_MONEY
--   kind=MOMO, network unknown       → left NULL; the treasurer sets it in the UI
UPDATE treasury_account a
   SET category_id = c.treasury_category_id
  FROM treasury_category c
 WHERE a.category_id IS NULL
   AND (
        (a.kind = 'BANK' AND c.code = 'BANK')
     OR (a.kind = 'CASH' AND c.code = 'CASH')
     OR (a.kind = 'MOMO' AND c.code = 'MTN_MOMO'     AND UPPER(a.momo_network) LIKE 'MTN%')
     OR (a.kind = 'MOMO' AND c.code = 'ORANGE_MONEY' AND UPPER(a.momo_network) LIKE 'ORANGE%')
   );
