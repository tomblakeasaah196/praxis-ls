-- ============================================================================
-- SEED (per tenant schema) — default tenant settings the Super Admin edits from
-- the Settings UI (doc/BUILD_CONVENTIONS.md §6). Numbering schemes drive
-- services/documents/numbering.service; finance rules are read at runtime via
-- shared/config/settings. ON CONFLICT DO NOTHING preserves tenant edits on
-- re-run.
-- ============================================================================

-- Document numbering schemes (section 'numbering', key = module_key).
INSERT INTO setting (section, key, value) VALUES
 ('numbering', 'MOD-51', '{"prefix":"INV","code":"","padding":5,"reset":"yearly","separator":"-"}'::jsonb),  -- final invoice
 ('numbering', 'MOD-50', '{"prefix":"PRO","code":"","padding":5,"reset":"yearly","separator":"-"}'::jsonb),  -- proforma / advance
 ('numbering', 'MOD-49', '{"prefix":"REG","code":"","padding":5,"reset":"yearly","separator":"-"}'::jsonb),  -- régie d'avance
 ('numbering', 'MOD-55', '{"prefix":"JE","code":"","padding":5,"reset":"yearly","separator":"-"}'::jsonb)    -- journal entry
ON CONFLICT (section, key) DO NOTHING;

-- Finance business rules (read via getRule at runtime, never hard-coded).
INSERT INTO setting (section, key, value) VALUES
 ('finance', 'regie',   '{"policy_window_days":7}'::jsonb),
 ('finance', 'invoice', '{"quote_model":"HT_ON_TOP","default_vat_code":"TVA_STD"}'::jsonb)
ON CONFLICT (section, key) DO NOTHING;
