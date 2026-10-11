"use strict";
/**
 * The Commercial tab's eleven paged blocks, and the one summary query behind
 * its KPI strip.
 *
 * ── WHY THIS IS A SEPARATE FILE ─────────────────────────────────────────────
 *
 * `service_type_360.service.js` returns the WHOLE page in one call, every
 * collection capped at 25 with a `_more` count beside it. That shape is right
 * for a page whose tabs are mostly small: a service type has a handful of
 * milestone templates and a few dozen dictionary lines, and shipping them
 * inline costs nothing.
 *
 * Money does not behave that way. A service type that has been sold for three
 * years carries thousands of costing sheets and invoices, and "25 most recent,
 * 4,117 older not listed here" is not a report — it is a sentence telling the
 * reader that the screen cannot answer their question. So the money blocks page
 * SERVER-SIDE, 25 at a time, each one fetched only when the sub-tab holding it
 * is opened. Nothing here rides the /360 payload.
 *
 * ── THE ELEVEN BLOCKS ───────────────────────────────────────────────────────
 *
 * They are the document chain a service type actually generates, in order:
 *
 *   SELL   quotations · proforma · margin_sims · extra_charges · pricing_variance
 *   BILL   invoices (FINAL) · credit_notes · collections
 *   SPEND  costings · cash_requests · supplier_invoices
 *
 * Every one of them reaches this service type the same way — through
 * `dossier_visible`, which is the ONLY join that attributes a money document to
 * a service. Two consequences worth knowing before adding a twelfth:
 *
 *   1. The join is INNER, deliberately. `quotation.dossier_id`,
 *      `invoice.dossier_id` and `supplier_invoice.dossier_id` are all nullable
 *      — a quotation can be raised before a file exists, and a supplier invoice
 *      can be booked against no file at all. A document with no file has no
 *      service type, so it is not this service type's. A LEFT JOIN would quietly
 *      pull every unattributed document on the tenant into every service's tab.
 *   2. `dossier_visible` excludes drafts (0671), so a draft file's documents are
 *      absent here exactly as they are absent from the /360's own collections.
 *      The two agree, which is the point of using the same view.
 *
 * ── TOTALS ──────────────────────────────────────────────────────────────────
 *
 * Each block SELECTs `TOTAL_COL` (`COUNT(*) OVER()`), so one round trip returns
 * the page AND the true match count for `X-Total-Count`. The alternative — a
 * second `SELECT COUNT(*)` — duplicates the WHERE clause, and the two copies
 * drift. See `shared/db/query-helpers.js:190`.
 *
 * ── MONEY PER CURRENCY, NEVER CONVERTED ─────────────────────────────────────
 *
 * `moneyRollup` in the sibling repo keeps currencies apart on purpose, and says
 * why: netting two currencies invents an FX decision that belongs to the
 * costing screen, where the rate is already chosen. The summary below keeps the
 * same discipline — every money figure comes back as a per-currency array, and
 * the UI puts XAF on the tile with the rest behind the ⓘ. Nothing in this file
 * multiplies by a rate.
 *
 * The one exception is `actual_xaf`, and it is not an exception to the rule so
 * much as a different source: `cost_entry` has no currency column because it is
 * the LEDGER, which is denominated in XAF by construction.
 */
const { page, TOTAL_COL, splitTotal } = require("../../../shared/db/query-helpers");
// Actual spend is NET of reconciliation reversals — see shared/finance/cost-entry-sql.
const { netAmountSql } = require("../../../shared/finance/cost-entry-sql");

/**
 * The invoice statuses that count as real money.
 *
 * Same three `moneyRollup` uses, and for the same reason: a DRAFT invoice is a
 * proposal someone is still typing, and counting it as revenue makes the tab
 * disagree with Finance. Repeated as a literal in each CTE below rather than
 * parameterised, because it is a constant of the accounting model and not an
 * input — the same way smart_receivables.repo.js:46 spells it.
 */
const LOCKED = "('POSTED_LOCKED','APPROVED_LOCKED','ISSUED_LOCKED')";

