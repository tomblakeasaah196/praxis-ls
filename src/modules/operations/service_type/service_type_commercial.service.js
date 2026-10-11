"use strict";
/**
 * The Commercial tab: who may see which block, and the six figures on its KPI
 * strip.
 *
 * ── WHO MAY SEE WHAT ────────────────────────────────────────────────────────
 *
 * The old tab had one money switch: `canSeeFinancials` (a read grant on
 * Treasury, MOD-09, or the CEO bypass) decided whether the whole rollup and the
 * invoice list rendered. With one block that was defensible. With eleven it is
 * not — it would hide a sales user's own quotations behind a Treasury grant,
 * and show a Treasury reader the supplier invoices by the same stroke.
 *
 * So each block is gated on the module that OWNS it, which is the same grant
 * that opens the screen the block's rows deep-link to. A reader who can open
 * Quotations can see this service's quotations here; one who cannot, cannot.
 * That is the rule `financial_dictionary.controller.js:152` already uses for
 * the rows behind a usage tile, and it is both tighter and more generous than
 * one blanket flag.
 *
 * `canSeeFinancials` stays as an OR, never an AND. Everyone who can see a
 * figure today still sees it after this change: a Treasury reader keeps the
 * invoice list the old tab gave them, and the per-module grants only ADD
 * people who should have had it all along. A gate that quietly takes a screen
 * away from someone is a support ticket, not a security fix.
 *
 * ONE BLOCK IS UNGATED, and it is deliberate: `margin_sims` rendered for anyone
 * with MOD-29 `view` before this change, because it sat outside the masked
 * section of the old tab. Narrowing it to MOD-27 would remove a table that
 * people can see today, which is an owner's decision about commercial
 * confidentiality and not a refactor's to make. It is flagged here so the
 * decision is made on purpose rather than inherited.
 *
 * ── WHY NOTHING IS CONVERTED ────────────────────────────────────────────────
 *
 * Every money tile reports XAF and carries the other currencies beside it, for
 * the reason `moneyRollup` gives: multiplying by a rate here invents an FX
 * decision that belongs to the costing screen, where someone has already made
 * it. A tile that silently folded EUR into XAF at today's rate would also
 * change its own history every morning.
 */
const repo = require("./service_type_commercial.repo");
const serviceTypeRepo = require("./service_type.repo");
const { readPermissions } = require("../../../middleware/rbac");
const { canSeeFinancials } = require("../../master/_shared/confidential");

/**
 * Block → the module whose `view` grant opens it, and the name to put in the
 * refusal. `null` means ungated beyond MOD-29 `view` on the service type
 * itself (see the header: margin sims, for continuity).
 */
const BLOCK_GATE = {
  quotations: { module: "MOD-27", name: "Quotations" },
  proforma: { module: "MOD-50", name: "Proforma invoices" },
  margin_sims: null,
  extra_charges: { module: "MOD-28", name: "Extra charge simulation" },
  pricing_variance: { module: "MOD-27", name: "Pricing variance" },
  invoices: { module: "MOD-51", name: "FINAL invoices" },
  credit_notes: { module: "MOD-51", name: "Credit notes" },
  collections: { module: "MOD-09", name: "Collections" },
  costings: { module: "MOD-46", name: "Costing" },
  cash_requests: { module: "MOD-49", name: "Cash requests" },
  supplier_invoices: { module: "MOD-61", name: "Supplier invoices" },
};

/** The sub-tab each block renders under, so the UI's grouping has one source. */
const BLOCK_GROUP = {
  quotations: "sell",
  proforma: "sell",
  margin_sims: "sell",
  extra_charges: "sell",
  pricing_variance: "sell",
  invoices: "bill",
  credit_notes: "bill",
  collections: "bill",
  costings: "spend",
  cash_requests: "spend",
  supplier_invoices: "spend",
};

/**
 * Which blocks this request may read, resolved in ONE pass.
 *
 * `readPermissions` takes every [module, action] pair at once and the identity
 * cache answers them off one connection — eleven separate calls would be
 * eleven cache lookups for a page that renders in one go. The distinct modules
 * are deduplicated first because four of the eleven share two keys (MOD-27
 * twice, MOD-51 twice).
 *
 * @returns {Promise<{allowed: Record<string, boolean>, finance: boolean}>}
 */
async function access(req) {
  const finance = await canSeeFinancials(req);
  const modules = [...new Set(Object.values(BLOCK_GATE).filter(Boolean).map((g) => g.module))];
  const results = await readPermissions(req, modules.map((m) => [m, "view"]));
  const byModule = new Map(modules.map((m, i) => [m, results[i] === true]));
  const allowed = {};
  for (const block of repo.BLOCKS) {
    const gate = BLOCK_GATE[block];
    allowed[block] = !gate || byModule.get(gate.module) === true || finance;
  }
  return { allowed, finance };
}

/* ── Arithmetic for the KPI strip ─────────────────────────────────────────── */

/** Sum a column across a per-currency array, for the XAF row only. */
function xafOf(rows, column) {
  const row = (rows || []).find((r) => r.currency === "XAF");
  return row ? Number(row[column] || 0) : 0;
}

/** Sum a column across every currency — only valid for counts, never money. */
function countOf(rows, column) {
  return (rows || []).reduce((n, r) => n + Number(r[column] || 0), 0);
}

/**
 * FINAL billed minus credit notes, per currency.
 *
 * Two arrays rather than one query because they are two document types with
 * two lifecycles; merging them here keeps the subtraction in one place. A
 * currency that appears only in credit notes still produces a row — a net
 * figure below zero is unusual, not impossible, and hiding it would make the
 * tab disagree with the ledger.
 */
