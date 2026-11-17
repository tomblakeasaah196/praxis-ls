-- ============================================================================
-- TENANT DB — 14542 Sales lean revamp, PR 4: every proposal becomes a
-- quotation (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §4.6; owner decision D6).
--
-- One document from here on. Each proposal is carried into the quotation it
-- is, so nothing a client was sent is lost and nothing has two prices:
--
--   status      IN_REVIEW becomes DRAFT (the review step is not carried over);
--               DRAFT, SENT, ACCEPTED and REJECTED keep their names.
--   lines       each proposal_line becomes a quotation_line, untaxed and not
--               a disbursement (a proposal line carried neither).
--   narratives  become sections, per language:
--                 executive_summary, client_context       Your Needs
--                 operational_strategy, slas,
--                 service_levels                          Our Solution
--                 scope, service_scope                    Scope of Services
--                 terms                                   Terms
--                 relevant_expertise, case_study          Case Stories
--                 anything else                           Your Needs
--               Two narratives landing on one section are joined in their
--               order. A proposal with no terms narrative but payment
--               conditions or free days gets a Terms section saying so.
--   the link    share_token_hash, its expiry, its revocation, and the first
--               view and download carry over, so a link a client was sent
--               still opens: /public/proposals/<token> resolves to this
--               quotation (sales/proposal_public reads quotation now).
--   dates       a sent or answered proposal kept no send date; its last update
--               is used, and valid_until is that day plus its validity days.
--   the request the one the proposal's opportunity became (14511, 14512), and
--               the company row from the proposal, its opportunity or that
--               request, followed through any 14512 merge.
--   number      the proposal's number; if a quotation already holds it, the
--               same number with "-P" (the quotation numbers are unique).
--
-- A proposal that was ALREADY converted (`converted_quote_id`) is not
-- duplicated: it only adds its sections to that quotation, and its title,
-- language, company row and link where that quotation has none.
--
-- Every quotation made here carries `source_proposal_id`, which is also what
-- makes a re-run a no-op. The proposal tables are NOT dropped (PR 7 does that);
-- the proposal service refuses new proposals from this release.
-- ============================================================================

-- SLAs were stored as a JSON array of { title, value }: they read as lines.
CREATE OR REPLACE FUNCTION pg_temp.praxis_14542_narrative(section text, body text)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE
  out text;
BEGIN
  IF lower(section) IN ('slas', 'service_levels') AND btrim(body) LIKE '[%' THEN
    BEGIN
      SELECT string_agg(btrim(concat_ws(': ', NULLIF(e ->> 'title', ''), NULLIF(e ->> 'value', ''))), E'\n')
        INTO out
        FROM jsonb_array_elements(body::jsonb) AS e;
      RETURN COALESCE(NULLIF(out, ''), body);
    EXCEPTION WHEN others THEN
      RETURN body;
    END;
  END IF;
  RETURN body;
END
$fn$;

DO $$
DECLARE
  p        record;
  qid      uuid;
  v_status text;
  v_sent   timestamptz;
  v_number text;
  v_ccy    char(3);
  v_qr_id     uuid;
  v_qr_lead   uuid;
  v_qr_client uuid;
  v_qr_entity uuid;
  v_lead   uuid;
  v_client uuid;
  v_total  numeric(18,2);
