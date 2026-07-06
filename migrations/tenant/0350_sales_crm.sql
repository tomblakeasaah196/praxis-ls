-- ============================================================================
-- TENANT DB — 0350 Sales & CRM (MOD-20–26). Website-API intake, meetings with
-- voice-to-text, campaigns/newsletters, AI proposals, pipeline, portfolio.
-- ============================================================================

-- MOD-20 Leads (manual + website intake) -------------------------------------
CREATE TABLE lead (
  lead_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name     text NOT NULL,
  contact_name     text,
  email            citext, phone text,
  source           text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','WEBSITE','REFERRAL','CAMPAIGN')),
  service_interest text,
  status           text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','CONTACTED','QUALIFIED','CONVERTED','LOST')),
  owner_user_id    uuid REFERENCES app_user(user_id),
  client_id        uuid REFERENCES client_master(client_id),  -- set when converted
  details_json     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- MOD-21 Meeting management (notes, minutes, voice-to-text) -------------------
CREATE TABLE meeting (
  meeting_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject          text NOT NULL,
  lead_id          uuid REFERENCES lead(lead_id),
  client_id        uuid REFERENCES client_master(client_id),
  scheduled_at     timestamptz,
  organiser_id     uuid REFERENCES app_user(user_id),
  transcript_vault_id uuid REFERENCES document_vault(doc_id),   -- Whisper/Groq output
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE meeting_note (
  meeting_note_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id       uuid NOT NULL REFERENCES meeting(meeting_id) ON DELETE CASCADE,
  author_id        uuid REFERENCES app_user(user_id),
  body             text,
  is_minutes       boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- MOD-22 Marketing campaigns + newsletter subscribers ------------------------
CREATE TABLE marketing_campaign (
  campaign_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  channel          text,                             -- email | social | event
  status           text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','PAUSED','ENDED')),
  starts_on        date, ends_on date,
  assets_json      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- digital-asset credentials/links
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE newsletter_subscriber (
  subscriber_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            citext UNIQUE NOT NULL,
  name             text,
  source           text,                             -- website | manual
  is_subscribed    boolean NOT NULL DEFAULT true,
  subscribed_at    timestamptz NOT NULL DEFAULT now()
);

-- MOD-23 Proposal generator (AI-assisted; human review before send) ----------
CREATE TABLE proposal (
  proposal_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_number       text,
  lead_id          uuid REFERENCES lead(lead_id),
  client_id        uuid REFERENCES client_master(client_id),
  opportunity_id   uuid,                             -- FK added below
  title            text NOT NULL,
  status           text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','IN_REVIEW','SENT','ACCEPTED','REJECTED')),
  ai_generated     boolean NOT NULL DEFAULT false,
  reviewed_by      uuid REFERENCES app_user(user_id),
  pdf_vault_id     uuid REFERENCES document_vault(doc_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE proposal_line (
  proposal_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id      uuid NOT NULL REFERENCES proposal(proposal_id) ON DELETE CASCADE,
  dictionary_item_id uuid REFERENCES dictionary_item(dictionary_item_id),
  label            text NOT NULL,
  qty              numeric(18,4) NOT NULL DEFAULT 1,
  unit_price       numeric(18,2) NOT NULL DEFAULT 0
);
CREATE TABLE proposal_narrative (
  proposal_narrative_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id      uuid NOT NULL REFERENCES proposal(proposal_id) ON DELETE CASCADE,
  section          text NOT NULL,                    -- 'executive_summary' | 'scope' | 'terms'
  body             text,
  sort_order       integer NOT NULL DEFAULT 0
);

-- MOD-24 Sales pipeline (visual Kanban) --------------------------------------
CREATE TABLE pipeline_stage (
  pipeline_stage_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             citext UNIQUE NOT NULL,
  name             text NOT NULL,
  sort_order       integer NOT NULL DEFAULT 0,
  is_won           boolean NOT NULL DEFAULT false,
  is_lost          boolean NOT NULL DEFAULT false
);
CREATE TABLE opportunity (
  opportunity_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  lead_id          uuid REFERENCES lead(lead_id),
  client_id        uuid REFERENCES client_master(client_id),
  dossier_id       uuid REFERENCES dossier(dossier_id),
  pipeline_stage_id uuid REFERENCES pipeline_stage(pipeline_stage_id),
  estimated_value  numeric(18,2),
  currency         char(3) NOT NULL DEFAULT 'XAF' REFERENCES currency(code),
  owner_user_id    uuid REFERENCES app_user(user_id),
  probability      numeric(5,2),
  status           text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','WON','LOST')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- Wire the deferred opportunity_id FKs from quotation (0250) and proposal.
ALTER TABLE quotation ADD CONSTRAINT fk_quote_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunity(opportunity_id);
ALTER TABLE proposal  ADD CONSTRAINT fk_proposal_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunity(opportunity_id);

-- MOD-25 Inbound intake (Contact Us + partnership) ---------------------------
CREATE TABLE contact_enquiry (
  contact_enquiry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text, email citext, phone text,
  subject          text, message text,
  source           text DEFAULT 'WEBSITE',
  status           text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','TRIAGED','CLOSED')),
  lead_id          uuid REFERENCES lead(lead_id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE partnership_request (
  partnership_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name     text, contact_name text, email citext,
  proposal_text    text,
  status           text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','REVIEWING','ACCEPTED','DECLINED')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- MOD-26 Project portfolio / success stories ---------------------------------
CREATE TABLE success_story (
  success_story_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL,
  dossier_id       uuid REFERENCES dossier(dossier_id),
  summary          text,
  body             text,
  ai_generated     boolean NOT NULL DEFAULT false,
  is_published     boolean NOT NULL DEFAULT false,
  signed_off_by    uuid REFERENCES app_user(user_id),
  published_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_lead_updated        BEFORE UPDATE ON lead        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_proposal_updated    BEFORE UPDATE ON proposal    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_opportunity_updated BEFORE UPDATE ON opportunity FOR EACH ROW EXECUTE FUNCTION set_updated_at();
