-- ============================================================================
-- TENANT DB — 14381 The target margin a quotation priced straight from a
-- costing applies to its services (tenant review, meeting 6, PR 4, G1).
--
-- "Create quotation" on a costing prices it in one click with the margin
-- simulator's own rules: débours at cost, own costs not billed, and SERVICES at
-- this margin (margin on price — priceForMargin: price = cost / (1 - m/100)).
--
-- 0 % ON PURPOSE — the auditor's default, recorded in the register: nothing is
-- invented. A tenant that has decided a margin sets it in Settings › Commercial
-- (`/settings/commercial`), and the quotation always shows the margin it was
-- priced at, so a 0 % draft is visibly a 0 % draft.
--
-- WHY A TENANT MIGRATION AND NOT A SEED. `setting` is a tenant table, and the
-- seeds directory's 91xx files run against the PLATFORM database
-- (src/services/platform/migrator.js: tenantSeeds takes /^90/, platformSeeds
-- /^91/). The 9155–9159 range the register gives PR 4 is therefore platform
-- only; a row a tenant reads at runtime belongs here.
--
-- ON CONFLICT DO NOTHING — a tenant that already set its margin keeps it; this
-- seeds a starting point and never reasserts itself over a decision made since
-- (the 9093 rule).
-- ============================================================================

INSERT INTO setting (section, key, value) VALUES
  ('commercial', 'quotation', '{"target_margin_percent": 0}'::jsonb)
ON CONFLICT (section, key) DO NOTHING;

-- DOWN
--   DELETE FROM setting WHERE section = 'commercial' AND key = 'quotation';
--   -- Only safe while no tenant has edited it: the delete removes the row
--   -- whatever it holds, and the service then falls back to 0 %.
