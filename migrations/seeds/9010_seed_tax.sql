-- ============================================================================
-- SEED (per tenant schema) — Cameroon tax jurisdiction & VERSIONED tax codes
-- (KB Part B / §21). effective_from 2026-01-01. RE-VALIDATE every January
-- against the Finance Law + sign-off by an expert-comptable before go-live.
-- ============================================================================

INSERT INTO tax_jurisdiction (jurisdiction_id, country_code, name, currency)
VALUES ('11111111-1111-1111-1111-111111111111','CM','Cameroun','XAF');

INSERT INTO tax_code
 (jurisdiction_id, code, kind, rate_percent, base_rule, applies_to, recoverable,
  posts_debit_account, posts_credit_account, brackets, effective_from, legal_reference)
VALUES
 ('11111111-1111-1111-1111-111111111111','TVA_STD','VAT',19.2500,'service_ht','sales',NULL,
    NULL,'4432',NULL,'2026-01-01','CGI TVA 17.5%+10% CAC'),
 ('11111111-1111-1111-1111-111111111111','TVA_STD_SALES','VAT',19.2500,'sale_ht','sales',NULL,
    NULL,'4431',NULL,'2026-01-01','CGI TVA'),
 ('11111111-1111-1111-1111-111111111111','TVA_INPUT_PURCH','VAT',19.2500,'purchase_ht','purchases',true,
    '4452',NULL,NULL,'2026-01-01','CGI TVA récupérable'),
 ('11111111-1111-1111-1111-111111111111','TVA_INPUT_TRANSPORT','VAT',19.2500,'purchase_ht','purchases',true,
    '4453',NULL,NULL,'2026-01-01','CGI TVA récupérable transport'),
 ('11111111-1111-1111-1111-111111111111','TVA_EXPORT','VAT',0.0000,'service_ht','sales',NULL,
    NULL,'4432',NULL,'2026-01-01','CGI exports zero-rated'),
 ('11111111-1111-1111-1111-111111111111','IS_STD','INCOME',33.0000,'taxable_profit','income',NULL,
    '891','441',NULL,'2026-01-01','CGI IS 30%+10% CAC'),
 ('11111111-1111-1111-1111-111111111111','IS_MIN_REEL','INCOME',2.2000,'turnover','income',NULL,
    '4492','521',NULL,'2026-01-01','CGI minimum de perception (réel)'),
 ('11111111-1111-1111-1111-111111111111','IS_MIN_SIMPL','INCOME',5.5000,'turnover','income',NULL,
    '4492','521',NULL,'2026-01-01','CGI minimum (simplifié)'),
 ('11111111-1111-1111-1111-111111111111','WHT_SERVICE_REEL','WHT',2.2000,'service_ht','sales',NULL,
    '4492','4111',NULL,'2026-01-01','CGI acompte/précompte service réel'),
 ('11111111-1111-1111-1111-111111111111','WHT_SERVICE_PUBLIC','WHT',5.5000,'service_ht','sales',NULL,
    '4492','4111',NULL,'2026-01-01','CGI retenue marchés publics < 5M'),
 ('11111111-1111-1111-1111-111111111111','SIT_NONRES','WHT',15.0000,'service_ht','nonresident',NULL,
    '62','447',NULL,'2026-01-01','CGI SIT/TSR non-résident'),
 ('11111111-1111-1111-1111-111111111111','CNPS_PENSION_EE','PAYROLL',4.2000,'capped_750000','salary',NULL,
    NULL,'4313','{"cap_xaf":750000}','2026-01-01','Décret CNPS pension (salarié)'),
 ('11111111-1111-1111-1111-111111111111','CNPS_PENSION_ER','PAYROLL',4.2000,'capped_750000','salary',NULL,
    '664','4313','{"cap_xaf":750000}','2026-01-01','Décret CNPS pension (employeur)'),
 ('11111111-1111-1111-1111-111111111111','CNPS_FAMILY_ER','PAYROLL',7.0000,'capped_750000','salary',NULL,
    '664','4313','{"cap_xaf":750000}','2026-01-01','Décret CNPS allocations familiales'),
 ('11111111-1111-1111-1111-111111111111','CNPS_INJURY_ER','PAYROLL',2.5000,'full_gross','salary',NULL,
    '664','4312','{"risk_classes":{"office":1.75,"ops":2.5,"high":5.0}}','2026-01-01','Décret CNPS accident du travail'),
 ('11111111-1111-1111-1111-111111111111','CFC_EE','PAYROLL',1.0000,'taxable_salary','salary',NULL,
    NULL,'4471',NULL,'2026-01-01','Crédit Foncier (salarié)'),
 ('11111111-1111-1111-1111-111111111111','CFC_ER','PAYROLL',1.5000,'full_gross','salary',NULL,
    '664','4471',NULL,'2026-01-01','Crédit Foncier (employeur)'),
 ('11111111-1111-1111-1111-111111111111','FNE_ER','PAYROLL',1.0000,'full_gross','salary',NULL,
    '664','4471',NULL,'2026-01-01','Fonds National de l''Emploi'),
 ('11111111-1111-1111-1111-111111111111','CAC_ON_IRPP','PAYROLL',10.0000,'on_irpp','salary',NULL,
    NULL,'4471',NULL,'2026-01-01','CAC 10% surtaxe IRPP'),
 ('11111111-1111-1111-1111-111111111111','IRPP','PAYROLL',NULL,'net_taxable','salary',NULL,
    NULL,'4471',
    '{"annual_brackets":[{"upto":2000000,"rate":10},{"upto":3000000,"rate":15},{"upto":5000000,"rate":25},{"above":5000000,"rate":35}],"deductions":{"cnps_pension":true,"prof_allowance_pct":30,"annual_abatement":500000}}',
    '2026-01-01','CGI IRPP barème progressif [VERIFY]');
