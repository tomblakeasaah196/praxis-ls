-- ============================================================================
-- TENANT SEED — 90998 The milestone owners every tenant starts with.
--
-- Meeting 7 (1 Oct 2026), 01:57:20, and the owner's answer to Q1 of the review:
-- the registry, "but seed in more from values for all tenants". So the shipped
-- list is not the five the enum held — it is the parties a Douala forwarder
-- actually waits on, named once here so no tenant has to invent them.
--
-- ── THE FIVE THAT WERE THE ENUM COME FIRST, UNCHANGED ──────────────────────
--
-- INTERNAL, CARRIER, TERMINAL, AUTHORITY and CLIENT keep their codes, because
-- every seeded stage in 9091, 0680 and 11744 already stores one of them and the
-- attribution report already groups on them. Their names are the same strings
-- the client rendered from `OWNER_TIER_LABEL`, so nothing a person reads moves.
--
-- ── WHAT IS ADDED, AND WHY EACH ONE EARNS A ROW ────────────────────────────
--
-- The test is "does a stage wait on this party, separately from the others". A
-- row exists where the answer is yes on a real Douala / N'Djamena file:
--
--   CUSTOMS           was folded into AUTHORITY with the road and port
--                     authorities. A declaration stuck at the customs desk and
--                     an abnormal-load permit stuck at the road authority are
--                     different problems with different people to call — and
--                     the owner named exactly this split in the meeting
--                     ("permits it depends on customs so it doesn't directly
--                     depend on us").
--   ROAD_AUTHORITY    convoi exceptionnel permits, escorts, axle-load.
--   PORT_AUTHORITY    berth allocation and port formalities, which are not the
--                     terminal operator's to give.
--   SHIPPING_LINE     the one the owner reached the dropdown for: on a sea file
--                     the line issues the arrival notice and releases the
--                     container, and it is not the trucking carrier.
--   AIRLINE           the air-freight equivalent.
--   RAILWAY           CAMRAIL on the rail and rail-transit chains.
--   HAULIER           the subcontracted trucker on inland and heavy-haul legs.
--   AGENT             the counterpart forwarder at the other end.
--   WAREHOUSE         the bonded or dry warehouse keeper.
--   SURVEYOR          draft/marine survey, route survey, SGS-type inspection.
--   INSURER           cargo insurance bound — today a CLIENT stage on
--                     PROJECT_CARGO, which is only true when the client insures.
--   BANK              the domiciliation and the transfer that releases documents.
--   SUPPLIER          the shipper at origin on an import.
--   OTHER_PARTY       the honest escape hatch, so nobody mis-files a stage under
--                     a party it does not belong to while they think of a name.
--
-- `is_internal` is true for INTERNAL alone: everything else is somebody we are
-- waiting on. A tenant adding their own internal desk sets the flag themselves —
-- nothing here infers it from a name.
--
-- Idempotent and NON-DESTRUCTIVE: upserts on `code`, and a re-run never touches
-- a name a tenant has rewritten or an `is_active` they have turned off. Only
-- `sort_order`, `is_internal` and `is_system` — the three this file owns — are
-- refreshed, and the names only when the row is still exactly as shipped.
-- ============================================================================

INSERT INTO milestone_owner (code, name, name_fr, is_internal, description, sort_order, is_system) VALUES
 ('INTERNAL',       'Internal ops',        'Opérations internes',      true,  'Our own operations desk — a slip here is ours.',                            10, true),
 ('CLIENT',         'Client',              'Client',                   false, 'The client: an instruction, a document or an approval we are waiting on.',  20, true),
 ('CARRIER',        'Carrier',             'Transporteur',             false, 'The contracted carrier on the main leg.',                                   30, true),
 ('SHIPPING_LINE',  'Shipping line',       'Compagnie maritime',       false, 'Arrival notice, container release, demurrage — not the trucking carrier.',   31, true),
 ('AIRLINE',        'Airline',             'Compagnie aérienne',       false, 'Air waybill, flight confirmation, release at the airport.',                  32, true),
 ('RAILWAY',        'Railway',             'Compagnie ferroviaire',    false, 'Wagon allocation and rail movement (CAMRAIL on the Douala corridors).',      33, true),
 ('HAULIER',        'Haulier / trucker',   'Transporteur routier',     false, 'The subcontracted trucker on an inland, transit or heavy-haul leg.',         34, true),
 ('TERMINAL',       'Terminal / port',     'Terminal / port',          false, 'The terminal operator: discharge, storage, gate-out.',                       40, true),
 ('PORT_AUTHORITY', 'Port authority',      'Autorité portuaire',       false, 'Berth allocation and port formalities — not the terminal operator''s to give.', 41, true),
 ('WAREHOUSE',      'Warehouse keeper',    'Entrepositaire',           false, 'The bonded or dry warehouse holding the cargo.',                             42, true),
 ('AUTHORITY',      'Authority',           'Administration',           false, 'A public authority other than customs and the two named below.',             50, true),
 ('CUSTOMS',        'Customs',             'Douane',                   false, 'The customs desk: declaration, assessment, inspection, release.',            51, true),
 ('ROAD_AUTHORITY', 'Road authority',      'Autorité routière',        false, 'Abnormal-load permits, escorts and axle-load clearance.',                    52, true),
 ('SURVEYOR',       'Surveyor / inspector','Expert / inspecteur',      false, 'Route and marine survey, pre-shipment and quality inspection.',              60, true),
 ('INSURER',        'Insurer',             'Assureur',                 false, 'Cargo insurance bound, and a claim once one is open.',                        61, true),
 ('BANK',           'Bank',                'Banque',                   false, 'Domiciliation and the transfer that releases the documents.',                 62, true),
 ('AGENT',          'Overseas agent',      'Correspondant',            false, 'The counterpart forwarder at the other end of the lane.',                     63, true),
 ('SUPPLIER',       'Supplier / shipper',  'Fournisseur / expéditeur', false, 'The shipper at origin, on an import or a purchase we are waiting on.',        64, true),
 ('OTHER_PARTY',    'Other party',         'Autre intervenant',        false, 'A third party with no row of its own yet — add one rather than leave this.',  90, true)
ON CONFLICT (code) DO UPDATE SET
  -- The three this file owns: a shipped row stays shipped, keeps its place in the
  -- list and keeps the truth about whether it is us.
  is_internal = EXCLUDED.is_internal,
  sort_order  = EXCLUDED.sort_order,
  is_system   = true,
  -- The names and the blurb only while nobody has rewritten them. A tenant who
  -- renamed "Customs" to "Douane / SGS" keeps their wording through a re-run.
  name        = CASE WHEN milestone_owner.name    = EXCLUDED.name    THEN EXCLUDED.name    ELSE milestone_owner.name    END,
  name_fr     = CASE WHEN milestone_owner.name_fr = EXCLUDED.name_fr THEN EXCLUDED.name_fr ELSE milestone_owner.name_fr END,
  description = COALESCE(milestone_owner.description, EXCLUDED.description);

-- ── The split the owner named, applied to the chains that shipped ───────────
-- 9091 filed every customs stage under AUTHORITY because that was the only
-- value there was. Now that CUSTOMS exists, the stages whose code says customs
-- say customs — otherwise the registry is richer and the data it describes is
-- not, and the first attribution report still reads "Authority: 340 h" with no
-- way to tell a slow declaration from a permit.
--
-- Narrow on purpose: only SYSTEM stages (is_system), only codes whose own label
-- names the customs desk, and only where the owner is still the AUTHORITY the
-- seed set — a stage a tenant has already re-owned is left alone. CHECKPOINT,
-- RAIL_CHECKPOINT, BOARDING_AUTH, REGISTRATIONS and COMPLIANCE_FILING stay
-- AUTHORITY: a gendarmerie post, a civil-aviation authorisation and a statutory
-- filing are not customs.
UPDATE milestone_template_stage SET owner_tier = 'CUSTOMS'
 WHERE is_system
   AND owner_tier = 'AUTHORITY'
   AND code IN ('EXPORT_CLEARANCE','IMPORT_CLEARANCE','DEST_CLEARANCE','CUSTOMS_CLEARED',
                'CUSTOMS_RELEASED','BAE_ISSUED','CUSTOMS_INSPECTION','INSPECTION',
                'CUSTOMS_SEALED','SEALED_ESCORT','ASSESSMENT_ISSUED','T1_DISCHARGED',
                'BORDER_CROSSING');

-- And the one the owner pointed at by name: "permits it depends on customs so it
-- doesn't directly depend on us" — abnormal-load permits and escorts are issued
-- by the ROAD authority, not the customs desk, and that is the party to chase.
UPDATE milestone_template_stage SET owner_tier = 'ROAD_AUTHORITY'
 WHERE is_system
   AND owner_tier = 'AUTHORITY'
   AND code = 'PERMITS';

-- ============================================================================
-- VERIFY
--   SELECT code, name, name_fr, is_internal, sort_order FROM milestone_owner
--     ORDER BY sort_order, code;
--   SELECT owner_tier, count(*) FROM milestone_template_stage
--     GROUP BY owner_tier ORDER BY 2 DESC;
--
-- DOWN
--   -- UPDATE milestone_template_stage SET owner_tier = 'AUTHORITY'
--   --   WHERE is_system AND owner_tier IN ('CUSTOMS','ROAD_AUTHORITY');
--   -- DELETE FROM milestone_owner WHERE is_system;
-- ============================================================================
