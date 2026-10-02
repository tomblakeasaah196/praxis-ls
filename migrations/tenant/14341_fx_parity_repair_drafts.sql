-- ============================================================================
-- TENANT DB — 14341 Re-price open DRAFT documents at the fixed EUR parity.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- Meeting 6 (29 Sep 2026), register 3.1 / owner decision F1. Currencies & FX
-- showed 1 EUR = 656.168 XAF: exchangerate-api's XAF→EUR 0.001524, rounded to
-- four significant digits, stored as-is and read back inverted. The legal
-- parity is 655.957 (BEAC for XAF, BCEAO for XOF — @praxis/shared
-- data/currencies.js PEGS). Costings pre-filled their rate from that screen
-- (#497), so open drafts carry 656.168 or whatever the feed said that day.
--
-- From this PR the resolver answers XAF/XOF ↔ EUR from the peg and nothing can
-- store another figure. This file repairs what is already stored:
--
--   DRAFTS ARE RE-PRICED. A document nobody has signed, sealed, sent or posted
--   is still being priced, and it is priced at the law.
--
--   NOTHING ELSE IS TOUCHED. A submitted, approved, sealed, issued or posted
--   document is a record of what someone signed: its rate is part of what was
--   signed. The WHERE clause of every UPDATE below is `status = 'DRAFT'`.
--
-- ── WHAT "RE-PRICED" MEANS, PER DOCUMENT ──────────────────────────────────
--
--   costing          exchange_rate_to_xaf → parity, total_ttc_xaf recomputed.
--                    The lines are in the sheet's own currency and are what the
--                    pricer priced; they do not change. A note is appended to
--                    the costing's remarks, which the sheet shows.
--   cash_request     exchange_rate_to_xaf → parity, amount_xaf recomputed; note
--                    appended to remarks.
--   margin_simulation  lines imported from a EUR/XOF costing are XAF figures
--                    converted at THAT costing's rate (margin_simulation.service
--                    fromCosting: round2(unit_cost × rate)). A line is
--                    re-converted only when it still equals exactly that
--                    conversion of a line on its costing — i.e. it is provably
--                    the import, not a figure someone typed since. Header
--                    total_cost / margin_percent recomputed with the service's
--                    own cents arithmetic (margin_simulation.rules.computeMargin).
--                    The note goes on each re-converted line.
--   dossier_reconciliation, invoice, supplier_invoice
--                    rate → parity. No figure on them is derived from it, so no
--                    amount moves. Audited and logged; they have no notes field.
--
-- Not re-priced, and why (also in the PR):
--   regie_advance          — an advance is ISSUED with a posted journal entry;
--                            there is no draft state.
--   journal_entry (draft)  — debit_base/credit_base are GENERATED from fx_rate
--                            and rounded per line, so moving the rate can
--                            unbalance an entry a person has already balanced.
--                            Counted below for a person to review, not moved.
--   extra_charge_simulation — a dated what-if snapshot with no lifecycle; its
--                            rates_snapshot records what was quoted that day.
--
-- ── RE-RUNNABLE ────────────────────────────────────────────────────────────
--
-- Every UPDATE selects only rows whose rate IS DISTINCT FROM the parity, so a
-- second run finds nothing and appends no second note. The log's unique key
-- makes its inserts no-ops on a re-run.
--
-- The counts per document type are RAISEd as NOTICEs and kept in
-- fx_parity_repair, so the figures for each tenant are queryable after deploy:
--   SELECT doc_type, count(*) FROM fx_parity_repair GROUP BY 1;
-- ============================================================================

CREATE TABLE IF NOT EXISTS fx_parity_repair (
  fx_parity_repair_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type     text NOT NULL,
  doc_id       uuid NOT NULL,
  doc_number   text,
  currency     char(3) NOT NULL,
  old_rate     numeric NOT NULL,
  new_rate     numeric NOT NULL,
  note         text NOT NULL,
  repaired_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doc_type, doc_id)
);

COMMENT ON TABLE fx_parity_repair IS
  '14341: every DRAFT document re-priced at the fixed EUR parity (655.957), with the rate it carried before. Signed, sealed, sent and posted documents never appear here.';

