-- ============================================================================
-- TENANT DB — 14541 Sales lean revamp, PR 4: every tenant starts with one
-- quotation template, Standard (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.5).
--
-- Plain English and French text for the three sections a template carries
-- words for (Our Solution, Scope of Services, Terms), and which sections a Full
-- Proposal prints by default. The tenant edits it on the Templates screen
-- (PR 6); nothing here is shown until a quotation is created from it, and the
-- text is copied into that quotation, so a later edit never changes one.
--
-- Inserted only when the tenant has no default template yet, so a re-run, or a
-- tenant that already made its own default, is left alone.
-- ============================================================================

INSERT INTO quotation_template (name, service_type_ids, is_default, active, sections)
SELECT 'Standard', '{}', true, true, jsonb_build_object(
  'cover',        jsonb_build_object('enabled', true),
  'about_us',     jsonb_build_object('enabled', true),
  'needs',        jsonb_build_object('enabled', true),
  'solution',     jsonb_build_object('enabled', true,
    'body_en', 'We will handle your shipment from end to end with one team and one point of contact. '
            || 'Our staff follow every step of the journey and keep you informed at each milestone, '
            || 'so you always know where your cargo is and what happens next.',
    'body_fr', 'Nous prenons en charge votre expédition de bout en bout, avec une seule équipe et un seul interlocuteur. '
            || 'Nos équipes suivent chaque étape du parcours et vous informent à chaque jalon, '
            || 'pour que vous sachiez toujours où se trouve votre marchandise et ce qui suit.'),
  'scope',        jsonb_build_object('enabled', true,
    'body_en', 'The services covered by this quotation are those listed in the pricing below. '
            || 'Any service not listed, and any cost incurred at your request beyond it, will be quoted separately.',
    'body_fr', 'Les prestations couvertes par ce devis sont celles détaillées dans la tarification ci-dessous. '
            || 'Toute prestation non listée, et tout coût engagé à votre demande au-delà, fera l''objet d''un devis séparé.'),
  'pricing',      jsonb_build_object('enabled', true),
  'terms',        jsonb_build_object('enabled', true,
    'body_en', 'Prices are valid until the date shown on this quotation. Disbursements are re-invoiced at cost on presentation of receipts. '
            || 'Rates depend on the cargo details provided; a change to them may change the price.',
    'body_fr', 'Les prix sont valables jusqu''à la date indiquée sur ce devis. Les débours sont refacturés au coût réel sur présentation des justificatifs. '
            || 'Les tarifs dépendent des informations fournies sur la marchandise ; toute modification peut entraîner une révision du prix.'),
  'case_stories', jsonb_build_object('enabled', true),
  'next_steps',   jsonb_build_object('enabled', true)
)
WHERE NOT EXISTS (SELECT 1 FROM quotation_template WHERE is_default)
ON CONFLICT DO NOTHING;

-- DOWN
-- DESTRUCTIVE: the Standard template, and any edit made to it since, is removed
-- DELETE FROM quotation_template WHERE name = 'Standard' AND is_default;
