/**
 * Margin simulator (MOD-27) — pure, DB-free quote maths (KB §6.7).
 * Margin is earned on SERVICES only; débours (pass-through disbursements) are
 * excluded from the margin base but still shown as cost = price (zero markup).
 *
 * Money is summed in integer centimes to avoid float drift, then returned major.
 */
"use strict";

const { AppError } = require("../../../utils/errors");

const round2 = (n) => Math.round(n * 100) / 100;

function cents(v, label) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new AppError("INVALID_AMOUNT", `${label} must be a non-negative number`, 422);
  return Math.round(n * 100);
}

/**
 * computeMargin(lines, opts) where each line is
 *   { qty, unit_cost, unit_price, is_disbursement?, vat_applicable? }
 * Returns totals in major units plus the service-only margin.
 *
 * VAT (§3.1, legacy per-line toggle): lines flagged vat_applicable add VAT at
 * `opts.vatRatePercent` (the tenant rate from settings finance.vat — never a
 * literal) on their PRICE. Débours are pass-through and never taxed, matching
 * the ledger rule (0640 assert_line_valid).
 */
function computeMargin(lines, opts = {}) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new AppError("NO_LINES", "at least one line is required", 422);
  }
  const vatRate = Number(opts.vatRatePercent || 0);
  let costC = 0;
  let priceC = 0;
  let svcCostC = 0;
  let svcPriceC = 0;
  let disbursementC = 0;
  let vatC = 0;
  lines.forEach((ln, i) => {
    const at = `line ${i + 1}`;
    const qty = Number(ln.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw new AppError("INVALID_QTY", `${at}: qty must be > 0`, 422);
    const lineCost = Math.round(cents(ln.unit_cost, `${at} unit_cost`) * qty);
    const linePrice = Math.round(cents(ln.unit_price, `${at} unit_price`) * qty);
    costC += lineCost;
    priceC += linePrice;
    if (ln.is_disbursement === true) {
      disbursementC += lineCost;
    } else {
      svcCostC += lineCost;
      svcPriceC += linePrice;
      if (ln.vat_applicable === true) vatC += Math.round(linePrice * (vatRate / 100));
    }
  });
  const marginC = svcPriceC - svcCostC;
  const marginPercent = svcPriceC > 0 ? round2((marginC / svcPriceC) * 100) : 0;
  const markupPercent = svcCostC > 0 ? round2((marginC / svcCostC) * 100) : 0;
  return {
    total_cost: round2(costC / 100),
    total_price: round2(priceC / 100),
    service_cost: round2(svcCostC / 100),
    service_price: round2(svcPriceC / 100),
    disbursement_total: round2(disbursementC / 100),
    margin_amount: round2(marginC / 100),
    margin_percent: marginPercent,
    markup_percent: markupPercent,
    vat_total: round2(vatC / 100),
    total_ttc: round2((priceC + vatC) / 100),
  };
}

/**
 * Per-line economics + KPI (§3.1). The legacy screen shows MARGIN and a KPI
 * (`POOR (0%)`) on every line — that is how a pricer finds WHICH line kills
 * the deal, so it is not cosmetic. Bands come from the same tenant thresholds
 * as the pricing-variance flag (settings commercial.pricing_variance):
 * margin ≥ green_min → GOOD, ≥ yellow_min → FAIR, below → POOR. Débours have
 * no margin by definition — pass-through.
 */
function lineEconomics(ln, thresholds = {}) {
  const qty = Number(ln.qty || 1);
  const cost = round2(Number(ln.unit_cost || 0) * qty);
  const price = round2(Number(ln.unit_price || 0) * qty);
  if (ln.is_disbursement === true) {
    return { cost, price, margin_amount: 0, margin_percent: null, kpi: "PASS-THROUGH" };
  }
  const margin = round2(price - cost);
  const marginPercent = price > 0 ? round2((margin / price) * 100) : (cost > 0 ? -100 : 0);
  const green = Number(thresholds.green_min ?? 20);
  const yellow = Number(thresholds.yellow_min ?? 10);
  const kpi = marginPercent >= green ? "GOOD" : marginPercent >= yellow ? "FAIR" : "POOR";
  return { cost, price, margin_amount: margin, margin_percent: marginPercent, kpi };
}

