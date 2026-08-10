-- ============================================================================
-- SEED (per tenant schema) — MOD-05 FINANCIAL DICTIONARY: service types, the
-- equipment/load registries, and the curated catalogue of operational lines
-- with their OHADA posting rules and Basic/Advanced/Full service tiers.
--
-- ── WHY A SEED AND NOT A MIGRATION ──────────────────────────────────────────
--
-- Every row here points at reference data that TENANT MIGRATIONS DO NOT
-- CONTAIN. `posting_rule.debit_account` is an FK to chart_of_accounts, which is
-- populated by 9000/9001; `posting_rule.tax_code_id` is an FK to tax_code,
-- populated by 9010. Seeds run AFTER the whole tenant migration set
-- (migrator.js: tenantSchema, then tenantSeeds), so a dictionary written as a
-- migration would resolve every one of those lookups against an empty table and
-- either abort on the FK or silently seed NULL accounts. The `9080` prefix puts
-- this file after 9001 (accounts) and 9010 (tax) in the same /^90/ tenant-seed
-- glob, which is the ordering the FKs need.
--
-- ── WHAT THIS SEEDS ─────────────────────────────────────────────────────────
--
--   1. The chart-of-accounts leaves this catalogue needs and 9000/9001 lack —
--      275 for refundable deposits, plus postable children under the 605/622/
--      628/638 groupings (see the note on postability below).
--   2. dictionary_ref kinds CONTAINER_TYPE and LOAD_MODE — the equipment
--      registry the collapsed variant-bearing lines are priced against.
--   3. 12 system service types (MOD-29 taxonomy), the anchor for tiers.
--   4. 165 curated dictionary lines, each with a re-minted `#<L><NNN>` code.
--   5. Their posting rules, generated set-based by direction.
--   6. Their Basic/Advanced/Full membership per service type.
--
-- ── THE TRANSFORMATION THIS ENCODES ─────────────────────────────────────────
--
-- The source is the legacy MariaDB `financial_dictionary` table (~195 rows).
-- Three rules did most of the work.
--
-- BILLABLE IS NOT REVENUE. The legacy `cost_nature` enum called anything the
-- client pays for a CHARGEABLE_SERVICE, and the old UI read that as income.
-- It is not: a customs duty you advance and re-bill at cost is a DÉBOURS —
-- money through the business, never yours, and never in class 7. Only the
-- lines that are your own fee or commission are REVENUE here (file opening,
-- documentation, the commission on disbursements, extra legal work, service
-- charges, and the warehousing services actually performed in your own shed).
-- Everything else that the client pays for is DEBOURS: Dr 4731 / Cr 4011 on
-- the way in, Dr 4111 / Cr 4731 on the way out, no VAT on either leg.
--
-- DÉBOURS CARRY NO TAX CODE. Not "usually" — the ledger rejects it (§23.5,
-- assert_line_valid) and so does invoice_line (chk_debours_no_tax). The client
-- is shown the upstream supplier's VAT as paid on their behalf, which is what
-- `debours_vat_transparent` records, and the forwarder retains none of it.
--
-- EQUIPMENT IS A RATE DIMENSION, NOT A LINE. ~30 legacy rows were the same
-- charge duplicated per box size ("Port Charges 20'", "Port Charges 40'",
-- Open Top, Flat Rack…). Each family collapses to ONE line flagged
-- `varies_by_equipment` (0632), priced per variant on the Expense-Rate tab
-- against the CONTAINER_TYPE registry seeded below. Rates themselves are NOT
-- seeded here — that is the Expense-Rate build.
--
-- ── A NOTE ON POSTABILITY (why this file adds accounts) ─────────────────────
--
-- §23.3 is enforced in the database: `assert_line_valid` refuses a journal line
-- on an account whose `is_postable` is false, and the dictionary's own account
-- picker only lists postable leaves. 9001 seeds 605, 622, 628 and 638 as
-- non-postable GROUPINGS, so a posting rule naming one of them would pass its
-- FK, sit in the catalogue looking correct, and fail at the moment someone
-- posted against it — in a different module, much later. The postable children
-- added below (6051, 6221/6222, 6281/6282, 6381/6382/6383) are those families'
-- real leaves, following the 9001 house style. 624, 625, 661, 6053 and 6311 are
-- already postable and are used as-is.
--
-- ── IDEMPOTENCY ─────────────────────────────────────────────────────────────
--
-- Every INSERT is conflict-guarded. posting_rule has no unique key, so its
-- inserts also carry a NOT EXISTS guard on (item, context) — the bare
-- ON CONFLICT DO NOTHING alongside it is a no-op that keeps the static check
-- honest about intent. The staging tables are ON COMMIT DROP, so a re-run in
-- the same session starts clean. Re-running this file inserts nothing.
-- ============================================================================

