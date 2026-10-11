-- ============================================================================
-- TENANT DB — 14402 A contract in ONE language, and the classification the
-- Cameroonian Labour Code expects it to state.
--
-- ── 1. THE LANGUAGE A CONTRACT IS WRITTEN IN ───────────────────────────────
--
-- Every other document this product prints resolves its language at RENDER
-- time: the operator's pick, then the Document Studio's saved default, then
-- `corporate_entity.default_language` (template.service.resolveDocLanguage).
-- That is right for an invoice. A consignee who reads English gets the English
-- sheet, and printing the same invoice again in French the next day changes
-- nothing that matters.
--
-- It is wrong for a contract, and not by a little. The text a contract prints
-- is the text somebody SIGNED. Rendering it a second time under a different
-- operator's language preference produces a different document carrying the
-- same number, the same verification code and a different set of words — and
-- the clauses themselves are drafted in one language, so the result is a French
-- letterhead over English articles, which is what the tenant was looking at
-- when they said "no english/french, only english or french".
--
-- So the language of a contract is a PROPERTY OF THE AGREEMENT and lives on the
-- row, chosen once when it is drafted. The renderer is handed it rather than
-- resolving one.
--
-- NULL for every contract issued before today, deliberately: nobody chose a
-- language for those, and inventing one would be a claim about a document that
-- has already been signed. The renderer falls back to the entity default for
-- them, exactly as it does now.
--
-- ── 2. professional_category — THE CLASSIFICATION ──────────────────────────
--
-- A Cameroonian employment contract is expected to state the employee's
-- professional category and échelon under the collective agreement that covers
-- the employer's sector. It is the figure the notice period, the leave
-- entitlement and the minimum wage are all read off, so a contract that omits
-- it leaves the three terms that matter most unanchored.
--
-- Text, not an enum: the categories are set by a collective agreement, they
-- differ by sector, and a tenant in freight forwarding is not covered by the
-- same grid as one in construction. An enum here would be this product
-- inventing a classification for an industry it does not know.
-- ============================================================================

/* 'en' | 'fr'. The same two-letter shape as corporate_entity.default_language,
 * so the renderer can take either without a translation step. */
ALTER TABLE hr_contract ADD COLUMN IF NOT EXISTS language char(2)
  CHECK (language IS NULL OR language IN ('en','fr'));

COMMENT ON COLUMN hr_contract.language IS
  'The language this contract is drafted and printed in, chosen once at drafting. NULL for contracts issued before 14402, which fall back to the entity default at render time.';

ALTER TABLE hr_contract ADD COLUMN IF NOT EXISTS professional_category text;

COMMENT ON COLUMN hr_contract.professional_category IS
  'Category and echelon under the applicable collective agreement. Free text because the grid belongs to the sector agreement, not to this product.';

-- DOWN
-- ALTER TABLE hr_contract
--   DROP COLUMN IF EXISTS professional_category,
--   DROP COLUMN IF EXISTS language;
--
-- Reversible without loss of the agreement itself: both columns are terms
-- RECORDED alongside `body_md`, and `body_md` already contains the clauses in
-- whichever language was chosen. What is lost is the ability to re-render a
-- signed contract in the language it was signed in — the renderer falls back to
-- the entity default again — so export hr_contract(hr_contract_id, language,
-- professional_category) before running this.
