-- ============================================================================
-- TENANT SEED — 9011 Backfill the tax codes that still post on one side only.
--
-- ── WHY A SECOND REPAIR AFTER 90999 ────────────────────────────────────────
--
-- Meeting 7 shipped seed 90999 to fill the nine codes that seeded with a NULL
-- side. It covered output VAT (sales → debit 4111), input VAT (purchases →
-- credit 4011), the employee withholdings and SIT_NONRES — but NOT the two
-- supplier-market withholdings WHT_SERVICE_REEL / WHT_SERVICE_PUBLIC, because
-- 9010 shipped those already mapped (debit 4492, credit 4111) and there was
-- nothing to fill.
--
-- Those two turn up unmapped anyway on tenants whose codes were amended by hand
-- on the tax screen (the sandbox is one: its WHT_SERVICE_* credit is cleared,
-- while the three output-VAT codes still have a NULL debit because that tenant
-- predates 90999). The tax screen's completeness gate (rules.assertPostingAccounts)
-- then flags all five, which is the state the 1 October review surfaced.
--
-- This seed is self-contained: run on any tenant it clears all five, whether or
-- not 90999 has been applied, and it is a no-op on a tenant that is already
-- mapped. Every UPDATE is keyed on the NULL side only, so a value a tenant (or
-- an earlier seed) already set — theirs or ours — is never rewritten.
--
-- ── THE COUNTERPARTS, AND WHY EACH ONE ─────────────────────────────────────
--
--   Output VAT (TVA_STD, TVA_STD_SALES, TVA_EXPORT), applies_to = 'sales' —
--     the client owes the VAT with the fee, so the debit is 4111 Clients.
--     (Identical to 90999; re-asserted here so this file stands alone.)
--   WHT_SERVICE_REEL / WHT_SERVICE_PUBLIC, kind = 'WHT', applies_to = 'sales' —
--     the précompte / retenue marchés publics a public or large client withholds
--     from what it owes US on our own sales. We carry it as an advance on our
--     income tax: debit 4492 (449 précompte suffered, a receivable that offsets
--     the annual IS — see tax_declaration.rules.withholdingReturn), credit 4111
--     (the client receivable is reduced by what they will remit to the State on
--     our behalf). This is the 'suffered on sales' direction 9010 already ships;
--     it is NOT the supplier-side retention we apply when paying a vendor — that
--     flow is driven by a purchase order's withholding rate, not by a tax code.
--
-- Rates, brackets, effective dates and legal references are NOT touched. This
-- file only fills in where an entry lands, on every version of a code (current
-- and historical), because a prior-period entry posts to the same places it
-- always did.
-- ============================================================================

-- ── Output VAT: the client owes it with the fee ─────────────────────────────
UPDATE tax_code SET posts_debit_account = '4111'
 WHERE kind = 'VAT' AND applies_to = 'sales' AND posts_debit_account IS NULL;

-- ── Service / public-market withholding SUFFERED on our sales ───────────────
UPDATE tax_code SET posts_debit_account = '4492'
 WHERE code IN ('WHT_SERVICE_REEL','WHT_SERVICE_PUBLIC')
   AND posts_debit_account IS NULL;
UPDATE tax_code SET posts_credit_account = '4111'
 WHERE code IN ('WHT_SERVICE_REEL','WHT_SERVICE_PUBLIC')
   AND posts_credit_account IS NULL;

-- ============================================================================
-- VERIFY — must return zero rows:
--   SELECT code, effective_from, posts_debit_account, posts_credit_account
--     FROM tax_code
--    WHERE code IN ('TVA_STD','TVA_STD_SALES','TVA_EXPORT',
--                   'WHT_SERVICE_REEL','WHT_SERVICE_PUBLIC')
--      AND (posts_debit_account IS NULL OR posts_credit_account IS NULL);
--
-- IRREVERSIBLE: a backfill of accounting configuration. The prior state is "one
-- side blank", which is the defect — restoring it is never the right answer. The
-- DOWN is to correct an individual mapping on the tax screen (Amend rate), which
-- is versioned and audited.
-- ============================================================================
