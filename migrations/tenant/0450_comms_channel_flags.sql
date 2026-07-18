-- Comms channel feature flags — toggled from AI Control (Features), exactly like
-- the AI flags. `comms` (internal team chat) defaults ON; the external channels
-- WhatsApp/Instagram default OFF (in the code but hidden until switched on).
INSERT INTO ai_feature_flag (feature_key, display_name, description, is_enabled)
VALUES
  ('comms',     'Smart Comms',        'Internal team chat & messaging hub.',                          true),
  ('whatsapp',  'WhatsApp channel',   'Outbound/inbound WhatsApp conversations (hidden until enabled).', false),
  ('instagram', 'Instagram channel',  'Instagram DM conversations (hidden until enabled).',            false)
ON CONFLICT (feature_key) DO NOTHING;