BEGIN
  FOR p IN
    SELECT pr.*, o.lead_id AS opp_lead_id, o.client_id AS opp_client_id
      FROM proposal pr
      LEFT JOIN opportunity o ON o.opportunity_id = pr.opportunity_id
     WHERE NOT EXISTS (SELECT 1 FROM quotation q WHERE q.source_proposal_id = pr.proposal_id)
     ORDER BY pr.created_at, pr.proposal_id
  LOOP
    -- The request its opportunity became, and the company row.
    v_qr_id := NULL; v_qr_lead := NULL; v_qr_client := NULL; v_qr_entity := NULL;
    IF p.opportunity_id IS NOT NULL THEN
      SELECT qr.quote_request_id, qr.lead_id, qr.client_id, qr.entity_id
        INTO v_qr_id, v_qr_lead, v_qr_client, v_qr_entity
        FROM quote_request qr
       WHERE qr.converted_opportunity_id = p.opportunity_id
       ORDER BY qr.created_at DESC LIMIT 1;
    END IF;
    v_lead := COALESCE(p.lead_id, p.opp_lead_id, v_qr_lead);
    IF v_lead IS NOT NULL THEN
      SELECT COALESCE(l.merged_into_lead_id, l.lead_id) INTO v_lead FROM lead l WHERE l.lead_id = v_lead;
    END IF;
    v_client := COALESCE(p.client_id, p.converted_client_id, p.opp_client_id, v_qr_client);

    IF p.converted_quote_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM quotation WHERE quotation_id = p.converted_quote_id) THEN
      -- Already a quotation: add what only the proposal had.
      qid := p.converted_quote_id;
      UPDATE quotation q
         SET source_proposal_id = CASE
               WHEN q.source_proposal_id IS NULL THEN p.proposal_id ELSE q.source_proposal_id END,
             lead_id          = COALESCE(q.lead_id, v_lead),
             title            = COALESCE(q.title, p.title),
             language         = COALESCE(q.language, p.language),
             share_token_hash = COALESCE(q.share_token_hash, p.share_token_hash),
             share_expires_at = CASE WHEN q.share_token_hash IS NULL THEN p.share_expires_at ELSE q.share_expires_at END,
             share_revoked_at = CASE WHEN q.share_token_hash IS NULL THEN p.share_revoked_at ELSE q.share_revoked_at END,
             viewed_at        = COALESCE(q.viewed_at, p.viewed_at),
             downloaded_at    = COALESCE(q.downloaded_at, p.downloaded_at)
       WHERE q.quotation_id = qid;
    ELSE
      v_status := CASE p.status WHEN 'IN_REVIEW' THEN 'DRAFT' ELSE p.status END;
      v_sent   := CASE WHEN v_status IN ('SENT', 'ACCEPTED', 'REJECTED') THEN p.updated_at END;
      v_ccy    := CASE WHEN EXISTS (SELECT 1 FROM currency c WHERE c.code = upper(p.currency))
                       THEN upper(p.currency) ELSE 'XAF' END;
      v_number := p.doc_number;
      IF v_number IS NOT NULL AND EXISTS (SELECT 1 FROM quotation WHERE doc_number = v_number) THEN
        v_number := v_number || '-P';
      END IF;
      SELECT COALESCE(round(sum(pl.qty * pl.unit_price), 2), 0) INTO v_total
        FROM proposal_line pl WHERE pl.proposal_id = p.proposal_id;

      INSERT INTO quotation (
        doc_number, entity_id, client_id, lead_id, quote_request_id, currency,
        total_ht, total_ttc, status, valid_until, title, language, default_output, version,
        share_token_hash, share_expires_at, share_revoked_at, viewed_at, downloaded_at,
        sent_at, answered_at, created_from, source_proposal_id, created_at
      )
      VALUES (
        v_number,
        COALESCE(v_qr_entity, (SELECT l.entity_id FROM lead l WHERE l.lead_id = v_lead)),
        v_client, v_lead, v_qr_id, v_ccy,
        v_total, v_total, v_status,
        CASE WHEN v_sent IS NOT NULL THEN v_sent::date + COALESCE(p.validity_days, 30) END,
        p.title, p.language, 'FULL', 1,
        p.share_token_hash, p.share_expires_at, p.share_revoked_at, p.viewed_at, p.downloaded_at,
        v_sent,
        CASE WHEN v_status IN ('ACCEPTED', 'REJECTED') THEN p.updated_at END,
        'PROPOSAL', p.proposal_id, p.created_at
      )
      RETURNING quotation_id INTO qid;

      INSERT INTO quotation_line (quotation_id, dictionary_item_id, label, qty, unit_price, is_disbursement, tax_code_id, line_no)
      SELECT qid, pl.dictionary_item_id, pl.label, pl.qty, pl.unit_price, false, NULL,
             row_number() OVER (ORDER BY pl.proposal_line_id)
        FROM proposal_line pl
       WHERE pl.proposal_id = p.proposal_id;
    END IF;

    -- The narratives, as sections.
    INSERT INTO quotation_section (quotation_id, section_key, enabled, body_en, body_fr)
    SELECT qid, m.key, true,
           left(NULLIF(string_agg(m.body, E'\n\n' ORDER BY m.sort_order) FILTER (WHERE m.lang = 'EN'), ''), 20000),
           left(NULLIF(string_agg(m.body, E'\n\n' ORDER BY m.sort_order) FILTER (WHERE m.lang = 'FR'), ''), 20000)
      FROM (
        SELECT CASE lower(n.section)
                 WHEN 'executive_summary'    THEN 'needs'
                 WHEN 'client_context'       THEN 'needs'
                 WHEN 'operational_strategy' THEN 'solution'
                 WHEN 'slas'                 THEN 'solution'
                 WHEN 'service_levels'       THEN 'solution'
                 WHEN 'scope'                THEN 'scope'
                 WHEN 'service_scope'        THEN 'scope'
                 WHEN 'terms'                THEN 'terms'
                 WHEN 'relevant_expertise'   THEN 'case_stories'
                 WHEN 'case_study'           THEN 'case_stories'
                 ELSE 'needs'
               END AS key,
               upper(COALESCE(n.language, 'EN')) AS lang,
               pg_temp.praxis_14542_narrative(n.section, n.body) AS body,
               n.sort_order
          FROM proposal_narrative n
         WHERE n.proposal_id = p.proposal_id
           AND NULLIF(btrim(n.body), '') IS NOT NULL
      ) m
     GROUP BY m.key
    ON CONFLICT (quotation_id, section_key) DO NOTHING;

    -- Terms the proposal kept as fields, when no narrative said them.
    IF NULLIF(btrim(p.payment_conditions), '') IS NOT NULL OR p.free_days_demurrage IS NOT NULL THEN
      INSERT INTO quotation_section (quotation_id, section_key, enabled, body_en, body_fr)
      VALUES (
        qid, 'terms', true,
        NULLIF(concat_ws(E'\n',
          CASE WHEN NULLIF(btrim(p.payment_conditions), '') IS NOT NULL THEN 'Payment: ' || btrim(p.payment_conditions) END,
          CASE WHEN p.free_days_demurrage IS NOT NULL THEN 'Free days: ' || p.free_days_demurrage END), ''),
        NULLIF(concat_ws(E'\n',
          CASE WHEN NULLIF(btrim(p.payment_conditions), '') IS NOT NULL THEN 'Paiement : ' || btrim(p.payment_conditions) END,
          CASE WHEN p.free_days_demurrage IS NOT NULL THEN 'Jours de franchise : ' || p.free_days_demurrage END), '')
      )
      ON CONFLICT (quotation_id, section_key) DO NOTHING;
    END IF;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS pg_temp.praxis_14542_narrative(text, text);

-- DOWN
-- DESTRUCTIVE: quotations made from proposals, and the sections added to converted ones, are removed; the proposal rows are untouched, so a re-run rebuilds them
-- DELETE FROM quotation_section s USING quotation q
--  WHERE s.quotation_id = q.quotation_id AND q.source_proposal_id IS NOT NULL;
-- DELETE FROM quotation WHERE created_from = 'PROPOSAL' AND source_proposal_id IS NOT NULL;
-- UPDATE quotation SET source_proposal_id = NULL WHERE source_proposal_id IS NOT NULL;
