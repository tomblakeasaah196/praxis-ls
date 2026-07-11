/** Purchase order (MOD-60) — pure lifecycle + totals.
 *  DRAFT→ISSUED_LOCKED→APPROVED_LOCKED→RECEIVED→CLOSED (or CANCELLED from DRAFT/ISSUED). */
"use strict";
const { AppError } = require("../../../utils/errors");

const NEXT = {
  DRAFT: ["ISSUED_LOCKED", "CANCELLED"],
  ISSUED_LOCKED: ["APPROVED_LOCKED", "CANCELLED"],
  APPROVED_LOCKED: ["RECEIVED"],
  RECEIVED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

function assertTransition(from, to) {
  if (!NEXT[from] || !NEXT[from].includes(to)) throw new AppError("BAD_STATE", `Cannot move purchase order ${from} -> ${to}`, 422);
  return true;
}

const round2 = (n) => Math.round(n * 100) / 100;
/** Sum of qty*unit_price across items, in major units. */
function computeTotal(items) {
  if (!Array.isArray(items) || items.length === 0) throw new AppError("NO_ITEMS", "a purchase order needs at least one item", 422);
  let cents = 0;
  items.forEach((it, i) => {
    const qty = Number(it.qty);
    const up = Number(it.unit_price);
    if (!Number.isFinite(qty) || qty <= 0) throw new AppError("INVALID_QTY", `item ${i + 1}: qty must be > 0`, 422);
    if (!Number.isFinite(up) || up < 0) throw new AppError("INVALID_PRICE", `item ${i + 1}: unit_price must be >= 0`, 422);
    cents += Math.round(up * 100) * qty;
  });
  return round2(cents / 100);
}

module.exports = { NEXT, assertTransition, computeTotal };
