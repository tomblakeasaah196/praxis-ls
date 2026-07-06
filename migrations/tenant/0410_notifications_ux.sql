-- ============================================================================
-- TENANT DB — 0410 cross-cutting: notifications, reminders, email delivery,
-- e-signature, AI execution worksheets/tokens (§10.7), reporting & help.
-- ============================================================================

-- Multi-channel notifications with per-user read state (event_log drives them)
CREATE TABLE notification (
  notification_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES app_user(user_id),
  channel          text NOT NULL DEFAULT 'IN_APP' CHECK (channel IN ('IN_APP','EMAIL','SMS','WHATSAPP')),
  event_type_key   citext,
  title            text NOT NULL,
  body             text,
  entity_ref       text,
  priority         text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL','HIGH')),
  read_at          timestamptz,
  sent_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_notif_user_unread ON notification(user_id) WHERE read_at IS NULL;

-- Reminders / compliance calendar nudges (daily "you have pending…") ----------
CREATE TABLE reminder (
  reminder_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key         text NOT NULL,                    -- 'proof.missing' | 'tax.vat_due' | 'insurance.expiring'
  entity_ref       text,
  user_id          uuid REFERENCES app_user(user_id),
  due_on           date,
  recurrence       text,                             -- 'daily' | 'once'
  is_active        boolean NOT NULL DEFAULT true,
  last_fired_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Email / SMTP: per-tenant sender identities + deliverability (PRD §5.9) ------
CREATE TABLE email_identity (
  email_identity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose          text NOT NULL CHECK (purpose IN ('BILLING','DOCUMENTS','NOTIFICATIONS','SUPPORT')),
  from_address     citext NOT NULL,
  from_name        text NOT NULL,
  reply_to         citext,
  smtp_host        text, smtp_port integer,
  spf_verified     boolean NOT NULL DEFAULT false,
  dkim_verified    boolean NOT NULL DEFAULT false,
  dmarc_verified   boolean NOT NULL DEFAULT false,
  is_fallback      boolean NOT NULL DEFAULT false,   -- nmail.praxisls.com fallback
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE email_send_log (
  email_send_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_identity_id uuid REFERENCES email_identity(email_identity_id),
  to_address       citext NOT NULL,
  subject          text,
  entity_ref       text,                             -- the source document emailed
  document_vault_id uuid REFERENCES document_vault(doc_id),
  status           text NOT NULL DEFAULT 'QUEUED'
                     CHECK (status IN ('QUEUED','SENT','DELIVERED','BOUNCED','COMPLAINED','FAILED')),
  provider_message_id text,
  error            text,
  queued_at        timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_emaillog_entity ON email_send_log(entity_ref);

-- Document e-signature (digital or physical) ---------------------------------
CREATE TABLE document_signature (
  document_signature_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_ref       text NOT NULL,                    -- invoice/contract/PO being signed
  document_vault_id uuid REFERENCES document_vault(doc_id),
  signer_user_id   uuid REFERENCES app_user(user_id),
  signer_name      text,
  method           text NOT NULL DEFAULT 'DIGITAL' CHECK (method IN ('DIGITAL','PHYSICAL')),
  signature_ref    text,                             -- stored signature image/hash
  signed_at        timestamptz,
  content_hash     text,                             -- ties signature to document DNA
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- AI execution worksheets: print -> sign -> mail -> WhatsApp, tokenised URLs --
CREATE TABLE execution_card (
  execution_card_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type_key   citext,
  entity_ref       text NOT NULL,
  steps            jsonb NOT NULL DEFAULT '[]'::jsonb,   -- print/sign/mail/whatsapp step states
  status           text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','COMPLETED','CANCELLED')),
  created_by       uuid REFERENCES app_user(user_id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE approval_token (
  approval_token_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_card_id uuid REFERENCES execution_card(execution_card_id) ON DELETE CASCADE,
  approval_task_id uuid REFERENCES approval_task(approval_task_id),
  token_hash       text NOT NULL,                    -- single-use, time-boxed remote-approval token
  expires_at       timestamptz NOT NULL,
  used_at          timestamptz,
  used_by_ip       inet,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- MOD-63 Reporting: saved reports + configurable dashboard tiles --------------
CREATE TABLE saved_report (
  saved_report_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  report_key       text NOT NULL,                    -- 'receivables_ageing' | 'dossier_margin' ...
  params           jsonb NOT NULL DEFAULT '{}'::jsonb,
  owner_user_id    uuid REFERENCES app_user(user_id),
  is_shared        boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE dashboard_tile (
  dashboard_tile_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES app_user(user_id),
  tile_key         text NOT NULL,                    -- 'receivables' | 'fleet_util' | 'live_map'
  position         integer NOT NULL DEFAULT 0,
  is_visible       boolean NOT NULL DEFAULT true,
  config           jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (user_id, tile_key)
);

-- Help Center content --------------------------------------------------------
CREATE TABLE help_article (
  help_article_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_key       citext,
  title            text NOT NULL,
  body             text,
  language         char(2) NOT NULL DEFAULT 'en',
  sort_order       integer NOT NULL DEFAULT 0,
  is_published     boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_emaillog_updated BEFORE UPDATE ON email_send_log FOR EACH ROW EXECUTE FUNCTION set_updated_at();