function netBilled(billed, credits) {
  const out = new Map();
  for (const b of billed || []) {
    out.set(b.currency, {
      currency: b.currency,
      billed_ttc: Number(b.billed_ttc || 0),
      revenue_ht: Number(b.revenue_ht || 0),
      invoice_count: Number(b.invoice_count || 0),
      raised_count: Number(b.raised_count || 0),
      credit_ttc: 0,
      credit_count: 0,
    });
  }
  for (const c of credits || []) {
    const row = out.get(c.currency) || {
      currency: c.currency, billed_ttc: 0, revenue_ht: 0, invoice_count: 0, raised_count: 0,
      credit_ttc: 0, credit_count: 0,
    };
    row.credit_ttc = Number(c.credit_ttc || 0);
    row.credit_count = Number(c.doc_count || 0);
    out.set(c.currency, row);
  }
  return [...out.values()]
    .map((r) => ({ ...r, net_ttc: r.billed_ttc - r.credit_ttc }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * The six tiles.
 *
 * Each carries `allowed`, its XAF figure and the per-currency detail the ⓘ
 * opens. A tile whose source block is not readable comes back `allowed: false`
 * with NO figures — not zeros. A zero and a refusal look identical on a tile
 * and mean opposite things, which is the mistake `money.masked` was added to
 * stop the first time.
 */
function kpis(summary, allowed) {
  const can = (block) => allowed[block] === true;

  // Win rate is a ratio of COUNTS, so it is the one figure that may legitimately
  // add across currencies: a quote won in euros is a quote won.
  const quotes = can("quotations") ? summary.quotations : [];
  const won = countOf(quotes, "won");
  const decided = countOf(quotes, "decided");

  const net = can("invoices") ? netBilled(summary.invoices, can("credit_notes") ? summary.credit_notes : []) : [];
  const netXaf = xafOf(net, "net_ttc");
  const actualXaf = Number(summary.actual_xaf || 0);
  const canMargin = can("invoices") && can("costings");

  return {
    quoted: {
      allowed: can("quotations"),
      xaf: can("quotations") ? xafOf(summary.quotations, "total_ttc") : null,
      count: can("quotations") ? countOf(summary.quotations, "doc_count") : null,
      by_currency: can("quotations") ? summary.quotations : [],
    },
    win_rate: {
      allowed: can("quotations"),
      // Null, not 0: "no quote has been decided yet" is not "we lose everything".
      percent: can("quotations") && decided > 0 ? (won * 100) / decided : null,
      won: can("quotations") ? won : null,
      decided: can("quotations") ? decided : null,
    },
    planned: {
      allowed: can("costings"),
      xaf: can("costings") ? xafOf(summary.costings, "planned_total") : null,
      by_currency: can("costings") ? summary.costings : [],
    },
    actual: {
      // The ledger, and the ledger is Treasury's. No per-currency detail exists
      // because `cost_entry` has no currency column — it is XAF by construction.
      allowed: can("costings"),
      xaf: can("costings") ? actualXaf : null,
      by_currency: [],
    },
    billed_net: {
      allowed: can("invoices"),
      xaf: can("invoices") ? netXaf : null,
      by_currency: net,
    },
    margin: {
      allowed: canMargin,
      // Realised, not planned: what was billed net of credit notes, against
      // what the ledger says it cost. Null when nothing has been billed, which
      // is not a margin of zero.
      percent: canMargin && netXaf > 0 ? ((netXaf - actualXaf) * 100) / netXaf : null,
    },
  };
}

/**
 * Everything the tab needs before it fetches a single row: which blocks the
 * caller may open, the per-currency subtotal under each, and the KPI strip.
 *
 * One round trip to the database (the repo's single CTE query) and one to the
 * identity cache (the access resolution above), whatever the caller's grants.
 */
async function overview(c, serviceTypeId, { allowed, finance }) {
  // `findById`, not `get` — this repo declares only the factory's name. The
  // sibling 360 service has the same note and the same reason.
  if (!(await serviceTypeRepo.findById(c, serviceTypeId))) return null;
  const summary = await repo.summary(c, serviceTypeId);
  const totals = {};
  for (const block of repo.BLOCKS) totals[block] = allowed[block] ? summary[block] : null;
  return {
    blocks: repo.BLOCKS.map((block) => ({
      block,
      group: BLOCK_GROUP[block],
      allowed: allowed[block] === true,
      gate: BLOCK_GATE[block] ? BLOCK_GATE[block].module : null,
    })),
    totals,
    actual_xaf: allowed.costings ? Number(summary.actual_xaf || 0) : null,
    kpis: kpis(summary, allowed),
    // Kept for the UI's one-line explanation of why a tile is blank. Not a
    // gate in itself — `allowed` above already is.
    finance_visibility: finance === true,
  };
}

/**
 * One page of one block. The caller has already checked `allowed[block]`.
 *
 * The existence check is not ceremony: without it a bogus service-type id
 * returns `{rows: [], total: 0}`, which the client cannot tell apart from a
 * real service nobody has sold yet. 404 says which of the two it is.
 */
async function blockPage(c, serviceTypeId, block, q) {
  if (!(await serviceTypeRepo.findById(c, serviceTypeId))) return null;
  return repo.blockPage(c, serviceTypeId, block, q);
}

module.exports = {
  BLOCKS: repo.BLOCKS, BLOCK_GATE, BLOCK_GROUP,
  access, overview, blockPage, kpis, netBilled,
};