DO $$
DECLARE
  -- The parity, as @praxis/shared data/currencies.js PEGS states it. A literal
  -- here because a migration cannot import JavaScript; the costing and
  -- commercial modules, which the FX-literal gate scans, never carry one.
  eur_xaf   constant numeric := 655.957;
  n_costing int := 0;
  n_cash    int := 0;
  n_msim    int := 0;
  n_msim_lines int := 0;
  n_recon   int := 0;
  n_invoice int := 0;
  n_supinv  int := 0;
  n_je      int := 0;
  n_ecs     int := 0;
  r         record;
  note      text;
  target    numeric;
BEGIN
  -- ── costing ───────────────────────────────────────────────────────────────
  -- XOF converts to XAF at 1 (both are 655.957 to the euro); EUR at the parity.
  FOR r IN
    SELECT costing_id, doc_number, currency, exchange_rate_to_xaf AS old_rate
      FROM costing
     WHERE status = 'DRAFT'
       AND currency IN ('EUR', 'XOF')
       AND exchange_rate_to_xaf IS DISTINCT FROM (CASE currency WHEN 'EUR' THEN eur_xaf ELSE 1 END)
  LOOP
    target := CASE r.currency WHEN 'EUR' THEN eur_xaf ELSE 1 END;
    note := format('Re-priced at the fixed parity %s; was %s.',
                   CASE r.currency WHEN 'EUR' THEN '655.957' ELSE '1 XOF = 1 XAF' END,
                   trim(trailing '.' FROM trim(trailing '0' FROM r.old_rate::text)));

    UPDATE costing
       SET exchange_rate_to_xaf = target,
           total_ttc_xaf = CASE WHEN total_ttc IS NULL THEN total_ttc_xaf ELSE total_ttc * target END,
           remarks = CASE WHEN coalesce(remarks, '') = '' THEN note ELSE remarks || E'\n' || note END,
           updated_at = now()
     WHERE costing_id = r.costing_id;

    INSERT INTO fx_parity_repair (doc_type, doc_id, doc_number, currency, old_rate, new_rate, note)
    VALUES ('costing', r.costing_id, r.doc_number, r.currency, r.old_rate, target, note)
    ON CONFLICT (doc_type, doc_id) DO NOTHING;

    INSERT INTO immutable_ledger (action, module_key, entity_ref, before_json, after_json, metadata)
    VALUES ('fx.parity_repriced', 'MOD-46', 'costing:' || r.costing_id,
            jsonb_build_object('exchange_rate_to_xaf', r.old_rate),
            jsonb_build_object('exchange_rate_to_xaf', target),
            jsonb_build_object('migration', '14341', 'note', note))
    ON CONFLICT DO NOTHING;
    n_costing := n_costing + 1;
  END LOOP;

  -- ── margin_simulation (DRAFT) built from a EUR/XOF costing ────────────────
  -- Whatever state the costing is in now: a sealed costing keeps its 656.168,
  -- but the open simulation built from it is still being priced, and its XAF
  -- costs are re-converted from the costing's own lines at the parity. The old
  -- rate is read from fx_parity_repair when the costing was itself repaired
  -- above, else from the costing row.
  FOR r IN
    SELECT ms.margin_simulation_id, c.costing_id, c.doc_number AS costing_number, c.currency,
           COALESCE(fp.old_rate, c.exchange_rate_to_xaf) AS old_rate
      FROM margin_simulation ms
      JOIN costing c ON c.costing_id = ms.costing_id
      LEFT JOIN fx_parity_repair fp ON fp.doc_type = 'costing' AND fp.doc_id = c.costing_id
     WHERE ms.status = 'DRAFT'
       AND c.currency IN ('EUR', 'XOF')
       AND COALESCE(fp.old_rate, c.exchange_rate_to_xaf) IS DISTINCT FROM (CASE c.currency WHEN 'EUR' THEN eur_xaf ELSE 1 END)
       AND NOT EXISTS (SELECT 1 FROM fx_parity_repair x
                        WHERE x.doc_type = 'margin_simulation' AND x.doc_id = ms.margin_simulation_id)
  LOOP
    target := CASE r.currency WHEN 'EUR' THEN eur_xaf ELSE 1 END;
    note := format('Re-priced at the fixed parity %s; was %s.',
                   CASE r.currency WHEN 'EUR' THEN '655.957' ELSE '1 XOF = 1 XAF' END,
                   trim(trailing '.' FROM trim(trailing '0' FROM r.old_rate::text)));

    WITH matched AS (
      SELECT DISTINCT ON (msl.margin_simulation_line_id)
             msl.margin_simulation_line_id, cl.unit_cost AS costing_unit
        FROM margin_simulation_line msl
        JOIN costing_line cl
          ON cl.costing_id = r.costing_id
         AND cl.dictionary_item_id IS NOT DISTINCT FROM msl.dictionary_item_id
         AND cl.label IS NOT DISTINCT FROM msl.label
       WHERE msl.margin_simulation_id = r.margin_simulation_id
         -- provably the import: round2(costing unit × the costing's rate)
         AND msl.unit_cost = round(coalesce(cl.unit_cost, 0) * r.old_rate, 2)
       ORDER BY msl.margin_simulation_line_id, cl.line_no
    )
    UPDATE margin_simulation_line msl
       SET unit_cost = round(coalesce(m.costing_unit, 0) * target, 2),
           notes = CASE WHEN coalesce(msl.notes, '') = '' THEN note ELSE msl.notes || E'\n' || note END
      FROM matched m
     WHERE msl.margin_simulation_line_id = m.margin_simulation_line_id;
    GET DIAGNOSTICS n_msim_lines = ROW_COUNT;

    IF n_msim_lines > 0 THEN
      -- computeMargin, in cents, exactly as the service stores it.
      UPDATE margin_simulation ms
         SET total_cost = t.total_cost,
             margin_percent = t.margin_percent
        FROM (
          SELECT round(sum(round(unit_cost * 100 * qty)) / 100.0, 2) AS total_cost,
                 CASE WHEN sum(CASE WHEN is_disbursement THEN 0 ELSE round(unit_price * 100 * qty) END) > 0
                      THEN round(
                             (sum(CASE WHEN is_disbursement THEN 0 ELSE round(unit_price * 100 * qty) END)
                              - sum(CASE WHEN is_disbursement THEN 0 ELSE round(unit_cost * 100 * qty) END))
                             / sum(CASE WHEN is_disbursement THEN 0 ELSE round(unit_price * 100 * qty) END) * 100, 2)
                      ELSE 0 END AS margin_percent
            FROM margin_simulation_line
           WHERE margin_simulation_id = r.margin_simulation_id
        ) t
       WHERE ms.margin_simulation_id = r.margin_simulation_id;

      INSERT INTO fx_parity_repair (doc_type, doc_id, doc_number, currency, old_rate, new_rate, note)
      VALUES ('margin_simulation', r.margin_simulation_id, r.costing_number, r.currency, r.old_rate, target,
              note || format(' %s line(s) re-converted from costing %s.', n_msim_lines, coalesce(r.costing_number, '')))
      ON CONFLICT (doc_type, doc_id) DO NOTHING;

      INSERT INTO immutable_ledger (action, module_key, entity_ref, before_json, after_json, metadata)
      VALUES ('fx.parity_repriced', 'MOD-27', 'margin_simulation:' || r.margin_simulation_id,
              jsonb_build_object('costing_rate', r.old_rate),
              jsonb_build_object('costing_rate', target, 'lines_reconverted', n_msim_lines),
              jsonb_build_object('migration', '14341', 'note', note))
      ON CONFLICT DO NOTHING;
      n_msim := n_msim + 1;
    END IF;
  END LOOP;

  -- ── cash_request ──────────────────────────────────────────────────────────
  FOR r IN
    SELECT cash_request_id, doc_number, currency, exchange_rate_to_xaf AS old_rate
      FROM cash_request
     WHERE status = 'DRAFT'
       AND currency IN ('EUR', 'XOF')
       AND exchange_rate_to_xaf IS DISTINCT FROM (CASE currency WHEN 'EUR' THEN eur_xaf ELSE 1 END)
  LOOP
    target := CASE r.currency WHEN 'EUR' THEN eur_xaf ELSE 1 END;
    note := format('Re-priced at the fixed parity %s; was %s.',
                   CASE r.currency WHEN 'EUR' THEN '655.957' ELSE '1 XOF = 1 XAF' END,
                   trim(trailing '.' FROM trim(trailing '0' FROM r.old_rate::text)));
    UPDATE cash_request
       SET exchange_rate_to_xaf = target,
           amount_xaf = CASE WHEN amount IS NULL THEN amount_xaf ELSE round(amount * target, 2) END,
           remarks = CASE WHEN coalesce(remarks, '') = '' THEN note ELSE remarks || E'\n' || note END,
           updated_at = now()
     WHERE cash_request_id = r.cash_request_id;
    INSERT INTO fx_parity_repair (doc_type, doc_id, doc_number, currency, old_rate, new_rate, note)
    VALUES ('cash_request', r.cash_request_id, r.doc_number, r.currency, r.old_rate, target, note)
    ON CONFLICT (doc_type, doc_id) DO NOTHING;
    INSERT INTO immutable_ledger (action, module_key, entity_ref, before_json, after_json, metadata)
    VALUES ('fx.parity_repriced', 'MOD-49', 'cash_request:' || r.cash_request_id,
            jsonb_build_object('exchange_rate_to_xaf', r.old_rate),
            jsonb_build_object('exchange_rate_to_xaf', target),
            jsonb_build_object('migration', '14341', 'note', note))
    ON CONFLICT DO NOTHING;
    n_cash := n_cash + 1;
  END LOOP;

  -- ── dossier_reconciliation ────────────────────────────────────────────────
  FOR r IN
    SELECT reconciliation_id, currency, exchange_rate_to_xaf AS old_rate
      FROM dossier_reconciliation
     WHERE status = 'DRAFT'
       AND currency IN ('EUR', 'XOF')
       AND exchange_rate_to_xaf IS DISTINCT FROM (CASE currency WHEN 'EUR' THEN eur_xaf ELSE 1 END)
  LOOP
    target := CASE r.currency WHEN 'EUR' THEN eur_xaf ELSE 1 END;
    note := format('Re-priced at the fixed parity %s; was %s.',
                   CASE r.currency WHEN 'EUR' THEN '655.957' ELSE '1 XOF = 1 XAF' END,
                   trim(trailing '.' FROM trim(trailing '0' FROM r.old_rate::text)));
    UPDATE dossier_reconciliation SET exchange_rate_to_xaf = target WHERE reconciliation_id = r.reconciliation_id;
    INSERT INTO fx_parity_repair (doc_type, doc_id, doc_number, currency, old_rate, new_rate, note)
    VALUES ('dossier_reconciliation', r.reconciliation_id, NULL, r.currency, r.old_rate, target, note)
    ON CONFLICT (doc_type, doc_id) DO NOTHING;
    INSERT INTO immutable_ledger (action, module_key, entity_ref, before_json, after_json, metadata)
    VALUES ('fx.parity_repriced', 'MOD-76', 'dossier_reconciliation:' || r.reconciliation_id,
            jsonb_build_object('exchange_rate_to_xaf', r.old_rate),
            jsonb_build_object('exchange_rate_to_xaf', target),
            jsonb_build_object('migration', '14341', 'note', note))
    ON CONFLICT DO NOTHING;
    n_recon := n_recon + 1;
  END LOOP;

  -- ── invoice / supplier_invoice (fx_rate: 1 <currency> = rate XAF) ─────────
  FOR r IN
    SELECT invoice_id, doc_number, currency, fx_rate AS old_rate
      FROM invoice
     WHERE status = 'DRAFT'
       AND currency IN ('EUR', 'XOF')
       AND fx_rate IS DISTINCT FROM (CASE currency WHEN 'EUR' THEN eur_xaf ELSE 1 END)
  LOOP
    target := CASE r.currency WHEN 'EUR' THEN eur_xaf ELSE 1 END;
    note := format('Re-priced at the fixed parity %s; was %s.',
                   CASE r.currency WHEN 'EUR' THEN '655.957' ELSE '1 XOF = 1 XAF' END,
                   trim(trailing '.' FROM trim(trailing '0' FROM r.old_rate::text)));
    UPDATE invoice SET fx_rate = target, updated_at = now() WHERE invoice_id = r.invoice_id;
    INSERT INTO fx_parity_repair (doc_type, doc_id, doc_number, currency, old_rate, new_rate, note)
    VALUES ('invoice', r.invoice_id, r.doc_number, r.currency, r.old_rate, target, note)
    ON CONFLICT (doc_type, doc_id) DO NOTHING;
    INSERT INTO immutable_ledger (action, module_key, entity_ref, before_json, after_json, metadata)
    VALUES ('fx.parity_repriced', 'MOD-51', 'invoice:' || r.invoice_id,
            jsonb_build_object('fx_rate', r.old_rate), jsonb_build_object('fx_rate', target),
            jsonb_build_object('migration', '14341', 'note', note))
    ON CONFLICT DO NOTHING;
    n_invoice := n_invoice + 1;
  END LOOP;

  FOR r IN
    SELECT supplier_invoice_id, doc_number, currency, fx_rate AS old_rate
      FROM supplier_invoice
     WHERE status = 'DRAFT'
       AND currency IN ('EUR', 'XOF')
       AND fx_rate IS DISTINCT FROM (CASE currency WHEN 'EUR' THEN eur_xaf ELSE 1 END)
  LOOP
    target := CASE r.currency WHEN 'EUR' THEN eur_xaf ELSE 1 END;
    note := format('Re-priced at the fixed parity %s; was %s.',
                   CASE r.currency WHEN 'EUR' THEN '655.957' ELSE '1 XOF = 1 XAF' END,
                   trim(trailing '.' FROM trim(trailing '0' FROM r.old_rate::text)));
    UPDATE supplier_invoice SET fx_rate = target, updated_at = now() WHERE supplier_invoice_id = r.supplier_invoice_id;
    INSERT INTO fx_parity_repair (doc_type, doc_id, doc_number, currency, old_rate, new_rate, note)
    VALUES ('supplier_invoice', r.supplier_invoice_id, r.doc_number, r.currency, r.old_rate, target, note)
    ON CONFLICT (doc_type, doc_id) DO NOTHING;
    INSERT INTO immutable_ledger (action, module_key, entity_ref, before_json, after_json, metadata)
    VALUES ('fx.parity_repriced', 'MOD-61', 'supplier_invoice:' || r.supplier_invoice_id,
            jsonb_build_object('fx_rate', r.old_rate), jsonb_build_object('fx_rate', target),
            jsonb_build_object('migration', '14341', 'note', note))
    ON CONFLICT DO NOTHING;
    n_supinv := n_supinv + 1;
  END LOOP;

  -- ── counted, not moved ────────────────────────────────────────────────────
  SELECT count(DISTINCT je.entry_id) INTO n_je
    FROM journal_entry je
    JOIN journal_line jl ON jl.entry_id = je.entry_id
   WHERE je.status = 'draft'
     AND jl.currency IN ('EUR', 'XOF')
     AND jl.fx_rate IS DISTINCT FROM (CASE jl.currency WHEN 'EUR' THEN eur_xaf ELSE 1 END);
  SELECT count(*) INTO n_ecs
    FROM extra_charge_simulation
   WHERE rates_snapshot ? 'EUR' OR rates_snapshot ? 'XOF';

  RAISE NOTICE '14341 fx parity repair (%): costing=%, margin_simulation=%, cash_request=%, dossier_reconciliation=%, invoice=%, supplier_invoice=% re-priced; journal_entry draft=% and extra_charge_simulation=% left for review',
    current_schema(), n_costing, n_msim, n_cash, n_recon, n_invoice, n_supinv, n_je, n_ecs;
END $$;

-- ============================================================================
-- VERIFY
--   SELECT doc_type, count(*) FROM fx_parity_repair GROUP BY 1 ORDER BY 1;
--   SELECT count(*) FROM costing WHERE status <> 'DRAFT' AND currency = 'EUR'
--      AND exchange_rate_to_xaf <> 655.957;   -- unchanged by design
--
-- IRREVERSIBLE: the re-pricing rewrites rates and derived XAF totals on DRAFT
-- documents. fx_parity_repair keeps every old rate, so a person can restore one
-- by hand; the table itself can be dropped once reviewed:
--   -- DROP TABLE IF EXISTS fx_parity_repair;
-- ============================================================================