/* ── The eleven blocks ────────────────────────────────────────────────────── */

/**
 * One SQL statement per block, each taking ($1 service_type_id, $2 limit,
 * $3 offset) and each returning `row_id` plus `_total`.
 *
 * `row_id` is a deliberate alias rather than the table's own primary-key name.
 * The UI renders eleven different row shapes through one component, and a
 * single stable key column is what lets it do that without a per-block `key`
 * expression — the same trick `financial_dictionary.repo.js:347` uses for the
 * four document kinds behind a usage tile.
 *
 * ORDER BY always ends in the primary key. Without it, two documents created in
 * the same millisecond can swap places between page 1 and page 2, and a row is
 * shown twice while another is never shown at all.
 */
const BLOCK_SQL = {
  /* ── SELL ─────────────────────────────────────────────────────────────── */

  // Devis. `valid_until` is here because an EXPIRED quote that nobody noticed
  // is the most common reason a win rate looks worse than the desk remembers.
  quotations: `
    SELECT q.quotation_id AS row_id, q.doc_number, q.status, q.currency,
           q.total_ht, q.total_ttc, q.margin_percent, q.valid_until, q.created_at,
           d.dossier_id, d.ref AS dossier_ref, cm.name AS client_name,
           ${TOTAL_COL}
      FROM quotation q
      JOIN dossier_visible d ON d.dossier_id = q.dossier_id
      LEFT JOIN client_master cm ON cm.client_id = q.client_id
     WHERE d.service_type_id = $1
     ORDER BY q.created_at DESC, q.quotation_id
     LIMIT $2 OFFSET $3`,

  // Proforma is the same table as FINAL, a different `type`. It is NOT revenue
  // (§8.2) and is never summed into `billed` — it is pipeline, which is exactly
  // why the tab needs it: the old Commercial tab filtered `type = 'FINAL'` and
  // so showed nothing at all between a quote and a locked invoice.
  proforma: `
    SELECT i.invoice_id AS row_id, i.doc_number, i.status, i.currency,
           i.service_ht, i.total_ttc, i.payment_due_on, i.created_at,
           d.dossier_id, d.ref AS dossier_ref, cm.name AS client_name,
           ${TOTAL_COL}
      FROM invoice i
      JOIN dossier_visible d ON d.dossier_id = i.dossier_id
      LEFT JOIN client_master cm ON cm.client_id = i.client_id
     WHERE d.service_type_id = $1 AND i.type = 'PROFORMA'
     ORDER BY i.created_at DESC, i.invoice_id
     LIMIT $2 OFFSET $3`,

  // The only block that joins `dossier_visible` LEFT rather than INNER, because
  // `margin_simulation` carries `service_type_id` ITSELF — a simulation is
  // filed under a service before any file exists, which is the whole point of
  // simulating. The file ref is decoration when it is there.
  margin_sims: `
    SELECT ms.margin_simulation_id AS row_id, ms.currency, ms.margin_percent,
           ms.total_cost, ms.total_price, ms.created_at,
           ms.dossier_id, d.ref AS dossier_ref,
           ${TOTAL_COL}
      FROM margin_simulation ms
      LEFT JOIN dossier_visible d ON d.dossier_id = ms.dossier_id
     WHERE ms.service_type_id = $1
     ORDER BY ms.created_at DESC, ms.margin_simulation_id
     LIMIT $2 OFFSET $3`,

  // Demurrage and detention (MOD-28). Priced by formula rather than by a rate
  // card, so it never appears in a costing until somebody accepts it.
  extra_charges: `
    SELECT e.extra_charge_simulation_id AS row_id, e.shipping_line, e.container_variant,
           e.free_days, e.out_of_port_on, e.total_amount, e.currency, e.created_at,
           d.dossier_id, d.ref AS dossier_ref,
           ${TOTAL_COL}
      FROM extra_charge_simulation e
      JOIN dossier_visible d ON d.dossier_id = e.dossier_id
     WHERE d.service_type_id = $1
     ORDER BY e.created_at DESC, e.extra_charge_simulation_id
     LIMIT $2 OFFSET $3`,

  // Quoted price against what it actually cost, per file. `flag` is the
  // finance boundary's own verdict (GREEN/YELLOW/RED) and is the column worth
  // scanning: a service type whose reds cluster is a service type priced wrong.
  pricing_variance: `
    SELECT pv.pricing_variance_id AS row_id, pv.quoted_price, pv.actual_cost,
           pv.variance_percent, pv.flag, pv.computed_at,
           d.dossier_id, d.ref AS dossier_ref, q.doc_number AS quotation_number,
           ${TOTAL_COL}
      FROM pricing_variance pv
      JOIN dossier_visible d ON d.dossier_id = pv.dossier_id
      LEFT JOIN quotation q ON q.quotation_id = pv.quotation_id
     WHERE d.service_type_id = $1
     ORDER BY pv.computed_at DESC, pv.pricing_variance_id
     LIMIT $2 OFFSET $3`,

  /* ── BILL ─────────────────────────────────────────────────────────────── */

  // Every FINAL, locked or not — the list is the document register, not the
  // revenue figure. The KPI strip counts only the locked ones; a reader who
  // compares the two and finds a gap is looking at invoices still in approval,
  // which is a thing worth being able to see.
  //
  // `paid` is a LATERAL rather than a correlated subquery so the planner reads
  // `payment_allocation` once per invoice row on the page, not once per
  // invoice in the table.
  invoices: `
    SELECT i.invoice_id AS row_id, i.doc_number, i.status, i.currency,
           i.service_ht, i.disbursement_total, i.vat_total, i.total_ttc,
           i.payment_due_on, i.created_at,
           COALESCE(p.paid, 0) AS paid,
           GREATEST(i.total_ttc - COALESCE(p.paid, 0), 0) AS outstanding,
           d.dossier_id, d.ref AS dossier_ref, cm.name AS client_name,
           ${TOTAL_COL}
      FROM invoice i
      JOIN dossier_visible d ON d.dossier_id = i.dossier_id
      LEFT JOIN client_master cm ON cm.client_id = i.client_id
      LEFT JOIN LATERAL (
        SELECT SUM(pa.amount) AS paid
          FROM payment_allocation pa
          JOIN payment_receipt pr ON pr.receipt_id = pa.receipt_id
         WHERE pa.invoice_id = i.invoice_id AND pr.status = 'POSTED_LOCKED'
      ) p ON TRUE
     WHERE d.service_type_id = $1 AND i.type = 'FINAL'
     ORDER BY i.created_at DESC, i.invoice_id
     LIMIT $2 OFFSET $3`,

  // A credit note reduces revenue, so a tab that lists FINALs and not these
  // reports a number the ledger disagrees with. Same table, third `type`.
  credit_notes: `
    SELECT i.invoice_id AS row_id, i.doc_number, i.status, i.currency,
           i.service_ht, i.total_ttc, i.created_at,
           d.dossier_id, d.ref AS dossier_ref, cm.name AS client_name,
           ${TOTAL_COL}
      FROM invoice i
      JOIN dossier_visible d ON d.dossier_id = i.dossier_id
      LEFT JOIN client_master cm ON cm.client_id = i.client_id
     WHERE d.service_type_id = $1 AND i.type = 'CREDIT_NOTE'
     ORDER BY i.created_at DESC, i.invoice_id
     LIMIT $2 OFFSET $3`,

  // What was actually COLLECTED, allocation by allocation. Billed is not
  // collected, and on a corridor where a 90-day settlement is normal the gap
  // between the two is the number that decides whether a service type is worth
  // selling. The grain is the allocation, not the receipt: one receipt can
  // settle four invoices across three files.
  collections: `
    SELECT pa.allocation_id AS row_id, pa.amount, pr.method, pr.received_on, pr.status,
           i.invoice_id, i.doc_number AS invoice_number, i.currency,
           d.dossier_id, d.ref AS dossier_ref, cm.name AS client_name,
           ${TOTAL_COL}
      FROM payment_allocation pa
      JOIN payment_receipt pr ON pr.receipt_id = pa.receipt_id
      JOIN invoice i ON i.invoice_id = pa.invoice_id
      JOIN dossier_visible d ON d.dossier_id = i.dossier_id
      LEFT JOIN client_master cm ON cm.client_id = i.client_id
     WHERE d.service_type_id = $1
     ORDER BY pr.received_on DESC, pa.allocation_id
     LIMIT $2 OFFSET $3`,

  /* ── SPEND ────────────────────────────────────────────────────────────── */

  // The costing SHEETS, which the old tab never listed — only the sum of their
  // lines appeared, as one number per currency. A reader could see that the
  // service was planned at 40M and had no way to ask which eleven files that
  // was, or how many of them were still DRAFT.
  costings: `
    SELECT co.costing_id AS row_id, co.doc_number, co.status, co.currency,
           co.margin_percent, co.exchange_rate_to_xaf, co.created_at,
           COALESCE(l.planned_total, 0) AS planned_total,
           COALESCE(l.planned_disbursement, 0) AS planned_disbursement,
           d.dossier_id, d.ref AS dossier_ref, cm.name AS client_name,
           ${TOTAL_COL}
      FROM costing co
      JOIN dossier_visible d ON d.dossier_id = co.dossier_id
      LEFT JOIN client_master cm ON cm.client_id = d.client_id
      LEFT JOIN LATERAL (
        SELECT SUM(cl.qty * cl.unit_cost) AS planned_total,
               SUM(CASE WHEN cl.is_disbursement THEN cl.qty * cl.unit_cost ELSE 0 END) AS planned_disbursement
          FROM costing_line cl WHERE cl.costing_id = co.costing_id
      ) l ON TRUE
     WHERE d.service_type_id = $1
     ORDER BY co.created_at DESC, co.costing_id
     LIMIT $2 OFFSET $3`,

  // Money OUT before anything comes in. `disbursed` is what treasury actually
  // paid and `justified` is what came back with a receipt; the three figures
  // differing is the normal state of a live file, not an error.
  cash_requests: `
    SELECT cr.cash_request_id AS row_id, cr.doc_number, cr.status, cr.currency,
           cr.amount, cr.amount_xaf, cr.created_at,
           COALESCE(pay.disbursed, 0) AS disbursed,
           COALESCE(li.justified, 0) AS justified,
           d.dossier_id, d.ref AS dossier_ref,
           ${TOTAL_COL}
      FROM cash_request cr
      JOIN dossier_visible d ON d.dossier_id = cr.dossier_id
      LEFT JOIN LATERAL (
        SELECT SUM(crp.amount) AS disbursed FROM cash_request_payment crp
         WHERE crp.cash_request_id = cr.cash_request_id
      ) pay ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(crl.spent_amount) AS justified FROM cash_request_line crl
         WHERE crl.cash_request_id = cr.cash_request_id
      ) li ON TRUE
     WHERE d.service_type_id = $1
     ORDER BY cr.created_at DESC, cr.cash_request_id
     LIMIT $2 OFFSET $3`,

  // Bought-in cost with a counterparty on it. `cost_entry` gives the ledger
  // total and no supplier; this is where "who did we pay to deliver this
  // service" is answerable. `wht_total` is the SIT/précompte withheld, which
  // is money we keep and owe the tax authority, not money the supplier gets.
  supplier_invoices: `
    SELECT si.supplier_invoice_id AS row_id, si.doc_number, si.supplier_ref, si.status,
           si.currency, si.amount_ht, si.vat_total, si.wht_total, si.amount_ttc,
           si.due_on, si.created_at,
           d.dossier_id, d.ref AS dossier_ref, sm.name AS supplier_name,
           ${TOTAL_COL}
      FROM supplier_invoice si
      JOIN dossier_visible d ON d.dossier_id = si.dossier_id
      LEFT JOIN supplier_master sm ON sm.supplier_id = si.supplier_id
     WHERE d.service_type_id = $1
     ORDER BY si.created_at DESC, si.supplier_invoice_id
     LIMIT $2 OFFSET $3`,
};