-- ── 1. Chart-of-accounts leaves this catalogue binds to ─────────────────────
-- 275 "Dépôts et cautionnements versés" is a class-2 DEBIT account: a bank
-- caution or a permanent deposit is money you will get back, not a cost of the
-- period. Its 2-digit heading 27 is absent from 9000/9001, so both are added.
INSERT INTO chart_of_accounts (code,parent_code,label_fr,label_en,class,normal_balance,is_postable,requires_analytic) VALUES
  ('27',NULL,'Autres immobilisations financières','Other financial assets',2,'D',false,false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO chart_of_accounts (code,parent_code,label_fr,label_en,class,normal_balance,is_postable,requires_analytic) VALUES
  ('275','27','Dépôts et cautionnements versés','Deposits and guarantees paid',2,'D',true,false),
  ('6051','605','Fournitures de bureau et consommables','Office supplies and consumables',6,'D',true,false),
  ('6221','622','Loyers et charges locatives','Rent and rental charges',6,'D',true,false),
  ('6222','622','Locations de matériel et de véhicules','Equipment and vehicle hire',6,'D',true,true),
  ('6281','628','Télécommunications, internet et télématique','Telecom, internet and telematics',6,'D',true,false),
  ('6282','628','Eau, électricité et autres fluides','Water, electricity and utilities',6,'D',true,false),
  ('6381','638','Frais de mission et de déplacement','Travel and mission expenses',6,'D',true,false),
  ('6382','638','Publicité, marketing et relations publiques','Advertising, marketing and PR',6,'D',true,false),
  ('6383','638','Autres charges externes diverses','Sundry other external charges',6,'D',true,false)
ON CONFLICT (code) DO NOTHING;

-- ── 2. Equipment and load-mode registries (dictionary_ref) ──────────────────
-- Feet, not "GP". The people typing these say "un 40 pieds" and "un 40 HC" —
-- naming the registry after the carrier's own jargon is how a dropdown stops
-- being read twice. `extra` carries the machine-readable size so a future rate
-- import can match "40HC" without parsing a display label.
INSERT INTO dictionary_ref (kind, code, name_fr, name_en, extra, sort_order, is_system) VALUES
  ('CONTAINER_TYPE','FT20','20''','20''','{"teu":1,"size":"20"}'::jsonb,10,true),
  ('CONTAINER_TYPE','FT40','40''','40''','{"teu":2,"size":"40"}'::jsonb,20,true),
  ('CONTAINER_TYPE','FT40HC','40'' HC','40'' HC','{"teu":2,"size":"40HC"}'::jsonb,30,true),
  ('CONTAINER_TYPE','FT45HC','45'' HC','45'' HC','{"teu":2.25,"size":"45HC"}'::jsonb,40,true),
  ('CONTAINER_TYPE','FLATRACK','Flat Rack','Flat Rack','{"special":true}'::jsonb,50,true),
  ('CONTAINER_TYPE','OPENTOP','Open Top','Open Top','{"special":true}'::jsonb,60,true),
  ('CONTAINER_TYPE','REEFER','Reefer (Frigo)','Reefer','{"special":true,"powered":true}'::jsonb,70,true),
  ('CONTAINER_TYPE','ISOTANK','ISO Tank','ISO Tank','{"special":true}'::jsonb,80,true),
  ('CONTAINER_TYPE','VENTILATED','Ventilé','Ventilated','{"special":true}'::jsonb,90,true),
  ('CONTAINER_TYPE','BULK','Vrac','Bulk','{"special":true}'::jsonb,100,true),
  ('LOAD_MODE','FCL','Conteneur complet (FCL)','Full container load (FCL)','{}'::jsonb,10,true),
  ('LOAD_MODE','LCL','Groupage (LCL)','Less than container load (LCL)','{}'::jsonb,20,true),
  ('LOAD_MODE','RORO','Roulier (RoRo)','Roll-on roll-off (RoRo)','{}'::jsonb,30,true),
  ('LOAD_MODE','BREAKBULK','Conventionnel (break-bulk)','Break-bulk','{}'::jsonb,40,true),
  ('LOAD_MODE','CHARTER','Affrètement','Charter','{}'::jsonb,50,true)
ON CONFLICT (kind, code) DO NOTHING;

-- Two subcategories the curated set needs and 0630 did not seed.
INSERT INTO dictionary_ref (kind, code, name_fr, name_en, sort_order, is_system) VALUES
  ('SUBCATEGORY','BANK_FINANCE','Banque et finance','Bank and finance',195,true),
  ('SUBCATEGORY','DOCUMENTATION','Documentation et titres','Documentation and titles',105,true)
ON CONFLICT (kind, code) DO NOTHING;

-- ── 3. Service types (MOD-29 taxonomy) ──────────────────────────────────────
-- `territory` is where the service happens, which is why it lives here and not
-- on the dictionary line: the same THC charge is import territory on Monday and
-- export territory on Tuesday, and only the SERVICE knows which.
INSERT INTO service_type (key, name_fr, name_en, territory, is_system) VALUES
  ('SEA_FREIGHT_IMPORT','Fret Maritime Import','Sea Freight Import','INTERNATIONAL_IMPORT',true),
  ('SEA_FREIGHT_EXPORT','Fret Maritime Export','Sea Freight Export','INTERNATIONAL_EXPORT',true),
  ('AIR_FREIGHT_IMPORT','Fret Aérien Import','Air Freight Import','INTERNATIONAL_IMPORT',true),
  ('AIR_FREIGHT_EXPORT','Fret Aérien Export','Air Freight Export','INTERNATIONAL_EXPORT',true),
  ('HINTERLAND_TRANSIT','Transit Hinterland','Hinterland Transit','TRANSIT_HINTERLAND',true),
  ('INLAND_TRANSPORTATION','Transport Terrestre','Inland Transportation','DOMESTIC_INLAND',true),
  ('WAREHOUSING','Entreposage','Warehousing','DOMESTIC_INLAND',true),
  ('END_TO_END_AIR_FREIGHT','Fret Aérien Porte-à-Porte','End-to-End Air Freight','END_TO_END_INTERNATIONAL',true),
  ('END_TO_END_SEA_FREIGHT','Fret Maritime Porte-à-Porte','End-to-End Sea Freight','END_TO_END_INTERNATIONAL',true),
  ('BUSINESS_REPRESENTATION','Représentation Commerciale','Business Representation','DOMESTIC_INLAND',true),
  ('CUSTOMS_BROKERAGE','Dédouanement','Customs Brokerage','PORT_AIRPORT_ZONE',true),
  ('PROJECT_CARGO','Cargaison Spéciale','Project & Break-bulk','END_TO_END_INTERNATIONAL',true)
ON CONFLICT (key) DO NOTHING;

-- ── 4. Staging ──────────────────────────────────────────────────────────────
-- The catalogue is authored ONCE into a staging table and everything else is
-- derived from it: the code, the category, the posting rules, the tiers. That
-- is what keeps 165 lines reviewable — a reviewer reads one row per charge and
-- checks a handful of set-based rules, instead of 165 hand-written triples.
--
-- ON COMMIT DROP because the migrator runs each seed file inside one explicit
-- transaction (migrator.js applyTracked) and reuses the connection for the next
-- file. The whole file therefore commits atomically, which is also what lets
-- the DEFERRABLE `trg_dict_needs_rule` see the rules: items are inserted first
-- and rules second, and the "every item has ≥1 rule" check runs at COMMIT.
CREATE TEMP TABLE _svc_group (
  token       text NOT NULL,
  service_key text NOT NULL,
  PRIMARY KEY (token, service_key)
) ON COMMIT DROP;

CREATE TEMP TABLE _tax_ref (
  name        text PRIMARY KEY,
  tax_code_id uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE _dict_seed (
  key                text PRIMARY KEY,
  label_fr           text NOT NULL,
  label_en           text NOT NULL,
  direction          text NOT NULL,   -- REVENUE | EXPENSE | DEBOURS | ASSET
  subcategory        text NOT NULL,   -- dictionary_ref kind SUBCATEGORY
  applicability_mode text NOT NULL,   -- SERVICE_SCOPED | ANY_OPERATIONS | NON_OPERATIONAL
  unit_of_measure    text,            -- dictionary_ref kind UNIT (NULL when the variant carries it)
  is_billable        boolean NOT NULL,
  proof_source       text,            -- dictionary_ref kind PROOF_SOURCE
  vat                text NOT NULL,   -- STD | STD_T (transport input) | ZERO (export) | NONE
  account            text,            -- debit for EXPENSE/ASSET, credit for REVENUE, NULL for DEBOURS
  svc                text[] NOT NULL DEFAULT '{}'::text[],  -- _svc_group tokens
  tier_default       text NOT NULL DEFAULT 'ADVANCED',
  varies             boolean NOT NULL DEFAULT false,
  description        text,
  code               text
) ON COMMIT DROP;

CREATE TEMP TABLE _dict_basic (
  service_key text NOT NULL,
  item_key    text NOT NULL,
  PRIMARY KEY (service_key, item_key)
) ON COMMIT DROP;

-- Token → service key. Identity rows plus the three combos that carry most of
-- the catalogue, so a line that applies to "any sea service" says so once.
INSERT INTO _svc_group (token, service_key) VALUES
  ('SEA_IMP','SEA_FREIGHT_IMPORT'),
  ('SEA_EXP','SEA_FREIGHT_EXPORT'),
  ('AIR_IMP','AIR_FREIGHT_IMPORT'),
  ('AIR_EXP','AIR_FREIGHT_EXPORT'),
  ('HINT','HINTERLAND_TRANSIT'),
  ('INLAND','INLAND_TRANSPORTATION'),
  ('WHS','WAREHOUSING'),
  ('E2E_AIR','END_TO_END_AIR_FREIGHT'),
  ('E2E_SEA','END_TO_END_SEA_FREIGHT'),
  ('BIZREP','BUSINESS_REPRESENTATION'),
  ('CUSTOMS','CUSTOMS_BROKERAGE'),
  ('PROJECT','PROJECT_CARGO'),
  ('ALL_SEA','SEA_FREIGHT_IMPORT'),
  ('ALL_SEA','SEA_FREIGHT_EXPORT'),
  ('ALL_SEA','END_TO_END_SEA_FREIGHT'),
  ('ALL_AIR','AIR_FREIGHT_IMPORT'),
  ('ALL_AIR','AIR_FREIGHT_EXPORT'),
  ('ALL_AIR','END_TO_END_AIR_FREIGHT'),
  ('ALL_OPS','SEA_FREIGHT_IMPORT'),
  ('ALL_OPS','SEA_FREIGHT_EXPORT'),
  ('ALL_OPS','AIR_FREIGHT_IMPORT'),
  ('ALL_OPS','AIR_FREIGHT_EXPORT'),
  ('ALL_OPS','HINTERLAND_TRANSIT'),
  ('ALL_OPS','INLAND_TRANSPORTATION'),
  ('ALL_OPS','WAREHOUSING'),
  ('ALL_OPS','END_TO_END_AIR_FREIGHT'),
  ('ALL_OPS','END_TO_END_SEA_FREIGHT'),
  ('ALL_OPS','BUSINESS_REPRESENTATION'),
  ('ALL_OPS','CUSTOMS_BROKERAGE'),
  ('ALL_OPS','PROJECT_CARGO')
ON CONFLICT (token, service_key) DO NOTHING;

-- Tax codes are REFERENCED, never seeded here (9010 owns them, effective-dated).
-- DISTINCT ON takes the current version per code, which is what a posting rule
-- written today should bind to.
INSERT INTO _tax_ref (name, tax_code_id)
SELECT DISTINCT ON (tc.code::text) tc.code::text, tc.tax_code_id
  FROM tax_code tc
  JOIN tax_jurisdiction tj ON tj.jurisdiction_id = tc.jurisdiction_id
 WHERE tj.country_code = 'CM'
   AND tc.code IN ('TVA_STD','TVA_EXPORT','TVA_INPUT_PURCH','TVA_INPUT_TRANSPORT')
 ORDER BY tc.code::text, tc.effective_from DESC
ON CONFLICT (name) DO NOTHING;

-- ── 5. The catalogue ────────────────────────────────────────────────────────
-- Columns: key, label_fr, label_en, direction, subcategory, applicability_mode,
--          unit, is_billable, proof_source, vat, account, svc tokens.
-- Everything else (category, is_debours, provider_kind, receipt obligations,
-- debours_vat_transparent, the code) is derived below.

-- REVENUE — the only lines that are genuinely yours. Your fee, your commission,
-- and the warehousing work performed in your own building. 7061 transit
-- commission, 7071 re-billed ancillaries, 7063 logistics services sold.
INSERT INTO _dict_seed (key,label_fr,label_en,direction,subcategory,applicability_mode,unit_of_measure,is_billable,proof_source,vat,account,svc) VALUES
 ('FILE_OPENING','Ouverture de dossier','File Opening','REVENUE','AGENCY_FEE','ANY_OPERATIONS','DOSSIER',true,'INTERNAL_SERVICE','STD','7061','{ALL_OPS}'),
 ('DOCUMENTATION_FEE','Frais de dossier','Documentation Fee','REVENUE','AGENCY_FEE','ANY_OPERATIONS','DOSSIER',true,'INTERNAL_SERVICE','STD','7061','{ALL_OPS}'),
 ('IMPORT_DECLARATION_FEE','Frais de déclaration d''importation (DI)','Import Declaration Fee','REVENUE','AGENCY_FEE','SERVICE_SCOPED','DOSSIER',true,'INTERNAL_SERVICE','STD','7061','{SEA_IMP,AIR_IMP,CUSTOMS,E2E_SEA,E2E_AIR}'),
 ('DISBURSEMENT_COMMISSION','Commission sur débours','Commission on Disbursements','REVENUE','AGENCY_FEE','ANY_OPERATIONS','DOSSIER',true,'INTERNAL_SERVICE','STD','7061','{ALL_OPS}'),
 ('EXTRA_LEGAL_WORK','Travaux juridiques supplémentaires','Extra Legal Work','REVENUE','AGENCY_FEE','ANY_OPERATIONS','DOSSIER',true,'INTERNAL_SERVICE','STD','7061','{ALL_OPS}'),
 ('EXPORT_TRANSIT_COMMISSION','Commission de transit export','Export Transit Commission','REVENUE','AGENCY_FEE','SERVICE_SCOPED','DOSSIER',true,'INTERNAL_SERVICE','ZERO','7061','{SEA_EXP,AIR_EXP}'),
 ('SERVICE_CHARGES','Frais de service','Service Charges','REVENUE','AGENCY_FEE','ANY_OPERATIONS','DOSSIER',true,'INTERNAL_SERVICE','STD','7071','{ALL_OPS}'),
 ('LASHING','Saisissage et arrimage','Lashing and Securing','REVENUE','HANDLING','SERVICE_SCOPED','UNIT',true,'INTERNAL_SERVICE','STD','7063','{ALL_SEA,PROJECT,INLAND}'),
 ('WAREHOUSE_STORAGE_DAY','Magasinage par jour','Storage per Day','REVENUE','STORAGE','SERVICE_SCOPED','DAY',true,'INTERNAL_SERVICE','STD','7063','{WHS}'),
 ('WAREHOUSE_HANDLING_IN','Manutention entrée entrepôt','Warehouse Handling In','REVENUE','HANDLING','SERVICE_SCOPED','TON',true,'INTERNAL_SERVICE','STD','7063','{WHS}'),
 ('WAREHOUSE_HANDLING_OUT','Manutention sortie entrepôt','Warehouse Handling Out','REVENUE','HANDLING','SERVICE_SCOPED','TON',true,'INTERNAL_SERVICE','STD','7063','{WHS}'),
 ('INVENTORY_MANAGEMENT','Gestion des stocks','Inventory Management','REVENUE','STORAGE','SERVICE_SCOPED','DOSSIER',true,'INTERNAL_SERVICE','STD','7063','{WHS}'),
 ('ORDER_PICKING','Préparation de commandes','Order Picking','REVENUE','HANDLING','SERVICE_SCOPED','UNIT',true,'INTERNAL_SERVICE','STD','7063','{WHS}'),
 ('REPACKAGING','Reconditionnement','Repackaging','REVENUE','HANDLING','SERVICE_SCOPED','UNIT',true,'INTERNAL_SERVICE','STD','7063','{WHS}')
ON CONFLICT (key) DO NOTHING;

-- ASSET — refundable. A caution comes back, so it is a class-2 deposit on 275,
-- not a cost of the period. Getting this wrong understates the balance sheet by
-- the whole standing caution and overstates the year's charges.
INSERT INTO _dict_seed (key,label_fr,label_en,direction,subcategory,applicability_mode,unit_of_measure,is_billable,proof_source,vat,account,svc) VALUES
 ('BANK_CAUTION','Caution bancaire','Bank Caution (refundable)','ASSET','BANK_FINANCE','ANY_OPERATIONS','DOSSIER',false,'THIRD_PARTY_VENDOR','NONE','275','{ALL_OPS}'),
 ('PERMANENT_DEPOSIT_FEES','Frais de dépôt permanent (PDF)','Permanent Deposit Fees (PDF)','ASSET','BANK_FINANCE','ANY_OPERATIONS','DOSSIER',false,'GOVERNMENT_AUTHORITY','NONE','275','{SEA_IMP,SEA_EXP,CUSTOMS,HINT,E2E_SEA}')
ON CONFLICT (key) DO NOTHING;

-- EXPENSE — your own cost. Overheads are NON_OPERATIONAL (no dossier, no
-- service tier); the fleet, project-cargo and warehousing costs below are
-- operational costs you incur in your own name and may or may not re-bill.
INSERT INTO _dict_seed (key,label_fr,label_en,direction,subcategory,applicability_mode,unit_of_measure,is_billable,proof_source,vat,account,svc) VALUES
 ('SALARIES','Salaires et rémunérations','Salaries and Wages','EXPENSE','SALARIES','NON_OPERATIONAL','UNIT',false,'INTERNAL_SERVICE','NONE','661','{}'),
 ('OFFICE_RENT','Loyer des bureaux','Office Rent','EXPENSE','RENT','NON_OPERATIONAL','UNIT',false,'THIRD_PARTY_VENDOR','STD','6221','{}'),
 ('UTILITIES_WATER_POWER','Eau et électricité','Water and Electricity','EXPENSE','UTILITIES','NON_OPERATIONAL','UNIT',false,'THIRD_PARTY_VENDOR','STD','6282','{}'),
 ('TELECOM_INTERNET','Télécommunications et internet','Telecom and Internet','EXPENSE','UTILITIES','NON_OPERATIONAL','UNIT',false,'THIRD_PARTY_VENDOR','STD','6281','{}'),
 ('OFFICE_SUPPLIES','Fournitures de bureau','Office Supplies','EXPENSE','OTHER','NON_OPERATIONAL','UNIT',false,'THIRD_PARTY_VENDOR','STD','6051','{}'),
 ('OFFICE_EQUIPMENT_MAINTENANCE','Entretien du matériel de bureau','Office Equipment Maintenance','EXPENSE','OTHER','NON_OPERATIONAL','UNIT',false,'THIRD_PARTY_VENDOR','STD','624','{}'),
 ('GENERAL_INSURANCE','Assurances générales','General Insurance','EXPENSE','OTHER','NON_OPERATIONAL','UNIT',false,'THIRD_PARTY_VENDOR','NONE','625','{}'),
 ('MISSION_ALLOWANCE','Frais de mission','Mission Allowance','EXPENSE','OTHER','NON_OPERATIONAL','DOSSIER',false,'INTERNAL_SERVICE','NONE','6381','{}'),
 ('MARKETING','Marketing et publicité','Marketing and Advertising','EXPENSE','OTHER','NON_OPERATIONAL','UNIT',false,'THIRD_PARTY_VENDOR','STD','6382','{}'),
 ('VEHICLE_MAINTENANCE','Entretien des véhicules','Vehicle Maintenance','EXPENSE','TRUCKING','NON_OPERATIONAL','UNIT',false,'THIRD_PARTY_VENDOR','STD','624','{}'),
 ('FACILITY_PAYMENT','Frais de facilitation (négociation douane)','Facility Payment (customs negotiation)','EXPENSE','CUSTOMS_DUTIES','ANY_OPERATIONS','DOSSIER',false,'INTERNAL_SERVICE','NONE','6383','{ALL_OPS}'),
 ('BANK_CHARGES','Frais bancaires','Bank Charges','EXPENSE','BANK_FINANCE','ANY_OPERATIONS','UNIT',false,'THIRD_PARTY_VENDOR','NONE','6311','{ALL_OPS}'),
 ('WIRE_TRANSFER_FEES','Frais de virement','Wire Transfer Fees','EXPENSE','BANK_FINANCE','ANY_OPERATIONS','UNIT',false,'THIRD_PARTY_VENDOR','NONE','6311','{ALL_OPS}'),
 ('FX_COMMISSION','Commission de change','FX Commission','EXPENSE','BANK_FINANCE','ANY_OPERATIONS','UNIT',false,'THIRD_PARTY_VENDOR','NONE','6311','{ALL_OPS}'),
 ('STOCK_INSURANCE','Assurance des stocks','Stock Insurance','EXPENSE','OTHER','SERVICE_SCOPED','DAY',true,'THIRD_PARTY_VENDOR','NONE','625','{WHS}'),
 ('FUEL','Carburant','Fuel','EXPENSE','TRUCKING','SERVICE_SCOPED','UNIT',false,'THIRD_PARTY_VENDOR','STD','6053','{INLAND,HINT,E2E_SEA,E2E_AIR}'),
 ('DRIVER_ALLOWANCE','Indemnité de route chauffeur','Driver Allowance','EXPENSE','TRUCKING','SERVICE_SCOPED','UNIT',false,'INTERNAL_SERVICE','NONE','6381','{INLAND,HINT}'),
 ('TOLLS_ROAD_FEES','Péages et taxes routières','Tolls and Road Fees','EXPENSE','TRUCKING','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','NONE','6131','{INLAND,HINT,E2E_SEA,E2E_AIR}'),
 ('GPS_TRACKING','Suivi GPS et télématique','GPS and Tracking','EXPENSE','TRUCKING','SERVICE_SCOPED','UNIT',false,'THIRD_PARTY_VENDOR','STD','6281','{INLAND,HINT}'),
 ('TRUCK_RENTAL','Location de camion','Truck Rental','EXPENSE','TRUCKING','SERVICE_SCOPED','DAY',true,'THIRD_PARTY_VENDOR','STD','6222','{INLAND,HINT,PROJECT}'),
 ('HAULAGE_PER_KM','Transport routier au kilomètre','Per-km Haulage','EXPENSE','TRUCKING','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','STD_T','6131','{INLAND,HINT}'),
 ('CRANE_LIFTING','Grutage et levage','Crane and Lifting','EXPENSE','HANDLING','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','STD','6211','{PROJECT}'),
 ('HEAVY_LIFT_ESCORT','Escorte de colis lourds','Heavy-lift Escort','EXPENSE','ESCORT','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','STD','6271','{PROJECT}'),
 ('MARINE_CARGO_SURVEY','Expertise maritime et marchandise','Marine and Cargo Survey','EXPENSE','SURVEY','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','STD','6321','{PROJECT,ALL_SEA}'),
 ('CONVOY_SECURITY','Sécurité du convoi','Convoy Security','EXPENSE','ESCORT','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','STD','6271','{PROJECT,HINT}'),
 ('OOG_SURCHARGE','Surcharge hors gabarit (OOG)','Out-of-Gauge (OOG) Surcharge','EXPENSE','OCEAN_FREIGHT','SERVICE_SCOPED','UNIT',true,'CARRIER_AIRLINE','STD_T','6111','{PROJECT,ALL_SEA}')
ON CONFLICT (key) DO NOTHING;

-- DEBOURS — carrier, port, customs and third-party charges advanced for the
-- client and re-billed at cost. Dr 4731 / Cr 4011 in, Dr 4111 / Cr 4731 out,
-- no tax code on either leg.

-- Carrier and freight.
INSERT INTO _dict_seed (key,label_fr,label_en,direction,subcategory,applicability_mode,unit_of_measure,is_billable,proof_source,vat,account,svc) VALUES
 ('OCEAN_FREIGHT','Fret maritime','Ocean Freight','DEBOURS','OCEAN_FREIGHT','SERVICE_SCOPED',NULL,true,'CARRIER_AIRLINE','NONE',NULL,'{ALL_SEA,PROJECT}'),
 ('AIR_FREIGHT','Fret aérien','Air Freight','DEBOURS','AIR_FREIGHT','SERVICE_SCOPED','KG',true,'CARRIER_AIRLINE','NONE',NULL,'{ALL_AIR}'),
 ('SHIPPING_LINE_CHARGES','Frais compagnie maritime','Shipping Line Charges','DEBOURS','OCEAN_FREIGHT','SERVICE_SCOPED',NULL,true,'CARRIER_AIRLINE','NONE',NULL,'{ALL_SEA}'),
 ('BAF_SURCHARGE','Surcharge carburant (BAF)','Bunker Adjustment Factor (BAF)','DEBOURS','SURCHARGES','SERVICE_SCOPED','UNIT',true,'CARRIER_AIRLINE','NONE',NULL,'{ALL_SEA}'),
 ('CAF_SURCHARGE','Surcharge de change (CAF)','Currency Adjustment Factor (CAF)','DEBOURS','SURCHARGES','SERVICE_SCOPED','UNIT',true,'CARRIER_AIRLINE','NONE',NULL,'{ALL_SEA}'),
 ('WAR_RISK_SURCHARGE','Surcharge risque de guerre','War Risk Surcharge','DEBOURS','SURCHARGES','SERVICE_SCOPED','UNIT',true,'CARRIER_AIRLINE','NONE',NULL,'{ALL_SEA,ALL_AIR}'),
 ('CONGESTION_SURCHARGE','Surcharge de congestion portuaire','Port Congestion Surcharge','DEBOURS','SURCHARGES','SERVICE_SCOPED','UNIT',true,'CARRIER_AIRLINE','NONE',NULL,'{ALL_SEA}'),
 ('EQUIPMENT_IMBALANCE_SURCHARGE','Surcharge de repositionnement (EIS)','Equipment Imbalance Surcharge','DEBOURS','SURCHARGES','SERVICE_SCOPED','UNIT',true,'CARRIER_AIRLINE','NONE',NULL,'{ALL_SEA}'),
 ('PEAK_SEASON_SURCHARGE','Surcharge de haute saison','Peak Season Surcharge','DEBOURS','SURCHARGES','SERVICE_SCOPED','UNIT',true,'CARRIER_AIRLINE','NONE',NULL,'{ALL_SEA}'),
 ('LOW_SULPHUR_SURCHARGE','Surcharge soufre (LSS)','Low Sulphur Surcharge (LSS)','DEBOURS','SURCHARGES','SERVICE_SCOPED','UNIT',true,'CARRIER_AIRLINE','NONE',NULL,'{ALL_SEA}'),
 ('BL_ISSUANCE','Émission du connaissement (BL)','Bill of Lading Issuance','DEBOURS','DOCUMENTATION','SERVICE_SCOPED','BL',true,'CARRIER_AIRLINE','NONE',NULL,'{ALL_SEA}'),
 ('SWITCH_BL','Connaissement switch','Switch Bill of Lading','DEBOURS','DOCUMENTATION','SERVICE_SCOPED','BL',true,'CARRIER_AIRLINE','NONE',NULL,'{ALL_SEA}'),
 ('TELEX_RELEASE','Mainlevée télex','Telex Release','DEBOURS','DOCUMENTATION','SERVICE_SCOPED','BL',true,'CARRIER_AIRLINE','NONE',NULL,'{ALL_SEA}'),
 ('CARRIER_ADMIN_FEE','Frais administratifs compagnie','Carrier Administration Fee','DEBOURS','OCEAN_FREIGHT','SERVICE_SCOPED','BL',true,'CARRIER_AIRLINE','NONE',NULL,'{ALL_SEA}'),
 ('DOCUMENTATION_AMENDMENT','Frais de modification documentaire','Documentation Amendment Fee','DEBOURS','DOCUMENTATION','SERVICE_SCOPED','BL',true,'CARRIER_AIRLINE','NONE',NULL,'{ALL_SEA,ALL_AIR}'),
 ('CHANGE_OF_DESTINATION','Changement de destination','Change of Destination Fee','DEBOURS','DOCUMENTATION','SERVICE_SCOPED','BL',true,'CARRIER_AIRLINE','NONE',NULL,'{ALL_SEA}'),
 ('SHIPPING_GUARANTEE','Lettre de garantie d''enlèvement','Shipping Guarantee','DEBOURS','DOCUMENTATION','SERVICE_SCOPED','BL',true,'CARRIER_AIRLINE','NONE',NULL,'{ALL_SEA}'),
 ('CONTAINER_LEASING','Location de conteneur','Container Leasing','DEBOURS','OCEAN_FREIGHT','SERVICE_SCOPED','DAY',true,'CARRIER_AIRLINE','NONE',NULL,'{ALL_SEA,PROJECT}'),
 ('CONTAINER_SEAL','Plomb de conteneur','Container Seal','DEBOURS','OCEAN_FREIGHT','SERVICE_SCOPED','UNIT',true,'CARRIER_AIRLINE','NONE',NULL,'{ALL_SEA}'),
 ('AWB_FEE','Frais de lettre de transport aérien (LTA)','Air Waybill (AWB) Fee','DEBOURS','DOCUMENTATION','SERVICE_SCOPED','BL',true,'CARRIER_AIRLINE','NONE',NULL,'{ALL_AIR}'),
 ('AIR_CARGO_HANDLING','Manutention fret aérien','Air Cargo Handling','DEBOURS','HANDLING','SERVICE_SCOPED','KG',true,'CARRIER_AIRLINE','NONE',NULL,'{ALL_AIR}'),
 ('AIRPORT_STORAGE','Magasinage aéroport','Airport Storage','DEBOURS','STORAGE','SERVICE_SCOPED','DAY',true,'PORT_TERMINAL','NONE',NULL,'{ALL_AIR}'),
 ('AIRPORT_SECURITY_SCREENING','Contrôle de sûreté aéroportuaire','Airport Security Screening','DEBOURS','SCANNING','SERVICE_SCOPED','KG',true,'CARRIER_AIRLINE','NONE',NULL,'{ALL_AIR}')
ON CONFLICT (key) DO NOTHING;

-- Port and terminal.
INSERT INTO _dict_seed (key,label_fr,label_en,direction,subcategory,applicability_mode,unit_of_measure,is_billable,proof_source,vat,account,svc) VALUES
 ('PORT_CHARGES','Frais portuaires','Port Charges','DEBOURS','THC','SERVICE_SCOPED',NULL,true,'PORT_TERMINAL','NONE',NULL,'{ALL_SEA,CUSTOMS}'),
 ('THC','Manutention terminal (THC)','Terminal Handling Charges (THC)','DEBOURS','THC','SERVICE_SCOPED',NULL,true,'PORT_TERMINAL','NONE',NULL,'{ALL_SEA}'),
 ('STEVEDORING','Acconage','Stevedoring','DEBOURS','HANDLING','SERVICE_SCOPED',NULL,true,'PORT_TERMINAL','NONE',NULL,'{ALL_SEA,PROJECT}'),
 ('YARD_OCCUPANCY','Occupation de terre-plein','Yard Occupancy','DEBOURS','STORAGE','SERVICE_SCOPED',NULL,true,'PORT_TERMINAL','NONE',NULL,'{ALL_SEA}'),
 ('SECURITY_FEES','Frais de sûreté (ISPS)','Security Fees (ISPS)','DEBOURS','THC','SERVICE_SCOPED',NULL,true,'PORT_TERMINAL','NONE',NULL,'{ALL_SEA}'),
 ('FULL_CONTAINER_HANDLING','Manutention conteneur plein','Full Container Handling','DEBOURS','HANDLING','SERVICE_SCOPED',NULL,true,'PORT_TERMINAL','NONE',NULL,'{ALL_SEA}'),
 ('EMPTY_CONTAINER_HANDLING','Manutention conteneur vide','Empty Container Handling','DEBOURS','HANDLING','SERVICE_SCOPED',NULL,true,'PORT_TERMINAL','NONE',NULL,'{ALL_SEA}'),
 ('CONTAINER_MAINTENANCE','Entretien de conteneur','Container Maintenance','DEBOURS','THC','SERVICE_SCOPED',NULL,true,'PORT_TERMINAL','NONE',NULL,'{ALL_SEA}'),
 ('PAD_FEES','Redevances PAD (Port Autonome de Douala)','PAD Fees (Douala Port Authority)','DEBOURS','THC','SERVICE_SCOPED',NULL,true,'PORT_TERMINAL','NONE',NULL,'{ALL_SEA,CUSTOMS}'),
 ('PAK_FEES','Redevances PAK (Port Autonome de Kribi)','PAK Fees (Kribi Port Authority)','DEBOURS','THC','SERVICE_SCOPED',NULL,true,'PORT_TERMINAL','NONE',NULL,'{ALL_SEA,CUSTOMS}'),
 ('SCANNING_FEES','Frais de scanner','Scanning Fees','DEBOURS','SCANNING','SERVICE_SCOPED',NULL,true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,CUSTOMS,HINT}'),
 ('DEMURRAGE','Surestaries','Demurrage','DEBOURS','DEMURRAGE','SERVICE_SCOPED',NULL,true,'CARRIER_AIRLINE','NONE',NULL,'{ALL_SEA}'),
 ('CONTAINER_DETENTION','Détention de conteneur','Container Detention','DEBOURS','DEMURRAGE','SERVICE_SCOPED','DAY',true,'CARRIER_AIRLINE','NONE',NULL,'{ALL_SEA}'),
 ('PORT_STORAGE','Magasinage portuaire','Port Storage','DEBOURS','STORAGE','SERVICE_SCOPED','DAY',true,'PORT_TERMINAL','NONE',NULL,'{ALL_SEA}'),
 ('WHARFAGE','Redevance de quai','Wharfage','DEBOURS','THC','SERVICE_SCOPED','TON',true,'PORT_TERMINAL','NONE',NULL,'{ALL_SEA}'),
 ('PORT_EXIT_FORMALITIES','Formalités de sortie du port','Port Exit Formalities','DEBOURS','THC','SERVICE_SCOPED','DOSSIER',true,'PORT_TERMINAL','NONE',NULL,'{ALL_SEA,CUSTOMS}'),
 ('PORT_ACCESS_BADGE','Badge d''accès au port','Port Access Badge','DEBOURS','THC','SERVICE_SCOPED','UNIT',true,'PORT_TERMINAL','NONE',NULL,'{ALL_SEA,CUSTOMS}'),
 ('WEIGHING','Pesage','Weighing','DEBOURS','THC','SERVICE_SCOPED','UNIT',true,'PORT_TERMINAL','NONE',NULL,'{ALL_SEA,INLAND,CUSTOMS}'),
 ('VGM_CERTIFICATE','Certificat de masse brute vérifiée (VGM)','VGM Certificate','DEBOURS','DOCUMENTATION','SERVICE_SCOPED','UNIT',true,'PORT_TERMINAL','NONE',NULL,'{SEA_EXP,E2E_SEA}'),
 ('STUFFING','Empotage','Stuffing Operations','DEBOURS','HANDLING','SERVICE_SCOPED','UNIT',true,'PORT_TERMINAL','NONE',NULL,'{SEA_EXP,E2E_SEA,WHS}'),
 ('UNSTUFFING','Dépotage','Unstuffing Operations','DEBOURS','HANDLING','SERVICE_SCOPED','UNIT',true,'PORT_TERMINAL','NONE',NULL,'{SEA_IMP,E2E_SEA,WHS}'),
 ('REEFER_PLUG_IN','Branchement conteneur frigorifique','Reefer Plug-in','DEBOURS','STORAGE','SERVICE_SCOPED','DAY',true,'PORT_TERMINAL','NONE',NULL,'{ALL_SEA}'),
 ('REEFER_MONITORING','Surveillance frigorifique','Reefer Monitoring','DEBOURS','STORAGE','SERVICE_SCOPED','DAY',true,'PORT_TERMINAL','NONE',NULL,'{ALL_SEA}'),
 ('TALLY_SERVICES','Pointage (tally)','Tally Services','DEBOURS','HANDLING','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','NONE',NULL,'{ALL_SEA,PROJECT}'),
 ('TERMINAL_GATE_FEES','Frais d''entrée et de sortie terminal','Terminal Gate In-Out Fees','DEBOURS','THC','SERVICE_SCOPED','UNIT',true,'PORT_TERMINAL','NONE',NULL,'{ALL_SEA}'),
 ('CONTAINER_CLEANING','Nettoyage de conteneur','Container Cleaning','DEBOURS','THC','SERVICE_SCOPED','UNIT',true,'PORT_TERMINAL','NONE',NULL,'{ALL_SEA}'),
 ('CONTAINER_REPAIR','Réparation de conteneur','Container Repair','DEBOURS','THC','SERVICE_SCOPED','UNIT',true,'CARRIER_AIRLINE','NONE',NULL,'{ALL_SEA}'),
 ('DEPOT_HANDLING','Manutention au dépôt','Depot Handling','DEBOURS','HANDLING','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','NONE',NULL,'{ALL_SEA}'),
 ('EMPTY_CONTAINER_RETURN','Restitution du conteneur vide','Empty Container Return','DEBOURS','TRUCKING','SERVICE_SCOPED','UNIT',true,'CARRIER_AIRLINE','NONE',NULL,'{ALL_SEA}'),
 ('PORT_SECURITY_ESCORT','Escorte de sécurité portuaire','Port Security Escort','DEBOURS','ESCORT','SERVICE_SCOPED','UNIT',true,'PORT_TERMINAL','NONE',NULL,'{ALL_SEA,PROJECT}')
ON CONFLICT (key) DO NOTHING;

-- Customs, statutory and documentary.
INSERT INTO _dict_seed (key,label_fr,label_en,direction,subcategory,applicability_mode,unit_of_measure,is_billable,proof_source,vat,account,svc) VALUES
 ('CUSTOMS_DUTIES_TAXES','Droits et taxes de douane','Customs Duties and Taxes','DEBOURS','CUSTOMS_DUTIES','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,ALL_AIR,CUSTOMS,HINT}'),
 ('EXCISE_DUTY','Droit d''accise','Excise Duty','DEBOURS','CUSTOMS_DUTIES','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,ALL_AIR,CUSTOMS}'),
 ('CUSTOMS_CLEARANCE','Dédouanement','Customs Clearance','DEBOURS','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,ALL_AIR,CUSTOMS,HINT}'),
 ('CUSTOMS_FORMALITIES','Formalités douanières','Customs Formalities','DEBOURS','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,ALL_AIR,CUSTOMS,HINT}'),
 ('CUSTOMS_LIQUIDATION','Liquidation douanière','Customs Liquidation','DEBOURS','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,ALL_AIR,CUSTOMS}'),
 ('CUSTOMS_VALUATION','Évaluation en douane','Customs Valuation','DEBOURS','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,ALL_AIR,CUSTOMS}'),
 ('DECLARATION_PROCESSING','Traitement de la déclaration','Declaration Processing','DEBOURS','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,ALL_AIR,CUSTOMS}'),
 ('IMPORT_DECLARATION','Déclaration d''importation','Import Declaration','DEBOURS','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{SEA_IMP,AIR_IMP,CUSTOMS,E2E_SEA,E2E_AIR}'),
 ('EXPORT_DECLARATION','Déclaration d''exportation','Export Declaration','DEBOURS','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{SEA_EXP,AIR_EXP,CUSTOMS,E2E_SEA,E2E_AIR}'),
 ('TRANSIT_TITLE_T1','Titre de transit (T1)','Transit Title (T1)','DEBOURS','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{HINT,CUSTOMS}'),
 ('TEL_TRANSIT','Transit TEL','TEL Transit','DEBOURS','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{HINT}'),
 ('CAR_CHAD_DECLARATION','Déclaration RCA / Tchad','CAR and Chad Declaration','DEBOURS','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{HINT}'),
 ('FINAL_DESTINATION_CLEARANCE','Dédouanement à destination finale','Final Destination Clearance','DEBOURS','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{HINT,E2E_SEA,E2E_AIR}'),
 ('HINTERLAND_TRANSPORT_DOCS','Documents de transport hinterland','Hinterland Transport Documents','DEBOURS','DOCUMENTATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{HINT}'),
 ('BORDER_CROSSING_FORMALITIES','Formalités de passage frontalier','Border Crossing Formalities','DEBOURS','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{HINT}'),
 ('TRANSIT_GUARANTEE','Garantie de transit','Transit Guarantee','DEBOURS','CUSTOMS_DUTIES','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{HINT,CUSTOMS}'),
 ('GPS_ESCORT_TRANSIT','GPS et escorte de transit','Transit GPS and Escort','DEBOURS','ESCORT','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{HINT}'),
 ('CUSTOMS_ESCORT','Escorte douanière','Customs Escort','DEBOURS','ESCORT','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{HINT,CUSTOMS,PROJECT}'),
 ('CORRIDOR_TRANSPORT','Transport corridor','Corridor Transport','DEBOURS','TRUCKING','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','NONE',NULL,'{HINT}'),
 ('POA_AUTHENTICATION','Authentification de la procuration','Power-of-Attorney Authentication','DEBOURS','DOCUMENTATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,ALL_AIR,CUSTOMS}'),
 ('GUARANTEE_LETTER_AUTH','Authentification de la lettre de garantie','Guarantee Letter Authentication','DEBOURS','DOCUMENTATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,ALL_AIR,CUSTOMS}'),
 ('IMPORT_FORMALITIES','Formalités d''importation','Import Formalities','DEBOURS','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{SEA_IMP,AIR_IMP,CUSTOMS,E2E_SEA,E2E_AIR}'),
 ('EXPORT_FORMALITIES','Formalités d''exportation','Export Formalities','DEBOURS','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{SEA_EXP,AIR_EXP,CUSTOMS,E2E_SEA,E2E_AIR}'),
 ('STAMP_DUTY','Timbre fiscal','Stamp Duty','DEBOURS','CUSTOMS_DUTIES','ANY_OPERATIONS','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_OPS}'),
 ('GUCE_FEES','Frais GUCE (guichet unique)','GUCE Single-Window Fees','DEBOURS','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,ALL_AIR,CUSTOMS}'),
 ('ECTN_BESC','BESC / ECTN','Electronic Cargo Tracking Note (ECTN/BESC)','DEBOURS','DECLARATION','SERVICE_SCOPED','BL',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,CUSTOMS}'),
 ('TRANSSHIPMENT_FORMALITIES','Formalités de transbordement','Transshipment Formalities','DEBOURS','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,ALL_AIR,CUSTOMS,HINT}'),
 ('CERTIFICATE_OF_CONFORMITY','Certificat de conformité','Certificate of Conformity','DEBOURS','DOCUMENTATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,ALL_AIR,CUSTOMS}'),
 ('CERTIFICATE_OF_ORIGIN','Certificat d''origine','Certificate of Origin','DEBOURS','DOCUMENTATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,ALL_AIR,CUSTOMS}'),
 ('PHYTOSANITARY_CERTIFICATE','Certificat phytosanitaire','Phytosanitary Certificate','DEBOURS','DOCUMENTATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,ALL_AIR,CUSTOMS}'),
 ('SANITARY_CERTIFICATE','Certificat sanitaire et vétérinaire','Sanitary and Veterinary Certificate','DEBOURS','DOCUMENTATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,ALL_AIR,CUSTOMS}'),
 ('EXEMPTION_CERTIFICATE','Certificat d''exonération','Exemption Certificate','DEBOURS','DOCUMENTATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,ALL_AIR,CUSTOMS}'),
 ('IMPORT_LICENCE','Licence d''importation','Import Licence','DEBOURS','DOCUMENTATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{SEA_IMP,AIR_IMP,CUSTOMS}'),
 ('DANGEROUS_GOODS_DECLARATION','Déclaration de marchandises dangereuses','Dangerous Goods Declaration','DEBOURS','DOCUMENTATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,ALL_AIR,PROJECT}'),
 ('CONSULAR_FEES','Frais consulaires','Consular Fees','DEBOURS','DOCUMENTATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,ALL_AIR}'),
 ('CUSTOMS_INSPECTION','Inspection douanière','Customs Inspection','DEBOURS','CUSTOMS_INSPECTION','SERVICE_SCOPED',NULL,true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,ALL_AIR,CUSTOMS,HINT}'),
 ('QUALITY_INSPECTION','Inspection qualité (SGS)','Quality Inspection (SGS)','DEBOURS','CUSTOMS_INSPECTION','SERVICE_SCOPED','DOSSIER',true,'THIRD_PARTY_VENDOR','NONE',NULL,'{ALL_SEA,ALL_AIR,CUSTOMS}'),
 ('RADIATION_CONTROL','Contrôle de radioactivité','Radiation Control','DEBOURS','CUSTOMS_INSPECTION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,CUSTOMS}'),
 ('LABORATORY_ANALYSIS','Analyse en laboratoire','Laboratory Analysis','DEBOURS','CUSTOMS_INSPECTION','SERVICE_SCOPED','DOSSIER',true,'THIRD_PARTY_VENDOR','NONE',NULL,'{ALL_SEA,ALL_AIR,CUSTOMS}'),
 ('FUMIGATION','Fumigation','Fumigation','DEBOURS','CUSTOMS_INSPECTION','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','NONE',NULL,'{ALL_SEA,WHS,CUSTOMS}'),
 ('CUSTOMS_BOND','Caution douanière','Customs Bond','DEBOURS','CUSTOMS_DUTIES','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,ALL_AIR,CUSTOMS,HINT}'),
 ('GUARANTEE_ACCOUNT_FEES','Frais de compte de garantie','Guarantee Account Fees','DEBOURS','CUSTOMS_DUTIES','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,ALL_AIR,CUSTOMS,HINT}'),
 ('LATE_MANIFEST_PENALTY','Pénalité de manifeste tardif','Late Manifest Penalty','DEBOURS','CUSTOMS_DUTIES','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,ALL_AIR}'),
 ('CUSTOMS_PENALTY','Amende douanière','Customs Penalty','DEBOURS','CUSTOMS_DUTIES','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,ALL_AIR,CUSTOMS,HINT}'),
 ('CUSTOMS_DISPUTE_HANDLING','Traitement du contentieux douanier','Customs Dispute Handling','DEBOURS','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{ALL_SEA,ALL_AIR,CUSTOMS,HINT}'),
 ('DOMICILIATION_FEES','Frais de domiciliation bancaire','Bank Domiciliation Fees','DEBOURS','BANK_FINANCE','SERVICE_SCOPED','DOSSIER',true,'THIRD_PARTY_VENDOR','NONE',NULL,'{ALL_SEA,ALL_AIR,CUSTOMS}')
ON CONFLICT (key) DO NOTHING;

-- Inland, delivery, warehousing pass-throughs and the origin/destination pair.
INSERT INTO _dict_seed (key,label_fr,label_en,direction,subcategory,applicability_mode,unit_of_measure,is_billable,proof_source,vat,account,svc) VALUES
 ('ORIGIN_CHARGES','Frais à l''origine','Origin Charges','DEBOURS','OCEAN_FREIGHT','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','NONE',NULL,'{ALL_SEA,ALL_AIR,PROJECT}'),
 ('FINAL_DESTINATION_CHARGES','Frais à destination finale','Final Destination Charges','DEBOURS','OCEAN_FREIGHT','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','NONE',NULL,'{ALL_SEA,ALL_AIR,HINT,PROJECT}'),
 ('INLAND_FREIGHT','Transport terrestre','Inland Freight','DEBOURS','TRUCKING','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','NONE',NULL,'{ALL_SEA,ALL_AIR,INLAND,HINT}'),
 ('LOCAL_TRUCKING','Camionnage local','Local Trucking','DEBOURS','TRUCKING','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','NONE',NULL,'{ALL_SEA,ALL_AIR,INLAND}'),
 ('LOADING_ON_TRUCK','Chargement sur camion','Loading on Truck','DEBOURS','HANDLING','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','NONE',NULL,'{INLAND,ALL_SEA,WHS,PROJECT}'),
 ('OFFLOADING','Déchargement','Offloading','DEBOURS','HANDLING','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','NONE',NULL,'{INLAND,ALL_SEA,WHS,PROJECT}'),
 ('DELIVERY_AT_DESTINATION','Livraison à destination','Delivery at Destination','DEBOURS','TRUCKING','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','NONE',NULL,'{ALL_AIR,ALL_SEA,INLAND}'),
 ('CARGO_PICKUP','Enlèvement de la marchandise','Cargo Pick-Up','DEBOURS','TRUCKING','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','NONE',NULL,'{ALL_AIR,ALL_SEA,INLAND}'),
 ('OWN_WHEEL_TRANSPORT','Transport par roulage (own wheel)','Own Wheel Transportation','DEBOURS','TRUCKING','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','NONE',NULL,'{PROJECT,INLAND}'),
 ('TRUCK_WAITING_TIME','Temps d''attente camion','Truck Waiting Time','DEBOURS','TRUCKING','SERVICE_SCOPED','DAY',true,'THIRD_PARTY_VENDOR','NONE',NULL,'{INLAND,HINT,ALL_SEA}'),
 ('WEIGHBRIDGE_FEES','Frais de pont-bascule','Weighbridge Fees','DEBOURS','TRUCKING','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','NONE',NULL,'{INLAND,HINT}'),
 ('PARKING_YARD_FEES','Frais de stationnement et de parc','Parking and Yard Fees','DEBOURS','TRUCKING','SERVICE_SCOPED','DAY',true,'THIRD_PARTY_VENDOR','NONE',NULL,'{INLAND,HINT}'),
 ('RAIL_TRANSPORT','Transport ferroviaire','Rail Transport','DEBOURS','RAIL','SERVICE_SCOPED','TON',true,'THIRD_PARTY_VENDOR','NONE',NULL,'{HINT,INLAND,ALL_SEA}'),
 ('SPECIAL_ROUTE_PERMIT','Autorisation de transport exceptionnel','Special Route Permit','DEBOURS','ESCORT','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{PROJECT,INLAND,HINT}'),
 ('LOCAL_INSURANCE','Assurance locale','Local Insurance','DEBOURS','OTHER','ANY_OPERATIONS','DOSSIER',true,'THIRD_PARTY_VENDOR','NONE',NULL,'{ALL_OPS}'),
 ('CARGO_INSURANCE_PREMIUM','Prime d''assurance marchandise','Cargo Insurance Premium','DEBOURS','OTHER','ANY_OPERATIONS','DOSSIER',true,'THIRD_PARTY_VENDOR','NONE',NULL,'{ALL_OPS}'),
 ('DRAFT_SURVEY','Expertise de tirant d''eau','Draft Survey','DEBOURS','SURVEY','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','NONE',NULL,'{ALL_SEA,PROJECT}'),
 ('BONDED_WAREHOUSE_ENTRY','Frais d''entrée en entrepôt sous douane','Bonded Warehouse Entry Fees','DEBOURS','STORAGE','SERVICE_SCOPED','UNIT',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{WHS,CUSTOMS,ALL_SEA}'),
 ('BONDED_WAREHOUSE_STORAGE','Magasinage sous douane','Bonded Warehouse Storage','DEBOURS','STORAGE','SERVICE_SCOPED','DAY',true,'GOVERNMENT_AUTHORITY','NONE',NULL,'{WHS,CUSTOMS,ALL_SEA}'),
 ('PALLETISATION','Palettisation','Palletisation','DEBOURS','HANDLING','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','NONE',NULL,'{WHS,ALL_AIR}'),
 ('SHRINK_WRAPPING','Filmage','Shrink Wrapping','DEBOURS','HANDLING','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','NONE',NULL,'{WHS}'),
 ('LABELLING_MARKING','Étiquetage et marquage','Labelling and Marking','DEBOURS','HANDLING','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','NONE',NULL,'{WHS,ALL_AIR}'),
 ('DOCUMENT_COURIER','Envoi de documents (courrier express)','Document Courier','DEBOURS','DOCUMENTATION','ANY_OPERATIONS','DOSSIER',true,'THIRD_PARTY_VENDOR','NONE',NULL,'{ALL_OPS}'),
 ('DOCUMENT_TRANSLATION','Traduction et légalisation de documents','Document Translation and Legalisation','DEBOURS','DOCUMENTATION','ANY_OPERATIONS','DOSSIER',true,'THIRD_PARTY_VENDOR','NONE',NULL,'{ALL_OPS}')
ON CONFLICT (key) DO NOTHING;

-- ── 6. Derived attributes on the staging set ────────────────────────────────

-- Variant-bearing lines: the families the legacy set duplicated per box size.
-- One line each, priced per CONTAINER_TYPE on the Expense-Rate tab.
UPDATE _dict_seed SET varies = true, description =
  'Ligne à variantes : le tarif dépend du type d''équipement (voir registre CONTAINER_TYPE). '
  || 'Variant-bearing line: the rate depends on the equipment type, priced per variant on the Expense-Rate tab. '
  || 'Remplace les anciennes lignes 20 pieds / 40 pieds / Open Top / Flat Rack.'
 WHERE key IN (
   'PORT_CHARGES','THC','STEVEDORING','DEMURRAGE','YARD_OCCUPANCY','SECURITY_FEES',
   'CONTAINER_MAINTENANCE','EMPTY_CONTAINER_HANDLING','FULL_CONTAINER_HANDLING',
   'PAD_FEES','PAK_FEES','SCANNING_FEES','CUSTOMS_INSPECTION','SHIPPING_LINE_CHARGES',
   'OCEAN_FREIGHT','ORIGIN_CHARGES','FINAL_DESTINATION_CHARGES');

-- Merge provenance, recorded where the next person will look for it: the legacy
-- name they remember has to lead them to the surviving line.
UPDATE _dict_seed SET description =
  'Fusion des anciennes lignes "BL Fees & Stamp" et "Documentation Fee" (toutes deux "Frais de dossier"). '
  || 'Merged from the legacy BL Fees and Stamp / Documentation Fee pair.'
 WHERE key = 'DOCUMENTATION_FEE';
UPDATE _dict_seed SET description =
  'Fusion de "Inland Freight", "Inland Freight Origin" et "Local Charges Origin" — l''origine est une variante du tarif, pas une ligne distincte. '
  || 'Merged from Inland Freight / Inland Freight Origin / Local Charges Origin — origin is a rate variant, not a separate line.'
 WHERE key = 'INLAND_FREIGHT';
UPDATE _dict_seed SET description =
  'Fusion des trois anciennes lignes de formalités de transbordement. Merged from the three legacy transshipment rows.'
 WHERE key = 'TRANSSHIPMENT_FORMALITIES';
UPDATE _dict_seed SET description =
  'Inclut l''ancienne ligne "XCMG Crane" (transport par roulage sur cargaison spéciale). Includes the legacy XCMG Crane row.'
 WHERE key = 'OWN_WHEEL_TRANSPORT';
UPDATE _dict_seed SET description =
  'Paiement de facilitation lors de la négociation douanière : charge interne, jamais refacturée au client. '
  || 'Facilitation payment during customs negotiation: an internal cost, never re-billed.'
 WHERE key = 'FACILITY_PAYMENT';
UPDATE _dict_seed SET description =
  'Remboursable : comptabilisée en dépôt (classe 2), pas en charge. Refundable, carried as a deposit and not as a period cost.'
 WHERE key IN ('BANK_CAUTION','PERMANENT_DEPOSIT_FEES');

-- The long tail. Everything not named in a BASIC set defaults to ADVANCED;
-- these are the lines that only appear on an unusual file, so FULL.
UPDATE _dict_seed SET tier_default = 'FULL' WHERE key IN (
  'WAR_RISK_SURCHARGE','CONGESTION_SURCHARGE','EQUIPMENT_IMBALANCE_SURCHARGE',
  'PEAK_SEASON_SURCHARGE','LOW_SULPHUR_SURCHARGE','SWITCH_BL','TELEX_RELEASE',
  'CHANGE_OF_DESTINATION','SHIPPING_GUARANTEE','DOCUMENTATION_AMENDMENT',
  'CONTAINER_LEASING','CONTAINER_SEAL','CONTAINER_CLEANING','CONTAINER_REPAIR',
  'REEFER_PLUG_IN','REEFER_MONITORING','TALLY_SERVICES','DEPOT_HANDLING',
  'PORT_ACCESS_BADGE','PORT_SECURITY_ESCORT','TERMINAL_GATE_FEES','WHARFAGE',
  'EXCISE_DUTY','CUSTOMS_LIQUIDATION','CUSTOMS_VALUATION','LATE_MANIFEST_PENALTY',
  'CUSTOMS_PENALTY','CUSTOMS_DISPUTE_HANDLING','CONSULAR_FEES','IMPORT_LICENCE',
  'DANGEROUS_GOODS_DECLARATION','LABORATORY_ANALYSIS','RADIATION_CONTROL',
  'FUMIGATION','PHYTOSANITARY_CERTIFICATE','SANITARY_CERTIFICATE',
  'EXEMPTION_CERTIFICATE','CERTIFICATE_OF_ORIGIN','POA_AUTHENTICATION',
  'GUARANTEE_LETTER_AUTH','DOMICILIATION_FEES','DOCUMENT_COURIER',
  'DOCUMENT_TRANSLATION','TRUCK_WAITING_TIME','WEIGHBRIDGE_FEES',
  'PARKING_YARD_FEES','RAIL_TRANSPORT','DRAFT_SURVEY','PALLETISATION',
  'SHRINK_WRAPPING','LABELLING_MARKING','EMPTY_CONTAINER_RETURN',
  'AIRPORT_SECURITY_SCREENING','CARRIER_ADMIN_FEE','FX_COMMISSION',
  'WIRE_TRANSFER_FEES','EXTRA_LEGAL_WORK','REPACKAGING','ORDER_PICKING');

-- ── 7. Mint the codes ───────────────────────────────────────────────────────
-- "#<L><NNN>", L from direction, serial per letter — the same format
-- financial_dictionary.rules.formatCode mints at runtime, so the service layer
-- picks up numbering after the seed instead of colliding with it.
UPDATE _dict_seed s SET code = m.new_code
  FROM (
    SELECT key,
           '#' || CASE direction
                    WHEN 'REVENUE' THEN 'R' WHEN 'EXPENSE' THEN 'E'
                    WHEN 'DEBOURS' THEN 'D' ELSE 'A' END
               || lpad((row_number() OVER (PARTITION BY direction ORDER BY label_en))::text, 3, '0') AS new_code
      FROM _dict_seed
  ) m
 WHERE m.key = s.key;

-- ── 8. The catalogue rows ───────────────────────────────────────────────────
-- category, is_debours, provider_kind and the proof obligations are DERIVED, so
-- they cannot drift from the direction the line was authored with.
--
--   provider_kind ← proof_source (a carrier proves a carrier charge)
--   receipt/justification ← direction: money advanced for a client (DEBOURS) or
--     parked as a deposit (ASSET) always needs its supporting document, because
--     it is the only evidence the amount was not yours to keep. An overhead is
--     conditional, your own fee needs none.
INSERT INTO dictionary_item (
  code, label_fr, label_en, description, category, direction, subcategory,
  unit_of_measure, applicability_mode, is_debours, is_billable, currency,
  provider_kind, proof_source, requires_justification, receipt_requirement,
  debours_vat_transparent, varies_by_equipment, is_active)
SELECT
  s.code, s.label_fr, s.label_en, s.description,
  CASE s.direction WHEN 'DEBOURS' THEN 'debours' WHEN 'REVENUE' THEN 'service'
                   WHEN 'ASSET' THEN 'asset' ELSE 'overhead' END,
  s.direction, s.subcategory, s.unit_of_measure, s.applicability_mode,
  s.direction = 'DEBOURS', s.is_billable, 'XAF',
  CASE s.proof_source
    WHEN 'CARRIER_AIRLINE' THEN 'SHIPPING_LINE'
    WHEN 'PORT_TERMINAL' THEN 'PORT_TERMINAL'
    WHEN 'GOVERNMENT_AUTHORITY' THEN 'CUSTOMS_AUTHORITY'
    ELSE 'OTHER' END,
  s.proof_source,
  s.direction IN ('DEBOURS','ASSET') OR s.key IN ('MISSION_ALLOWANCE','DRIVER_ALLOWANCE','FACILITY_PAYMENT'),
  CASE
    WHEN s.direction IN ('DEBOURS','ASSET') THEN 'ALWAYS_REQUIRED'
    WHEN s.direction = 'EXPENSE' THEN 'CONDITIONALLY_REQUIRED'
    ELSE 'NOT_REQUIRED' END,
  s.direction = 'DEBOURS', s.varies, true
  FROM _dict_seed s
ON CONFLICT (code) DO NOTHING;

-- ── 9. Posting rules, generated by direction ────────────────────────────────
-- The NOT EXISTS guard is the idempotency key posting_rule does not have: the
-- table has no natural unique constraint (an item legitimately carries a sale
-- AND a purchase rule), so "already has a rule in this context" is the test.

-- DEBOURS, purchase leg: the supplier invoice lands in the client's clearing
-- account, never in a class-6 charge. No tax code — §23.5.
INSERT INTO posting_rule (dictionary_item_id, applies_context, debit_account, credit_account, tax_code_id, is_debours)
SELECT di.dictionary_item_id, 'purchase', '4731', '4011', NULL, true
  FROM _dict_seed s
  JOIN dictionary_item di ON di.code = s.code
 WHERE s.direction = 'DEBOURS'
   AND NOT EXISTS (SELECT 1 FROM posting_rule pr
                    WHERE pr.dictionary_item_id = di.dictionary_item_id
                      AND pr.applies_context = 'purchase')
ON CONFLICT DO NOTHING;

-- DEBOURS, sale leg: re-billed at cost, clearing 4731 back out against the
-- client. Nothing touches class 7, because none of it is revenue.
INSERT INTO posting_rule (dictionary_item_id, applies_context, debit_account, credit_account, tax_code_id, is_debours)
SELECT di.dictionary_item_id, 'sale', '4111', '4731', NULL, true
  FROM _dict_seed s
  JOIN dictionary_item di ON di.code = s.code
 WHERE s.direction = 'DEBOURS'
   AND NOT EXISTS (SELECT 1 FROM posting_rule pr
                    WHERE pr.dictionary_item_id = di.dictionary_item_id
                      AND pr.applies_context = 'sale')
ON CONFLICT DO NOTHING;

-- REVENUE: your fee, invoiced with output VAT (or zero-rated on an export of
-- services). The credit account comes from the staging row — 7061 commission,
-- 7071 re-billed ancillaries, 7063 logistics services sold.
INSERT INTO posting_rule (dictionary_item_id, applies_context, debit_account, credit_account, tax_code_id, is_debours)
SELECT di.dictionary_item_id, 'sale', '4111', s.account, t.tax_code_id, false
  FROM _dict_seed s
  JOIN dictionary_item di ON di.code = s.code
  LEFT JOIN _tax_ref t ON t.name = CASE s.vat WHEN 'ZERO' THEN 'TVA_EXPORT' WHEN 'STD' THEN 'TVA_STD' ELSE NULL END
 WHERE s.direction = 'REVENUE'
   AND NOT EXISTS (SELECT 1 FROM posting_rule pr
                    WHERE pr.dictionary_item_id = di.dictionary_item_id
                      AND pr.applies_context = 'sale')
ON CONFLICT DO NOTHING;

-- EXPENSE: your own cost against the supplier, with recoverable input VAT where
-- the charge carries it. Transport inputs use TVA_INPUT_TRANSPORT so the
-- recoverable side lands on 4453 rather than 4452.
INSERT INTO posting_rule (dictionary_item_id, applies_context, debit_account, credit_account, tax_code_id, is_debours)
SELECT di.dictionary_item_id, 'purchase', s.account, '4011', t.tax_code_id, false
  FROM _dict_seed s
  JOIN dictionary_item di ON di.code = s.code
  LEFT JOIN _tax_ref t ON t.name = CASE s.vat WHEN 'STD' THEN 'TVA_INPUT_PURCH' WHEN 'STD_T' THEN 'TVA_INPUT_TRANSPORT' ELSE NULL END
 WHERE s.direction = 'EXPENSE'
   AND NOT EXISTS (SELECT 1 FROM posting_rule pr
                    WHERE pr.dictionary_item_id = di.dictionary_item_id
                      AND pr.applies_context = 'purchase')
ON CONFLICT DO NOTHING;

-- ASSET: a refundable deposit is a class-2 balance, no VAT to recover on it.
INSERT INTO posting_rule (dictionary_item_id, applies_context, debit_account, credit_account, tax_code_id, is_debours)
SELECT di.dictionary_item_id, 'purchase', s.account, '4011', NULL, false
  FROM _dict_seed s
  JOIN dictionary_item di ON di.code = s.code
 WHERE s.direction = 'ASSET'
   AND NOT EXISTS (SELECT 1 FROM posting_rule pr
                    WHERE pr.dictionary_item_id = di.dictionary_item_id
                      AND pr.applies_context = 'purchase')
ON CONFLICT DO NOTHING;

-- ── 10. Service tiers ───────────────────────────────────────────────────────
-- BASIC is the everyday file: the lines that appear on almost every dossier of
-- that service, so a quote built at BASIC is already a usable quote. ADVANCED
-- adds what the same service needs when the file is not routine, FULL is the
-- long tail. The sets NEST (0630): pulling ADVANCED yields BASIC + ADVANCED.
INSERT INTO _dict_basic (service_key, item_key) VALUES
 ('SEA_FREIGHT_IMPORT','OCEAN_FREIGHT'),('SEA_FREIGHT_IMPORT','THC'),
 ('SEA_FREIGHT_IMPORT','PORT_CHARGES'),('SEA_FREIGHT_IMPORT','CUSTOMS_DUTIES_TAXES'),
 ('SEA_FREIGHT_IMPORT','CUSTOMS_CLEARANCE'),('SEA_FREIGHT_IMPORT','DOCUMENTATION_FEE'),
 ('SEA_FREIGHT_IMPORT','INLAND_FREIGHT'),('SEA_FREIGHT_IMPORT','FILE_OPENING'),
 ('SEA_FREIGHT_EXPORT','OCEAN_FREIGHT'),('SEA_FREIGHT_EXPORT','THC'),
 ('SEA_FREIGHT_EXPORT','PORT_CHARGES'),('SEA_FREIGHT_EXPORT','STUFFING'),
 ('SEA_FREIGHT_EXPORT','WEIGHING'),('SEA_FREIGHT_EXPORT','CUSTOMS_FORMALITIES'),
 ('SEA_FREIGHT_EXPORT','DOCUMENTATION_FEE'),('SEA_FREIGHT_EXPORT','FILE_OPENING'),
 ('AIR_FREIGHT_IMPORT','AWB_FEE'),('AIR_FREIGHT_IMPORT','AIR_CARGO_HANDLING'),
 ('AIR_FREIGHT_IMPORT','CUSTOMS_DUTIES_TAXES'),('AIR_FREIGHT_IMPORT','CUSTOMS_CLEARANCE'),
 ('AIR_FREIGHT_IMPORT','DELIVERY_AT_DESTINATION'),('AIR_FREIGHT_IMPORT','FILE_OPENING'),
 ('AIR_FREIGHT_EXPORT','AWB_FEE'),('AIR_FREIGHT_EXPORT','AIR_CARGO_HANDLING'),
 ('AIR_FREIGHT_EXPORT','CUSTOMS_FORMALITIES'),('AIR_FREIGHT_EXPORT','DOCUMENTATION_FEE'),
 ('AIR_FREIGHT_EXPORT','CARGO_PICKUP'),('AIR_FREIGHT_EXPORT','FILE_OPENING'),
 ('HINTERLAND_TRANSIT','TRANSIT_TITLE_T1'),('HINTERLAND_TRANSIT','TEL_TRANSIT'),
 ('HINTERLAND_TRANSIT','GPS_ESCORT_TRANSIT'),('HINTERLAND_TRANSIT','BORDER_CROSSING_FORMALITIES'),
 ('HINTERLAND_TRANSIT','CORRIDOR_TRANSPORT'),('HINTERLAND_TRANSIT','CUSTOMS_FORMALITIES'),
 ('INLAND_TRANSPORTATION','HAULAGE_PER_KM'),('INLAND_TRANSPORTATION','LOADING_ON_TRUCK'),
 ('INLAND_TRANSPORTATION','OFFLOADING'),('INLAND_TRANSPORTATION','TOLLS_ROAD_FEES'),
 ('INLAND_TRANSPORTATION','WEIGHING'),
 ('WAREHOUSING','WAREHOUSE_STORAGE_DAY'),('WAREHOUSING','WAREHOUSE_HANDLING_IN'),
 ('WAREHOUSING','WAREHOUSE_HANDLING_OUT'),('WAREHOUSING','INVENTORY_MANAGEMENT'),
 ('WAREHOUSING','STOCK_INSURANCE'),
 ('CUSTOMS_BROKERAGE','CUSTOMS_CLEARANCE'),('CUSTOMS_BROKERAGE','CUSTOMS_FORMALITIES'),
 ('CUSTOMS_BROKERAGE','CUSTOMS_DUTIES_TAXES'),('CUSTOMS_BROKERAGE','GUCE_FEES'),
 ('CUSTOMS_BROKERAGE','ECTN_BESC'),('CUSTOMS_BROKERAGE','IMPORT_DECLARATION'),
 ('PROJECT_CARGO','CRANE_LIFTING'),('PROJECT_CARGO','HEAVY_LIFT_ESCORT'),
 ('PROJECT_CARGO','MARINE_CARGO_SURVEY'),('PROJECT_CARGO','SPECIAL_ROUTE_PERMIT'),
 ('PROJECT_CARGO','OOG_SURCHARGE'),('PROJECT_CARGO','OWN_WHEEL_TRANSPORT'),
 ('END_TO_END_SEA_FREIGHT','ORIGIN_CHARGES'),('END_TO_END_SEA_FREIGHT','OCEAN_FREIGHT'),
 ('END_TO_END_SEA_FREIGHT','THC'),('END_TO_END_SEA_FREIGHT','PORT_CHARGES'),
 ('END_TO_END_SEA_FREIGHT','CUSTOMS_DUTIES_TAXES'),('END_TO_END_SEA_FREIGHT','CUSTOMS_CLEARANCE'),
 ('END_TO_END_SEA_FREIGHT','FINAL_DESTINATION_CHARGES'),('END_TO_END_SEA_FREIGHT','FINAL_DESTINATION_CLEARANCE'),
 ('END_TO_END_SEA_FREIGHT','INLAND_FREIGHT'),('END_TO_END_SEA_FREIGHT','DELIVERY_AT_DESTINATION'),
 ('END_TO_END_SEA_FREIGHT','DOCUMENTATION_FEE'),('END_TO_END_SEA_FREIGHT','FILE_OPENING'),
 ('END_TO_END_AIR_FREIGHT','ORIGIN_CHARGES'),('END_TO_END_AIR_FREIGHT','AIR_FREIGHT'),
 ('END_TO_END_AIR_FREIGHT','AWB_FEE'),('END_TO_END_AIR_FREIGHT','AIR_CARGO_HANDLING'),
 ('END_TO_END_AIR_FREIGHT','CUSTOMS_DUTIES_TAXES'),('END_TO_END_AIR_FREIGHT','CUSTOMS_CLEARANCE'),
 ('END_TO_END_AIR_FREIGHT','FINAL_DESTINATION_CHARGES'),('END_TO_END_AIR_FREIGHT','DELIVERY_AT_DESTINATION'),
 ('END_TO_END_AIR_FREIGHT','DOCUMENTATION_FEE'),('END_TO_END_AIR_FREIGHT','FILE_OPENING'),
 ('BUSINESS_REPRESENTATION','FILE_OPENING'),('BUSINESS_REPRESENTATION','SERVICE_CHARGES'),
 ('BUSINESS_REPRESENTATION','DOCUMENTATION_FEE'),('BUSINESS_REPRESENTATION','EXTRA_LEGAL_WORK'),
 ('BUSINESS_REPRESENTATION','DISBURSEMENT_COMMISSION')
ON CONFLICT (service_key, item_key) DO NOTHING;

INSERT INTO service_type_dictionary_item (service_type_id, dictionary_item_id, tier, sort_order)
SELECT st.service_type_id, di.dictionary_item_id, x.tier,
       CASE x.tier WHEN 'BASIC' THEN 100 WHEN 'ADVANCED' THEN 300 ELSE 500 END
         + row_number() OVER (PARTITION BY x.service_key, x.tier ORDER BY x.label_en)
  FROM (
    SELECT DISTINCT g.service_key,
           s.key AS item_key,
           s.label_en,
           CASE WHEN b.item_key IS NOT NULL THEN 'BASIC' ELSE s.tier_default END AS tier
      FROM _dict_seed s
      CROSS JOIN LATERAL unnest(s.svc) AS tok(token)
      JOIN _svc_group g ON g.token = tok.token
      LEFT JOIN _dict_basic b ON b.service_key = g.service_key AND b.item_key = s.key
  ) x
  JOIN service_type st ON st.key = x.service_key
  JOIN _dict_seed s2 ON s2.key = x.item_key
  JOIN dictionary_item di ON di.code = s2.code
ON CONFLICT (service_type_id, dictionary_item_id) DO NOTHING;

-- service_type_key is the denormalised single-value hint 0630 kept alive for the
-- Service-Type 360 until PR2 finishes cutting it over to the join. Keep it in
-- step with the tiers rather than leaving it null: the first BASIC service of a
-- line is the one that answers "which service is this mainly for?", which is
-- exactly what financial_dictionary.rules.primaryServiceKey computes at runtime.
UPDATE dictionary_item di SET service_type_key = p.service_key
  FROM (
    SELECT DISTINCT ON (stdi.dictionary_item_id)
           stdi.dictionary_item_id, st.key AS service_key
      FROM service_type_dictionary_item stdi
      JOIN service_type st ON st.service_type_id = stdi.service_type_id
     ORDER BY stdi.dictionary_item_id,
              CASE stdi.tier WHEN 'BASIC' THEN 1 WHEN 'ADVANCED' THEN 2 ELSE 3 END,
              st.key
  ) p
 WHERE p.dictionary_item_id = di.dictionary_item_id
   AND di.service_type_key IS NULL
   AND di.code IN (SELECT code FROM _dict_seed);

-- ── 11. Guard rail ──────────────────────────────────────────────────────────
-- The §23.14 invariant is a DEFERRABLE trigger that fires at COMMIT, which is
-- correct but reports one item at a time and only once the whole file has run.
-- This says the same thing immediately, naming the line, so a mis-typed account
-- family in a future edit fails here with something a reader can act on.
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(s.code || ' ' || s.label_en, ', ' ORDER BY s.code) INTO missing
    FROM _dict_seed s
    JOIN dictionary_item di ON di.code = s.code
   WHERE NOT EXISTS (SELECT 1 FROM posting_rule pr
                      WHERE pr.dictionary_item_id = di.dictionary_item_id
                        AND pr.debit_account IS NOT NULL
                        AND pr.credit_account IS NOT NULL);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'seed 9080: dictionary lines left without a complete posting rule: %', missing;
  END IF;
END $$;

-- DOWN
-- Reference data, every insert conflict-guarded, nothing overwritten. Undoing
-- it means deleting rows that operational documents may already point at, so
-- there is no safe automation here — the order below is the dependency order a
-- human would follow, and each step must be checked for references first.
--
--   DELETE FROM service_type_dictionary_item WHERE dictionary_item_id IN
--     (SELECT dictionary_item_id FROM dictionary_item WHERE code ~ '^#[RDEA][0-9]+$');
--   DELETE FROM posting_rule WHERE dictionary_item_id IN
--     (SELECT dictionary_item_id FROM dictionary_item WHERE code ~ '^#[RDEA][0-9]+$');
--   DELETE FROM dictionary_item WHERE code ~ '^#[RDEA][0-9]+$'
--     AND NOT EXISTS (SELECT 1 FROM journal_line jl WHERE jl.dictionary_item_id = dictionary_item.dictionary_item_id)
--     AND NOT EXISTS (SELECT 1 FROM costing_line cl WHERE cl.dictionary_item_id = dictionary_item.dictionary_item_id);
--   DELETE FROM service_type WHERE is_system AND key IN
--     ('SEA_FREIGHT_IMPORT','SEA_FREIGHT_EXPORT','AIR_FREIGHT_IMPORT','AIR_FREIGHT_EXPORT',
--      'HINTERLAND_TRANSIT','INLAND_TRANSPORTATION','WAREHOUSING','END_TO_END_AIR_FREIGHT',
--      'END_TO_END_SEA_FREIGHT','BUSINESS_REPRESENTATION','CUSTOMS_BROKERAGE','PROJECT_CARGO')
--     AND NOT EXISTS (SELECT 1 FROM dossier d WHERE d.service_type_id = service_type.service_type_id);
--   DELETE FROM dictionary_ref WHERE kind IN ('CONTAINER_TYPE','LOAD_MODE');
--   DELETE FROM dictionary_ref WHERE kind = 'SUBCATEGORY' AND code IN ('BANK_FINANCE','DOCUMENTATION');
--   -- The chart-of-accounts leaves are left in place: an account referenced by
--   -- any posting rule or journal line must never be deleted, and an unused one
--   -- costs nothing. Deactivate rather than delete if they must go.
