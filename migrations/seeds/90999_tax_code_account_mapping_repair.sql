-- ============================================================================
-- TENANT SEED — 90999 Every tax line says which account it debits AND credits.
--
-- ── THE DEFECT, IN THE OWNER'S WORDS ───────────────────────────────────────
--
-- Meeting 7 (1 Oct 2026), 01:25:15, live on the tax screen in front of the
-- tenant:
--
--   "oh I think there's a problem here, it doesn't write the accounts it posts
--    to, that means accounts to be debited and credited … let me check for
--    others … ah it has the credit account, which is … that's okay, debit
--    accounts none … the CFC one national, credit account none. So I'll ensure
--    that every account is actually mapped to their account."
--
-- ── WHAT 9010 ACTUALLY SHIPPED ─────────────────────────────────────────────
--
-- Twelve of the twenty-one seeded codes could not post cleanly:
--
--   NINE had one side NULL — TVA_STD, TVA_STD_SALES, TVA_EXPORT, IRPP,
--   CAC_ON_IRPP, CFC_EE and CNPS_PENSION_EE had no debit; TVA_INPUT_PURCH and
--   TVA_INPUT_TRANSPORT had no credit.
--
--   THREE pointed at a NON-POSTABLE heading rather than a leaf, which is worse
--   than NULL because it looks mapped: SIT_NONRES at `62` (Services extérieurs A,
--   is_postable = false) and `447` (État, impôts retenus à la source, false),
--   and IS_MIN_REEL / IS_MIN_SIMPL crediting `521` (Banques, false). The screen's
--   own account picker loads POSTABLE accounts only
--   (`loadPostableAccounts`), so those three values were not even selectable in
--   the UI that is supposed to maintain them — re-saving the code silently
--   cleared them.
--
-- Nothing failed a test, because `determination.compute` reads ONE side per
-- context (the credit on a sale, the debit on a purchase) and the counterpart
-- comes from the document. So the invoice path worked while the rate card was
-- half-written — and every reader that is not `determination` (the tax screen,
-- the payroll posting, the declaration pack, a person checking the mapping
-- before go-live) saw "none".
--
-- ── THE COUNTERPARTS, AND WHY EACH ONE ─────────────────────────────────────
--
-- The missing side is always the OTHER leg of the entry the tax belongs to:
--
--   Output VAT (TVA_STD, TVA_STD_SALES, TVA_EXPORT) — collected on a sales
--     invoice: credit 443x, debit 4111 Clients, because the client owes the VAT
--     along with the fee.
--   Input VAT (TVA_INPUT_PURCH, TVA_INPUT_TRANSPORT) — suffered on a purchase:
--     debit 445x, credit 4011 Fournisseurs, because the supplier is owed it.
--   Employee withholdings (IRPP, CAC_ON_IRPP, CFC_EE, CNPS_PENSION_EE) — these
--     come OFF the employee's pay: debit 422 Personnel, rémunérations dues
--     (what we owed them is reduced), credit the State / CNPS account. The
--     employer charges already debit 664 correctly and are untouched.
--   SIT_NONRES — 15% retained when paying a non-resident consultant (the
--     owner's own example, 01:19:19): debit 4011 (less is paid out to them),
--     credit 4474 Autres retenues, which is the leaf under the 447 heading the
--     seed was pointing at.
--   IS_MIN_REEL / IS_MIN_SIMPL — the minimum de perception is paid to the State
--     from the bank: credit 5211 Banque principale, the postable leaf under 52.
--
-- Rates, brackets, effective dates and legal references are NOT touched. This
-- file only fills in where an entry lands.
--
-- Idempotent and safe on a tenant who has already fixed one by hand: every
-- UPDATE is keyed on the WRONG value (IS NULL, or the specific heading code), so
-- a row that already carries an account — theirs or ours — is not rewritten.
-- Applies to every version of a code, current and historical, because a
-- prior-period entry has to post to the same places it always did.
-- ============================================================================

-- ── Output VAT: the client owes it with the fee ─────────────────────────────
UPDATE tax_code SET posts_debit_account = '4111'
 WHERE kind = 'VAT' AND applies_to = 'sales' AND posts_debit_account IS NULL;

-- ── Input VAT: the supplier is owed it with the purchase ────────────────────
UPDATE tax_code SET posts_credit_account = '4011'
 WHERE kind = 'VAT' AND applies_to = 'purchases' AND posts_credit_account IS NULL;

-- ── Employee withholdings come off net pay ──────────────────────────────────
UPDATE tax_code SET posts_debit_account = '422'
 WHERE kind = 'PAYROLL'
   AND posts_debit_account IS NULL
   AND code IN ('IRPP','CAC_ON_IRPP','CFC_EE','CNPS_PENSION_EE');

-- ── 15% on a non-resident: a retention on what we pay them ──────────────────
UPDATE tax_code SET posts_debit_account = '4011'
 WHERE code = 'SIT_NONRES' AND (posts_debit_account IS NULL OR posts_debit_account = '62');
UPDATE tax_code SET posts_credit_account = '4474'
 WHERE code = 'SIT_NONRES' AND (posts_credit_account IS NULL OR posts_credit_account = '447');

-- ── Minimum de perception: paid to the State out of the bank ────────────────
UPDATE tax_code SET posts_credit_account = '5211'
 WHERE code IN ('IS_MIN_REEL','IS_MIN_SIMPL')
   AND (posts_credit_account IS NULL OR posts_credit_account = '521');

-- ── Anything still pointing at a heading rather than a leaf ─────────────────
-- A catch-all for a code this file does not name by hand (a tenant's own, or one
-- a later seed adds): a non-postable account is never a valid posting target, so
-- it is cleared back to NULL. NULL is honest and the screen now says so loudly;
-- a heading code looks mapped and posts nowhere.
UPDATE tax_code tc SET posts_debit_account = NULL
 WHERE tc.posts_debit_account IS NOT NULL
   AND EXISTS (SELECT 1 FROM chart_of_accounts a
                WHERE a.code = tc.posts_debit_account AND a.is_postable = false);
UPDATE tax_code tc SET posts_credit_account = NULL
 WHERE tc.posts_credit_account IS NOT NULL
   AND EXISTS (SELECT 1 FROM chart_of_accounts a
                WHERE a.code = tc.posts_credit_account AND a.is_postable = false);

-- ============================================================================
-- VERIFY — both queries must return zero rows.
--   SELECT code, effective_from, posts_debit_account, posts_credit_account
--     FROM tax_code
--    WHERE posts_debit_account IS NULL OR posts_credit_account IS NULL;
--
--   SELECT tc.code, a.code, a.is_postable
--     FROM tax_code tc
--     JOIN chart_of_accounts a
--       ON a.code IN (tc.posts_debit_account, tc.posts_credit_account)
--    WHERE a.is_postable = false;
--
-- IRREVERSIBLE: a backfill of accounting configuration. The prior state is "one
-- side blank or pointing at a heading", which is the defect — restoring it is
-- never the right answer. The DOWN is to correct an individual mapping on the
-- tax screen (Amend rate), which is versioned and audited.
-- ============================================================================