/**
 * COST NATURE IS THE CONTRACT (§2.1).
 *
 * A line is a disbursement because of WHAT IT IS, not because someone ticked a
 * box. The catalogue says what it is: dictionary_item.direction is NOT NULL and
 * CHECKed to REVENUE | EXPENSE | DISBURSEMENT | ASSET (0630:48,77 → 0640:117),
 * with `category` and `is_disbursement` alongside it.
 *
 * Every downstream rule keys off that classification, and the database enforces
 * it at the bottom: `chk_disbursement_no_tax` on invoice_line (0230:92) and
 * assert_line_valid() (0640:156) both REFUSE a disbursement carrying a
 * tax_code_id. So a simulation line that is a disbursement AND VAT-applicable
 * is not a preference — it is a row that cannot legally become an invoice. We
 * refuse to construct it here, where the pricer can still see why, rather than
 * letting it surface later as a trigger exception on someone else's screen.
 *
 * Returns { is_disbursement, vat_applicable, nature, source }.
 *   source 'catalogue' — the dictionary classified it (authoritative)
 *   source 'line'      — no dictionary item; the stored flag is all we have
 *
 * `disbursement_vat_transparent` (0630:56) is deliberately NOT consulted to
 * turn VAT back on: it governs how a débours RE-BILLS its VAT-inclusive amount
 * downstream, not whether the simulator adds VAT on top. Adding VAT here would
 * double it.
 */
function classifyLine(ln = {}, dict = null) {
  if (!dict) {
    const stored = ln.is_disbursement === true;
    return {
      is_disbursement: stored,
      vat_applicable: stored ? false : ln.vat_applicable === true,
      nature: null,
      source: "line",
    };
  }
  const isDisbursement =
    String(dict.direction || "").toUpperCase() === "DISBURSEMENT" ||
    String(dict.category || "").toLowerCase() === "disbursement" ||
    dict.is_disbursement === true;
  return {
    is_disbursement: isDisbursement,
    // Pass-through never carries VAT — the invariant above.
    vat_applicable: isDisbursement ? false : ln.vat_applicable === true,
    nature: dict.direction || null,
    source: "catalogue",
  };
}

/**
 * Given a target margin % (on price) and a cost, the price that achieves it.
 *   price = cost / (1 - margin/100)   (margin < 100)
 */
function priceForMargin(cost, marginPercent) {
  const c = Number(cost);
  const m = Number(marginPercent);
  if (!Number.isFinite(c) || c < 0) throw new AppError("INVALID_AMOUNT", "cost must be >= 0", 422);
  if (!Number.isFinite(m) || m < 0 || m >= 100) throw new AppError("INVALID_MARGIN", "margin_percent must be in [0,100)", 422);
  return round2(c / (1 - m / 100));
}

/**
 * OUR OWN COST — a line we pay and do not bill (meeting 6, owner decision G1).
 *
 * The catalogue's siblings (seed 9082) give one service three fates: REVENUE is
 * the service we sell, DISBURSEMENT is money advanced for the client and
 * re-billed at cost, EXPENSE ("— Own Cost") is what we pay a supplier to
 * deliver it — and ASSET ("— Deposit") is our own money lodged as a guarantee.
 * The last two never reach a client ("Own Cost only ever appears on a purchase
 * order or an internal costing sheet", 9082), so a quotation priced from a
 * costing leaves them off the client's lines and keeps them as the FLOOR the
 * services must cover.
 *
 * Read off the catalogue only (`nature`, the dictionary direction classifyLine
 * returns): an ad-hoc line with no catalogue entry is priced as a service and
 * reported as unclassified, never silently dropped from the bill.
 */