/** The block names, in the order the tab renders them. */
const BLOCKS = Object.keys(BLOCK_SQL);

/**
 * One page of one block, plus the true match count.
 *
 * `block` is NOT interpolated — it selects a statement from the frozen map
 * above, so an unknown name is a missing key and never a fragment of SQL. The
 * route's validator rejects it before here; this is the second lock.
 *
 * @returns {Promise<{rows: object[], total: number}>}
 */
async function blockPage(client, serviceTypeId, block, q = {}) {
  const sql = Object.prototype.hasOwnProperty.call(BLOCK_SQL, block) ? BLOCK_SQL[block] : null;
  if (!sql) throw new Error(`Unknown commercial block: ${block}`);
  const { limit, offset } = page(q);
  const { rows } = await client.query(sql, [serviceTypeId, limit, offset]);
  return splitTotal(rows);
}

/* ── The summary behind the KPI strip ─────────────────────────────────────── */

/**
 * Every figure the strip and the per-block subtotals need, in ONE round trip.
 *
 * WHY ONE QUERY AND NOT TWELVE. The sibling 360 aggregator runs its sub-queries
 * sequentially and says why — a pg client cannot execute two queries at once,
 * so twelve aggregates would be twelve serial round trips on top of whichever
 * block the sub-tab is also fetching. Each CTE here is independently readable
 * and the planner runs them in one statement.
 *
 * Every array is per currency. `json_agg` over an empty CTE is NULL, so each is
 * coalesced to `[]` — a service type nobody has sold yet returns the full shape
 * with empty arrays rather than nulls the UI has to branch on. Same rule as
 * EMPTY_STATS in service_type_360.service.js.
 */
