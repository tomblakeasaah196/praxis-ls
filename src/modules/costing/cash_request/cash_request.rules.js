/** Cash request / disbursal document (MOD-49) — pure lifecycle.
 *  DRAFT→SUBMITTED→APPROVED→DISBURSED→JUSTIFIED (REJECTED from SUBMITTED/APPROVED). */
"use strict";
const { AppError } = require("../../../utils/errors");

const NEXT = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["APPROVED", "REJECTED"],
  APPROVED: ["DISBURSED", "REJECTED"],
  DISBURSED: ["JUSTIFIED"],
  JUSTIFIED: [],
  REJECTED: [],
};

function assertTransition(from, to) {
  if (!NEXT[from] || !NEXT[from].includes(to)) throw new AppError("BAD_STATE", `Cannot move cash request ${from} -> ${to}`, 422);
  return true;
}

const round2 = (n) => Math.round(n * 100) / 100;
/** Sum of a numeric field across lines. */
function sumField(lines, field) {
  return round2((lines || []).reduce((s, l) => s + Number(l[field] || 0), 0));
}

module.exports = { NEXT, assertTransition, sumField };
