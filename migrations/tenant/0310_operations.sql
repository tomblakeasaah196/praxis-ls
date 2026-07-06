-- ============================================================================
-- TENANT DB — 0310 operations: the dossier (heart of the system, MOD-29), the
-- configurable service taxonomy, versioned milestone templates -> insertable
-- instances (auto-recalculating due dates), transit orders, delivery notes.
-- ============================================================================

-- Services as DATA, not code (transcript §11.3). User-creatable, with applicability.
CREATE TABLE service_type (
  service_type_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key              citext UNIQUE NOT NULL,           -- 'SEA_FREIGHT_IMPORT' | 'HINTERLAND_TRANSIT'
  name_fr          text NOT NULL,
  name_en          text,
  territory        text,                             -- DOMESTIC_INLAND | INTERNATIONAL_IMPORT ...
  is_system        boolean NOT NULL DEFAULT false,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- The operations file (dossier) — the analytical cost object on every journal line.
CREATE TABLE dossier (
  dossier_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref              text UNIQUE NOT NULL,             -- 'SLAS-2026-0001'
  entity_id        uuid REFERENCES corporate_entity(entity_id),
  client_id        uuid REFERENCES client_master(client_id),
  service_type_id  uuid REFERENCES service_type(service_type_id),
  status           text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','COMPLETED','CANCELLED')),
  incoterm         text,
  bl_mawb          text,
  vessel_flight    text,
  pol              text,                             -- port of loading
  pod              text,                             -- port of discharge
  customs_regime   text,
  eta              date,
  ata              date,
  details_json     jsonb NOT NULL DEFAULT '{}'::jsonb,
  owner_ops_id     uuid REFERENCES app_user(user_id),
  owner_sales_id   uuid REFERENCES app_user(user_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Now that dossier exists, wire the analytical FKs left deferred earlier.
ALTER TABLE journal_line ADD CONSTRAINT fk_line_dossier   FOREIGN KEY (dossier_id) REFERENCES dossier(dossier_id);
ALTER TABLE advance       ADD CONSTRAINT fk_advance_dossier FOREIGN KEY (dossier_id) REFERENCES dossier(dossier_id);
ALTER TABLE invoice       ADD CONSTRAINT fk_invoice_dossier FOREIGN KEY (dossier_id) REFERENCES dossier(dossier_id);

-- Versioned milestone templates per service_type (MOD-31) --------------------
CREATE TABLE milestone_template (
  milestone_template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type_id  uuid REFERENCES service_type(service_type_id),
  version          integer NOT NULL DEFAULT 1,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_type_id, version)
);
CREATE TABLE milestone_template_stage (
  stage_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_template_id uuid NOT NULL REFERENCES milestone_template(milestone_template_id) ON DELETE CASCADE,
  stage_seq        numeric(10,4) NOT NULL,           -- numeric so a stage can be inserted BETWEEN two (e.g. 2.5)
  code             text NOT NULL,
  label_fr         text NOT NULL,
  label_en         text,
  default_offset_days integer NOT NULL DEFAULT 0     -- drives due-date recalculation
);

-- Per-dossier milestone instances; insertable between two, due dates recompute.
CREATE TABLE milestone_instance (
  milestone_instance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id       uuid NOT NULL REFERENCES dossier(dossier_id) ON DELETE CASCADE,
  stage_seq        numeric(10,4) NOT NULL,
  code             text NOT NULL,
  label            text NOT NULL,
  due_date         date,
  status           text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_PROGRESS','DONE','BLOCKED')),
  completed_at     timestamptz,
  completed_by     uuid REFERENCES app_user(user_id),
  evidence_vault_id uuid,                            -- proof upload (0340)
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_milestone_dossier ON milestone_instance(dossier_id, stage_seq);

-- Client-raised query tickets against a milestone ("Q ticket") ---------------
CREATE TABLE q_ticket (
  q_ticket_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id       uuid NOT NULL REFERENCES dossier(dossier_id) ON DELETE CASCADE,
  milestone_instance_id uuid REFERENCES milestone_instance(milestone_instance_id),
  raised_by        text,                             -- client contact
  subject          text NOT NULL,
  body             text,
  status           text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transit_order (
  transit_order_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id       uuid REFERENCES dossier(dossier_id),
  ot_number        text,
  customs_regime   text CHECK (customs_regime IN ('IM4','IM7','IM8','EX1','EX2')),
  service_direction text,
  declared_value   numeric(18,2),
  submitted_docs   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE delivery_note (
  delivery_note_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id       uuid REFERENCES dossier(dossier_id),
  doc_number       text,
  consignee        text,
  city_zone        text,
  contact_person   text,
  content_hash     text,
  pdf_vault_id     uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_dossier_updated BEFORE UPDATE ON dossier FOR EACH ROW EXECUTE FUNCTION set_updated_at();