const SUMMARY_SQL = `
  WITH
  -- Quoted value, and the funnel the win rate is computed from. The counts are
  -- per currency because the SUMs are, but a win rate is a ratio of COUNTS and
  -- so is currency-free — the service adds them up across the array.
  quotations AS (
    SELECT q.currency,
           COUNT(*)::int AS doc_count,
           COALESCE(SUM(q.total_ht), 0) AS total_ht,
           COALESCE(SUM(q.total_ttc), 0) AS total_ttc,
           COUNT(*) FILTER (WHERE q.status IN ('ACCEPTED','CONVERTED'))::int AS won,
           COUNT(*) FILTER (WHERE q.status IN ('ACCEPTED','CONVERTED','REJECTED','EXPIRED'))::int AS decided,
           COALESCE(SUM(q.total_ttc) FILTER (WHERE q.status IN ('ACCEPTED','CONVERTED')), 0) AS won_ttc
      FROM quotation q JOIN dossier_visible d ON d.dossier_id = q.dossier_id
     WHERE d.service_type_id = $1 GROUP BY q.currency
  ),
  proforma AS (
    SELECT i.currency, COUNT(*)::int AS doc_count, COALESCE(SUM(i.total_ttc), 0) AS total_ttc
      FROM invoice i JOIN dossier_visible d ON d.dossier_id = i.dossier_id
     WHERE d.service_type_id = $1 AND i.type = 'PROFORMA' GROUP BY i.currency
  ),
  margin_sims AS (
    SELECT ms.currency, COUNT(*)::int AS doc_count,
           COALESCE(SUM(ms.total_cost), 0) AS total_cost,
           COALESCE(SUM(ms.total_price), 0) AS total_price,
           AVG(ms.margin_percent) AS avg_margin_percent
      FROM margin_simulation ms
     WHERE ms.service_type_id = $1 GROUP BY ms.currency
  ),
  extra_charges AS (
    SELECT e.currency, COUNT(*)::int AS doc_count, COALESCE(SUM(e.total_amount), 0) AS total_amount
      FROM extra_charge_simulation e JOIN dossier_visible d ON d.dossier_id = e.dossier_id
     WHERE d.service_type_id = $1 GROUP BY e.currency
  ),
  -- No currency column on pricing_variance: it compares a quote and a cost that
  -- were already reconciled upstream. Grouped on a constant so it keeps the
  -- same array-of-one shape as its neighbours.
  variance AS (
    SELECT 'XAF'::text AS currency, COUNT(*)::int AS doc_count,
           AVG(pv.variance_percent) AS avg_variance_percent,
           COUNT(*) FILTER (WHERE pv.flag = 'RED')::int AS red_count,
           COUNT(*) FILTER (WHERE pv.flag = 'YELLOW')::int AS yellow_count,
           COUNT(*) FILTER (WHERE pv.flag = 'GREEN')::int AS green_count
      FROM pricing_variance pv JOIN dossier_visible d ON d.dossier_id = pv.dossier_id
     WHERE d.service_type_id = $1
    HAVING COUNT(*) > 0
  ),
  -- Billed: locked FINALs only, matching moneyRollup exactly so the Commercial
  -- tab and the header's "Billed" tile cannot disagree. raised_count counts every
  -- FINAL whatever its status, which is what the block below lists.
  billed AS (
    SELECT i.currency,
           COUNT(*) FILTER (WHERE i.status IN ${LOCKED})::int AS invoice_count,
           COUNT(*)::int AS raised_count,
           COALESCE(SUM(i.total_ttc) FILTER (WHERE i.status IN ${LOCKED}), 0) AS billed_ttc,
           COALESCE(SUM(i.service_ht) FILTER (WHERE i.status IN ${LOCKED}), 0) AS revenue_ht
      FROM invoice i JOIN dossier_visible d ON d.dossier_id = i.dossier_id
     WHERE d.service_type_id = $1 AND i.type = 'FINAL' GROUP BY i.currency
  ),
  credit_notes AS (
    SELECT i.currency,
           COUNT(*) FILTER (WHERE i.status IN ${LOCKED})::int AS doc_count,
           COALESCE(SUM(i.total_ttc) FILTER (WHERE i.status IN ${LOCKED}), 0) AS credit_ttc
      FROM invoice i JOIN dossier_visible d ON d.dossier_id = i.dossier_id
     WHERE d.service_type_id = $1 AND i.type = 'CREDIT_NOTE' GROUP BY i.currency
  ),
  -- Collected against this service's invoices, and what is still out. The
  -- currency is the INVOICE's: a receipt settles an invoice, so the invoice
  -- decides what currency the settlement is in.
  collections AS (
    SELECT i.currency,
           COALESCE(SUM(pa.amount), 0) AS collected,
           COUNT(DISTINCT pa.receipt_id)::int AS receipt_count
      FROM payment_allocation pa
      JOIN payment_receipt pr ON pr.receipt_id = pa.receipt_id
      JOIN invoice i ON i.invoice_id = pa.invoice_id
      JOIN dossier_visible d ON d.dossier_id = i.dossier_id
     WHERE d.service_type_id = $1 AND pr.status = 'POSTED_LOCKED'
     GROUP BY i.currency
  ),
  -- Planned: the same expression moneyRollup uses, so the Spend sub-tab's
  -- subtotal and the old rollup agree to the franc.
  planned AS (
    SELECT c.currency,
           COUNT(DISTINCT c.costing_id)::int AS doc_count,
           COALESCE(SUM(cl.qty * cl.unit_cost), 0) AS planned_total,
           COALESCE(SUM(CASE WHEN cl.is_disbursement THEN cl.qty * cl.unit_cost ELSE 0 END), 0) AS planned_disbursement
      FROM costing c
      JOIN dossier_visible d ON d.dossier_id = c.dossier_id
      LEFT JOIN costing_line cl ON cl.costing_id = c.costing_id
     WHERE d.service_type_id = $1 GROUP BY c.currency
  ),
  cash_requests AS (
    SELECT cr.currency, COUNT(*)::int AS doc_count,
           COALESCE(SUM(cr.amount), 0) AS requested,
           COALESCE(SUM(cr.amount_xaf), 0) AS requested_xaf,
           COALESCE(SUM(pay.disbursed), 0) AS disbursed,
           COALESCE(SUM(li.justified), 0) AS justified
      FROM cash_request cr
      JOIN dossier_visible d ON d.dossier_id = cr.dossier_id
      LEFT JOIN LATERAL (
        SELECT SUM(crp.amount) AS disbursed FROM cash_request_payment crp
         WHERE crp.cash_request_id = cr.cash_request_id) pay ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(crl.spent_amount) AS justified FROM cash_request_line crl
         WHERE crl.cash_request_id = cr.cash_request_id) li ON TRUE
     WHERE d.service_type_id = $1 GROUP BY cr.currency
  ),
  supplier_invoices AS (
    SELECT si.currency, COUNT(*)::int AS doc_count,
           COALESCE(SUM(si.amount_ht), 0) AS amount_ht,
           COALESCE(SUM(si.wht_total), 0) AS wht_total,
           COALESCE(SUM(si.amount_ttc), 0) AS amount_ttc
      FROM supplier_invoice si JOIN dossier_visible d ON d.dossier_id = si.dossier_id
     WHERE d.service_type_id = $1 GROUP BY si.currency
  ),
  -- The ledger. No currency column by construction, so this is the one scalar.
  actual AS (
    SELECT COALESCE(${netAmountSql("ce")}, 0) AS actual_xaf
      FROM cost_entry ce JOIN dossier_visible d ON d.dossier_id = ce.dossier_id
     WHERE d.service_type_id = $1
  )
  SELECT json_build_object(
    'quotations',        COALESCE((SELECT json_agg(t ORDER BY t.currency) FROM quotations t), '[]'::json),
    'proforma',          COALESCE((SELECT json_agg(t ORDER BY t.currency) FROM proforma t), '[]'::json),
    'margin_sims',       COALESCE((SELECT json_agg(t ORDER BY t.currency) FROM margin_sims t), '[]'::json),
    'extra_charges',     COALESCE((SELECT json_agg(t ORDER BY t.currency) FROM extra_charges t), '[]'::json),
    'pricing_variance',  COALESCE((SELECT json_agg(t) FROM variance t), '[]'::json),
    'invoices',          COALESCE((SELECT json_agg(t ORDER BY t.currency) FROM billed t), '[]'::json),
    'credit_notes',      COALESCE((SELECT json_agg(t ORDER BY t.currency) FROM credit_notes t), '[]'::json),
    'collections',       COALESCE((SELECT json_agg(t ORDER BY t.currency) FROM collections t), '[]'::json),
    'costings',          COALESCE((SELECT json_agg(t ORDER BY t.currency) FROM planned t), '[]'::json),
    'cash_requests',     COALESCE((SELECT json_agg(t ORDER BY t.currency) FROM cash_requests t), '[]'::json),
    'supplier_invoices', COALESCE((SELECT json_agg(t ORDER BY t.currency) FROM supplier_invoices t), '[]'::json),
    'actual_xaf',        (SELECT actual_xaf FROM actual)
  ) AS summary`;

/**
 * Per-currency totals for all eleven blocks plus the ledger actual.
 *
 * @returns {Promise<object>} keyed by block name; every value is an array
 *                            except `actual_xaf`, which is a number.
 */
async function summary(client, serviceTypeId) {
  const { rows } = await client.query(SUMMARY_SQL, [serviceTypeId]);
  const s = (rows[0] && rows[0].summary) || {};
  // Belt and braces for a tenant whose tables are empty enough that a CTE
  // returns no row at all: the UI contract is "every key present".
  const out = { actual_xaf: Number(s.actual_xaf || 0) };
  for (const b of BLOCKS) out[b] = Array.isArray(s[b]) ? s[b] : [];
  return out;
}

module.exports = { BLOCKS, BLOCK_SQL, SUMMARY_SQL, blockPage, summary };