const OWN_NATURES = new Set(["EXPENSE", "ASSET"]);
const isOwnCost = (l) => l.is_disbursement !== true && OWN_NATURES.has(String(l.cost_nature || "").toUpperCase());

/**
 * A QUOTATION PRICED STRAIGHT FROM A COSTING (meeting 6, G1) — the simulator's
 * rules applied in one pass, so the pricer is not walked through the simulator.
 *
 * Each line arrives as `fromCosting` maps it (classified against the catalogue:
 * `is_disbursement`, `vat_applicable`, `cost_nature`), and leaves as one of:
 *
 *   débours   billed AT COST — unit_price = unit_cost, no margin, never VAT.
 *             The pass-through rule computeMargin and the ledger already apply.
 *   service   billed at the target margin — unit_price = priceForMargin(unit
 *             cost, targetMarginPercent): margin on PRICE, the simulator's own
 *             definition.
 *   own cost  NOT billed. Kept in the workings at price 0 (so the simulation's
 *             margin is the file's real margin) and summed into the floor.
 *
 * Returns:
 *   billed      the client's lines, in costing order (the quotation's lines)
 *   own         the own-cost lines, for the "Own costs on this file" panel
 *   workings    every line as the margin simulation stores it — billed lines
 *               at their price, own costs at 0 with a note
 *   totals      computeMargin over `workings` (the simulator's own totals)
 *   floor       { own_cost_total, service_total, covered, shortfall }
 *
 * `covered` is the warning G1 asks for: the services billed on this file must
 * at least cover what we pay out of our own pocket for it. A file whose
 * services bill less than its own costs loses money whatever the margin says.
 *
 * Pure: the equality "priced directly = what the simulator would produce at the
 * same margin" is a property of this function and is pinned by
 * tests/unit/quotation-from-costing.test.js.
 */
function priceCostingLines(lines = [], { targetMarginPercent = 0, vatRatePercent = 0 } = {}) {
  const m = Number(targetMarginPercent);
  if (!Number.isFinite(m) || m < 0 || m >= 100) {
    throw new AppError("INVALID_MARGIN", "The target margin must be at least 0 % and below 100 %", 422);
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new AppError("NO_LINES", "This costing has no lines to quote", 422);
  }
  const billed = [];
  const own = [];
  const workings = [];
  let ownC = 0;
  let serviceC = 0;
  for (const l of lines) {
    const qty = Number(l.qty) || 1;
    const unitCost = round2(Number(l.unit_cost) || 0);
    if (isOwnCost(l)) {
      own.push({ ...l, qty, unit_cost: unitCost });
      ownC += Math.round(unitCost * 100 * qty);
      workings.push({ ...l, qty, unit_cost: unitCost, unit_price: 0, vat_applicable: false, notes: "Own cost — not billed (the floor the services must cover)" });
      continue;
    }
    const debours = l.is_disbursement === true;
    const unitPrice = debours ? unitCost : priceForMargin(unitCost, m);
    const line = { ...l, qty, unit_cost: unitCost, unit_price: unitPrice, vat_applicable: debours ? false : l.vat_applicable === true };
    if (!debours) serviceC += Math.round(unitPrice * 100 * qty);
    billed.push(line);
    workings.push(line);
  }
  if (!billed.length) {
    throw new AppError("NOTHING_TO_BILL", "Every line on this costing is our own cost — there is nothing to bill the client", 422);
  }
  const totals = computeMargin(workings, { vatRatePercent });
  return {
    billed,
    own,
    workings,
    totals,
    floor: {
      own_cost_total: round2(ownC / 100),
      service_total: round2(serviceC / 100),
      covered: serviceC >= ownC,
      shortfall: serviceC >= ownC ? 0 : round2((ownC - serviceC) / 100),
    },
  };
}

module.exports = { computeMargin, priceForMargin, lineEconomics, classifyLine, priceCostingLines, isOwnCost };
